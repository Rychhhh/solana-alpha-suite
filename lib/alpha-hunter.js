const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./env');
const { BASE_MINTS, isIgnoredForSideWallet, getInvestigationLinks } = require('./known-entities');
const {
  getEnhancedTransactions,
  getDexScreenerToken
} = require('./helius');
const { investigateWallet, loadWalletList } = require('./auditor');

const ALPHA_FILE = path.join(DATA_DIR, 'alpha-discovered.json');

const huntState = {
  running: false,
  stopRequested: false,
  step: '',
  processed: 0,
  total: 0,
  lastError: null
};

function loadDiscovered() {
  try {
    if (fs.existsSync(ALPHA_FILE)) {
      return JSON.parse(fs.readFileSync(ALPHA_FILE, 'utf8'));
    }
  } catch {}
  return { updatedAt: null, runnersAnalyzed: [], wallets: [] };
}

function saveDiscovered(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(ALPHA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Fetch live trending / boosted Solana memecoin runners from DexScreener (0 Helius credits!)
async function fetchTrendingSolanaRunners() {
  const mints = new Set();
  try {
    const [r1, r2] = await Promise.all([
      fetch('https://api.dexscreener.com/token-boosts/top/v1').then((r) => (r.ok ? r.json() : [])),
      fetch('https://api.dexscreener.com/token-profiles/latest/v1').then((r) => (r.ok ? r.json() : []))
    ]);
    for (const item of [...(Array.isArray(r1) ? r1 : []), ...(Array.isArray(r2) ? r2 : [])]) {
      if (item.chainId === 'solana' && item.tokenAddress && !BASE_MINTS.has(item.tokenAddress)) {
        mints.add(item.tokenAddress);
      }
      if (mints.size >= 24) break;
    }
  } catch {}

  const list = [...mints];
  if (list.length === 0) return [];

  const runners = [];
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${list.join(',')}`);
    if (!res.ok) return [];
    const pairs = await res.json();
    const bestByMint = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const m = p.baseToken?.address;
      if (!m) continue;
      const cur = bestByMint.get(m);
      if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) {
        bestByMint.set(m, p);
      }
    }
    for (const p of bestByMint.values()) {
      const mc = Number(p.marketCap || p.fdv || 0);
      const vol24 = Number(p.volume?.h24 || 0);
      if (mc < 40_000 || vol24 < 30_000) continue;
      runners.push({
        mint: p.baseToken.address,
        pairAddress: p.pairAddress,
        symbol: p.baseToken.symbol || p.baseToken.address.slice(0, 6),
        name: p.baseToken.name || '',
        marketCap: mc,
        liquidityUsd: Number(p.liquidity?.usd || 0),
        volume24h: vol24,
        priceChange24h: Number(p.priceChange?.h24 || 0),
        dexId: p.dexId || '',
        url: p.url || `https://dexscreener.com/solana/${p.baseToken.address}`
      });
    }
    runners.sort((a, b) => b.volume24h - a.volume24h);
  } catch {}

  return runners.slice(0, 15);
}

