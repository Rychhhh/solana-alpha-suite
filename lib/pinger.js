const fs = require('fs');
const path = require('path');
const { DATA_DIR, loadEnv } = require('./env');
const { BASE_MINTS } = require('./known-entities');
const {
  getEnhancedTransactions,
  getDexScreenerToken,
  getRugCheckSummary
} = require('./helius');
const { getMergedWallets } = require('./auditor');

const PINGS_FILE = path.join(DATA_DIR, 'pings.json');

const state = {
  running: false,
  timer: null,
  pollIntervalSec: 30,
  windowMinutes: 15,
  minConsensusWallets: 2,
  watchlist: [], // [{ address, name, tier }]
  lastSigByWallet: new Map(),
  pings: [], // individual wallet buy pings
  consensus: [], // consensus buy alerts (>= minConsensusWallets)
  tokenBuyWindow: new Map(), // mint -> [{ wallet, name, sol, ts, sig }]
  lastPollAt: null,
  lastError: null
};

// Load historical pings if present
try {
  if (fs.existsSync(PINGS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PINGS_FILE, 'utf8'));
    state.pings = saved.pings || [];
    state.consensus = saved.consensus || [];
  }
} catch {}

function savePings() {
  try {
    fs.writeFileSync(
      PINGS_FILE,
      JSON.stringify({ pings: state.pings.slice(0, 200), consensus: state.consensus.slice(0, 100) }, null, 2)
    );
  } catch {}
}

async function sendTelegramAlert(text) {
  const env = loadEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch {}
}

function buildDefaultWatchlist(maxWallets = 25) {
  const merged = getMergedWallets();
  // Prefer audited ELITE / GOOD wallets first, otherwise fallback to ACTIVE wallets with highest SOL
  const audited = merged
    .filter((w) => w.stage2Done && (w.tier === 'ELITE' || w.tier === 'GOOD'))
    .sort((a, b) => (b.copyScore || 0) - (a.copyScore || 0));

  if (audited.length > 0) {
    return audited.slice(0, maxWallets).map((w) => ({
      address: w.address,
      name: w.name,
      tier: w.tier
    }));
  }

  const active = merged
    .filter((w) => w.stage1Status === 'ACTIVE' && (w.solBalance || 0) >= 0.5)
    .sort((a, b) => (b.solBalance || 0) - (a.solBalance || 0));

  if (active.length > 0) {
    return active.slice(0, maxWallets).map((w) => ({
      address: w.address,
      name: w.name,
      tier: 'ACTIVE'
    }));
  }

  return merged.slice(0, Math.min(15, maxWallets)).map((w) => ({
    address: w.address,
    name: w.name,
    tier: 'RAW'
  }));
}

async function ingestEnhancedSwap(walletInfo, tx) {
  if (!tx || tx.transactionError) return;
  const ts = tx.timestamp || Math.floor(Date.now() / 1000);
  const addr = walletInfo.address;

  // Compute net SOL spent
  let netSolDelta = 0;
  const accEntry = (tx.accountData || []).find((a) => a.account === addr);
  if (accEntry && typeof accEntry.nativeBalanceChange === 'number') {
    netSolDelta = accEntry.nativeBalanceChange / 1e9;
  }

  // Detect memecoin received (BUY)
  let boughtMint = null;
  for (const tt of tx.tokenTransfers || []) {
    if (!tt.mint || BASE_MINTS.has(tt.mint)) continue;
    if (tt.toUserAccount === addr && Number(tt.tokenAmount || 0) > 0) {
      boughtMint = tt.mint;
      break;
    }
  }
  if (!boughtMint || netSolDelta >= -0.02) return; // Only meaningful buys >= 0.02 SOL

  const solSpent = Number(Math.abs(netSolDelta).toFixed(3));
  if (state.pings.some((p) => p.sig === tx.signature && p.wallet === addr)) return;

  const dex = await getDexScreenerToken(boughtMint);
  const ping = {
    id: `${tx.signature.slice(0, 12)}-${addr.slice(0, 4)}`,
    sig: tx.signature,
    ts,
    wallet: addr,
    walletName: walletInfo.name,
    tier: walletInfo.tier,
    mint: boughtMint,
    symbol: dex?.symbol || boughtMint.slice(0, 6),
    marketCap: dex?.marketCap || 0,
    liquidityUsd: dex?.liquidityUsd || 0,
    volume5m: dex?.volume5m || 0,
    solSpent,
    padreUrl: `https://trade.padre.gg/trade/solana/${boughtMint}`,
    dexUrl: dex?.url || `https://dexscreener.com/solana/${boughtMint}`
  };

  state.pings.unshift(ping);
  if (state.pings.length > 200) state.pings.pop();

  // Sliding window consensus check
  const cutoff = ts - state.windowMinutes * 60;
  const list = (state.tokenBuyWindow.get(boughtMint) || []).filter((e) => e.ts >= cutoff);
  if (!list.some((e) => e.wallet === addr)) {
    list.push({ wallet: addr, name: walletInfo.name, sol: solSpent, ts, sig: tx.signature });
  }
  state.tokenBuyWindow.set(boughtMint, list);

  if (list.length >= state.minConsensusWallets) {
    const totalSol = Number(list.reduce((s, e) => s + e.sol, 0).toFixed(2));
    const spanMin = Math.max(1, Math.round((Math.max(...list.map((e) => e.ts)) - Math.min(...list.map((e) => e.ts))) / 60));
    const rug = await getRugCheckSummary(boughtMint);

    const existingIdx = state.consensus.findIndex((c) => c.mint === boughtMint && ts - c.ts < state.windowMinutes * 60);
    const vol1h = dex?.volume1h || dex?.volume24h || 0;
    const volMcRatio = ping.marketCap > 0 ? Number((vol1h / ping.marketCap).toFixed(2)) : 0;
    const rugRisksArr = rug?.risks || [];
    const passesTrench3Sec = ping.marketCap >= 8000 && ping.marketCap <= 35000 && volMcRatio >= 1.5 && rugRisksArr.length === 0;
    const alertObj = {
      id: `cons-${boughtMint.slice(0, 8)}-${ts}`,
      ts,
      mint: boughtMint,
      symbol: ping.symbol,
      walletCount: list.length,
      wallets: list.map((e) => ({ name: e.name, wallet: e.wallet, sol: e.sol })),
      totalSol,
      spanMin,
      marketCap: ping.marketCap,
      liquidityUsd: ping.liquidityUsd,
      volume5m: ping.volume5m,
      volMcRatio,
      passesTrench3Sec,
      rugScore: rug?.scoreNormalised ?? rug?.score ?? null,
      rugRisks: rugRisksArr,
      padreUrl: ping.padreUrl,
      dexUrl: ping.dexUrl
    };

    const isNewCount = existingIdx === -1 || state.consensus[existingIdx].walletCount < list.length;
    if (existingIdx !== -1) state.consensus[existingIdx] = alertObj;
    else state.consensus.unshift(alertObj);

    if (isNewCount) {
      const mcStr = ping.marketCap >= 1e6 ? `$${(ping.marketCap / 1e6).toFixed(2)}M` : `$${Math.round(ping.marketCap / 1000)}K`;
      const filterBadge = passesTrench3Sec ? '✅ PASS 3-SEC FILTER ($8K–$35K)' : '⚠️ CHECK CHART FIRST';
      const msg =
        `🔥 <b>CONSENSUS BUY (${list.length} Wallets)</b>\n` +
        `${filterBadge}\n` +
        `Token: <b>$${ping.symbol}</b> | MC: <b>${mcStr}</b> | V/MC: <b>${volMcRatio}x</b>\n` +
        `Total Buy: <b>${totalSol} SOL</b> dalam ${spanMin}m\n` +
        `Buyers: ${list.map((e) => `${e.name} (${e.sol} SOL)`).join(', ')}\n` +
        `CA: <code>${boughtMint}</code>\n` +
        `<a href="${ping.padreUrl}">Open in Padre</a> | <a href="${ping.dexUrl}">DexScreener</a>`;
      await sendTelegramAlert(msg);
    }
  }

  savePings();
}