// Bevan-style Alpha Hunter:
// 1. Takes 1-5 winning/runner Solana token CAs
// 2. Pulls real buyers/traders from their on-chain swaps (mint / primary pool)
// 3. Ranks wallets by Cross-Runner Overlap (bought >= 2 runners!) & SOL buy size
// 4. Runs Strict 7D 4-Gate Institutional Audit to filter out bots (<15s) & losers!
async function runAlphaHunt({ mints = [], maxCandidates = 18, windowDays = 7, onlyNewOutsideList = false } = {}) {
  if (huntState.running) throw new Error('Alpha Hunter sedang berjalan.');
  const cleanMints = [...new Set(mints.map((m) => m.trim()).filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))].slice(0, 6);
  if (cleanMints.length === 0) throw new Error('Masukkan minimal 1 Solana Token CA yang valid (atau klik Auto-Load Trending Runners).');

  const existingSet = new Set(loadWalletList().map((w) => w.address));

  huntState.running = true;
  huntState.stopRequested = false;
  huntState.step = 'Scanning buyers on winning runner tokens...';
  huntState.processed = 0;
  huntState.total = cleanMints.length + maxCandidates;
  huntState.lastError = null;

  try {
    const candidateMap = new Map(); // walletAddr -> { address, runners: Set, totalSolBought, inMyList }
    const runnersInfo = [];

    for (let i = 0; i < cleanMints.length; i++) {
      if (huntState.stopRequested) break;
      const mint = cleanMints[i];
      const dex = await getDexScreenerToken(mint);
      const sym = dex?.symbol || mint.slice(0, 6);
      runnersInfo.push({ mint, symbol: sym, marketCap: dex?.marketCap || 0 });
      huntState.step = `Extracting buyers from $${sym} (${i + 1}/${cleanMints.length})...`;

      try {
        // Pull swap transactions touching this token mint
        const txs = await getEnhancedTransactions(mint, { limit: 100 });
        for (const tx of txs) {
          if (tx.transactionError) continue;
          const trader = tx.feePayer;
          if (!trader || isIgnoredForSideWallet(trader)) continue;
          if (onlyNewOutsideList && existingSet.has(trader)) continue;

          // Verify trader actually bought this token with SOL >= 0.25 SOL
          const receivedToken = (tx.tokenTransfers || []).some(
            (tt) => tt.mint === mint && tt.toUserAccount === trader && Number(tt.tokenAmount || 0) > 0
          );
          if (!receivedToken) continue;

          const accEntry = (tx.accountData || []).find((a) => a.account === trader);
          const solSpent = accEntry && accEntry.nativeBalanceChange < 0
            ? Math.abs(accEntry.nativeBalanceChange) / 1e9
            : 0;
          if (solSpent < 0.25) continue; // Ignore dust/micro spam buyers

          const cur = candidateMap.get(trader) || {
            address: trader,
            runners: new Set(),
            totalSolBought: 0,
            buysCount: 0,
            inMyList: existingSet.has(trader)
          };
          cur.runners.add(sym);
          cur.totalSolBought += solSpent;
          cur.buysCount += 1;
          candidateMap.set(trader, cur);
        }
      } catch (err) {
        huntState.lastError = `$${sym}: ${err.message}`;
      }
      huntState.processed = i + 1;
    }

    // Prioritize wallets that appeared in MULTIPLE runner coins first, then healthy buy size (0.5 - 30 SOL)
    const rankedCandidates = [...candidateMap.values()]
      .sort((a, b) => {
        if (b.runners.size !== a.runners.size) return b.runners.size - a.runners.size;
        return b.totalSolBought - a.totalSolBought;
      })
      .slice(0, maxCandidates);

    huntState.total = cleanMints.length + rankedCandidates.length;
    const discovered = [];

    for (let j = 0; j < rankedCandidates.length; j++) {
      if (huntState.stopRequested) break;
      const cand = rankedCandidates[j];
      huntState.step = `4-Gate ${windowDays}D Audit: ${cand.address.slice(0, 6)}... (${j + 1}/${rankedCandidates.length})`;

      try {
        const inv = await investigateWallet(cand.address, { windowDays, maxPages: 3 });
        discovered.push({
          address: cand.address,
          inMyList: cand.inMyList,
          runnersHit: [...cand.runners],
          runnersCount: cand.runners.size,
          solBoughtOnRunners: Number(cand.totalSolBought.toFixed(2)),
          solBalance: inv.solBalance,
          deep: inv.deep,
          tier: inv.deep.tier,
          links: getInvestigationLinks(cand.address)
        });
      } catch (err) {
        huntState.lastError = `${cand.address.slice(0, 6)}: ${err.message}`;
      }
      huntState.processed = cleanMints.length + j + 1;
    }

    // Sort by: Multi-runner overlap + 4-Gate Pass + Copy Score
    discovered.sort((a, b) => {
      if ((b.deep.gatesPassed || 0) !== (a.deep.gatesPassed || 0)) {
        return (b.deep.gatesPassed || 0) - (a.deep.gatesPassed || 0);
      }
      if (b.runnersCount !== a.runnersCount) return b.runnersCount - a.runnersCount;
      return (b.deep.copyScore || 0) - (a.deep.copyScore || 0);
    });

    const out = {
      updatedAt: new Date().toISOString(),
      windowDays,
      runnersAnalyzed: runnersInfo,
      totalUniqueBuyersFound: candidateMap.size,
      wallets: discovered
    };
    saveDiscovered(out);
    return out;
  } finally {
    huntState.running = false;
    huntState.step = '';
  }
}

function stopAlphaHunt() {
  huntState.stopRequested = true;
}

function getAlphaHunterState() {
  return {
    job: { ...huntState },
    data: loadDiscovered()
  };
}

function exportAlphaPadreJson() {
  const data = loadDiscovered();
  return (data.wallets || [])
    .filter((w) => w.deep && w.tier !== 'BOT_SNIPER' && w.tier !== 'LOSER' && (w.deep.gatesPassed || 0) >= 3)
    .map((w) => ({
      trackedWalletAddress: w.address,
      name: `ALPHA_${w.runnersHit[0] || 'NEW'} [G${w.deep.gatesPassed}/4|S${w.deep.copyScore}|WR${Math.round(w.deep.winRate)}%]`,
      emoji: '🔥',
      alertsOn: w.tier === 'ELITE',
      transferAlertsOn: true,
      onTransfers: false,
      highlighted: w.tier === 'ELITE',
      highlightColor: '#38bdf8',
      soundEffect: w.tier === 'ELITE' ? 'DING' : null,
      transferSoundEffect: null
    }));
}

module.exports = {
  fetchTrendingSolanaRunners,
  runAlphaHunt,
  stopAlphaHunt,
  getAlphaHunterState,
  exportAlphaPadreJson
};