async function pollOnce() {
  if (!state.running) return;
  state.lastPollAt = Date.now();
  state.lastError = null;
  for (const w of state.watchlist) {
    if (!state.running) break;
    try {
      const txs = await getEnhancedTransactions(w.address, { limit: 8, type: 'SWAP' });
      if (!txs.length) continue;
      const prevSig = state.lastSigByWallet.get(w.address);
      state.lastSigByWallet.set(w.address, txs[0].signature);

      // First run only seeds last 15 minutes so UI populates immediately without old spam
      const cutoff = prevSig ? 0 : Math.floor(Date.now() / 1000) - 3600;
      for (const tx of txs) {
        if (prevSig && tx.signature === prevSig) break;
        if ((tx.timestamp || 0) < cutoff) break;
        await ingestEnhancedSwap(w, tx);
      }
    } catch (err) {
      state.lastError = `${w.name}: ${err.message}`;
    }
  }
}

function startPinger({ pollIntervalSec = 45, windowMinutes = 15, minConsensusWallets = 2, maxWallets = 20, customWallets = null } = {}) {
  if (state.running) return getPingerStatus();
  state.pollIntervalSec = Math.max(15, Number(pollIntervalSec) || 45);
  state.windowMinutes = Math.max(1, Number(windowMinutes) || 15);
  state.minConsensusWallets = Math.max(2, Number(minConsensusWallets) || 2);
  state.watchlist = Array.isArray(customWallets) && customWallets.length > 0
    ? customWallets
    : buildDefaultWatchlist(maxWallets);
  state.running = true;

  const loop = async () => {
    if (!state.running) return;
    await pollOnce();
    if (state.running) {
      state.timer = setTimeout(loop, state.pollIntervalSec * 1000);
    }
  };
  loop();
  return getPingerStatus();
}

function stopPinger() {
  state.running = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  return getPingerStatus();
}

// Helius Enhanced Webhook Receiver (if user connects ngrok / Cloudflare Tunnel!)
async function handleHeliusWebhook(payload) {
  const txs = Array.isArray(payload) ? payload : [payload];
  const merged = getMergedWallets();
  const lookup = new Map(merged.map((w) => [w.address, { address: w.address, name: w.name, tier: w.tier }]));
  let processed = 0;

  for (const tx of txs) {
    if (!tx || tx.type !== 'SWAP') continue;
    const feePayer = tx.feePayer;
    if (feePayer && lookup.has(feePayer)) {
      await ingestEnhancedSwap(lookup.get(feePayer), tx);
      processed += 1;
    }
  }
  return { ok: true, processed };
}

function getPingerStatus() {
  return {
    running: state.running,
    pollIntervalSec: state.pollIntervalSec,
    windowMinutes: state.windowMinutes,
    minConsensusWallets: state.minConsensusWallets,
    watchlistCount: state.watchlist.length,
    watchlist: state.watchlist,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    pings: state.pings.slice(0, 100),
    consensus: state.consensus.slice(0, 60)
  };
}

module.exports = {
  startPinger,
  stopPinger,
  handleHeliusWebhook,
  getPingerStatus
};
