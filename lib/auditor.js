const fs = require('fs');
const path = require('path');
const { DATA_DIR, loadEnv } = require('./env');
const { BASE_MINTS, getInvestigationLinks, getKnownEntity } = require('./known-entities');
const { getVerifiedKol } = require('./kol-registry');
const {
  getMultipleBalances,
  getSignaturesForAddress,
  getEnhancedTransactions,
  scanParsedEvents
} = require('./helius');

const AUDIT_FILE = path.join(DATA_DIR, 'audit-results.json');

const jobState = {
  running: false,
  stage: null,
  stopRequested: false,
  total: 0,
  processed: 0,
  currentWallet: '',
  startedAt: null,
  lastError: null
};

function loadWalletList() {
  const env = loadEnv();
  const filePath = env.WALLET_LIST_PATH;
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const addr = (item.trackedWalletAddress || item.address || '').trim();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    list.push({
      address: addr,
      name: item.name || addr.slice(0, 6),
      emoji: item.emoji || '👀',
      alertsOn: Boolean(item.alertsOn),
      raw: item
    });
  }
  return list;
}

function loadAuditStore() {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    }
  } catch {}
  return { updatedAt: null, wallets: {} };
}

function saveAuditStore(store) {
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function classifyWalletPersona(address, saved) {
  const kol = getVerifiedKol(address);
  const ent = getKnownEntity(address);
  const d = saved?.deep || null;

  // Identity (Verified On-Chain)
  let identity = { kind: 'ANON', label: '', handle: '', verified: false };
  if (kol) {
    identity = {
      kind: kol.group, // KOL | KOL_ALT | FOUNDER
      label: kol.group === 'KOL' ? `👑 KOL (${kol.handle})` : kol.group === 'FOUNDER' ? `🏛 ${kol.name} (${kol.handle})` : `👥 KOL ALT (${kol.handle})`,
      handle: kol.handle,
      name: kol.name,
      verified: true
    };
  } else if (ent && (ent.type === 'CEX' || ent.type === 'BRIDGE')) {
    identity = { kind: ent.type, label: `🏦 ${ent.label}`, handle: '', verified: true };
  }

  // Compute Cadence: Swaps/Day (preferred for trading style) & Total Tx/Day
  let txPerDay = null;
  let txPerWeek = null;
  let swapsPerDay = null;
  if (d && d.totalTxAnalyzed > 0) {
    let spanDays = d.spanDays;
    if ((!spanDays || spanDays <= 0) && d.newestTs && d.oldestTs && d.newestTs > d.oldestTs) {
      spanDays = (d.newestTs - d.oldestTs) / 86400;
    }
    if (spanDays && spanDays > 0.01) {
      txPerDay = Number((d.totalTxAnalyzed / spanDays).toFixed(1));
      swapsPerDay = Number(((d.swapTxCount || d.totalTxAnalyzed) / spanDays).toFixed(1));
      txPerWeek = Math.round(swapsPerDay * 7);
    }
  } else if (typeof saved?.txsPerHour === 'number' && saved.txsPerHour > 0) {
    txPerDay = Number((saved.txsPerHour * 24).toFixed(1));
    swapsPerDay = txPerDay;
    txPerWeek = Math.round(txPerDay * 7);
  }

  const activeRateDay = swapsPerDay !== null ? swapsPerDay : txPerDay;
  const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
  const cadenceLabel = activeRateDay !== null ? `${activeRateDay >= 10 ? Math.round(activeRateDay) : activeRateDay}/d (~${fmtNum(txPerWeek)}/w)` : '-';

  // Trader Style / Archetype (Bevan / Narrative Alpha Style)
  let style = { code: 'UNKNOWN', label: 'Unscanned', desc: '' };
  const hold = d?.medianHoldSec ?? null;
  const wr = d?.winRate ?? 0;
  const net = d ? (typeof d.strictNetFlowSol === 'number' ? d.strictNetFlowSol : d.realizedPnlSol) : 0;
  const isKol = Boolean(kol);

  if (ent && (ent.type === 'CEX' || ent.type === 'BRIDGE')) {
    style = { code: 'VAULT', label: '🏦 Exchange / Bridge', desc: 'Hot wallet / bridge — bukan trader personal' };
  } else if (saved?.stage1Status === 'EMPTY' || saved?.stage1Status === 'DORMANT') {
    style = { code: 'DORMANT', label: '💤 Dormant / Empty', desc: 'Tidak aktif >14 hari atau saldo kosong' };
  } else if (d && d.closedTokens >= 3) {
    if (!isKol && hold !== null && hold < 8 && (activeRateDay === null || activeRateDay >= 120)) {
      style = { code: 'AUTO_BOT', label: '🤖 MEV / Auto Bot', desc: 'Kecepatan mesin <8s & non-KOL — tidak bisa di-copy manual' };
    } else if (activeRateDay !== null && activeRateDay >= 60) {
      style = {
        code: 'HYPER_SCALPER',
        label: isKol ? '⚡ KOL Hyper Scalper' : '⚡ Hyper Scalper',
        desc: `Frekuensi sangat tinggi (${cadenceLabel}) — scalper agresif, wajib cek Full 7D/GMGN!`
      };
    } else if (wr >= 55 && net > 0 && (hold === null || hold >= 30) && (activeRateDay === null || activeRateDay <= 45)) {
      style = {
        code: 'SHARP_SNIPER',
        label: isKol ? '🎯 KOL Sharp Sniper' : '🎯 Sharp Sniper',
        desc: `Sekali nembak akurasi tinggi (${wr}% WR, +${net.toFixed(1)} SOL, ${cadenceLabel}) & sehat!`
      };
    } else if (hold !== null && hold >= 600 && (activeRateDay === null || activeRateDay <= 55)) {
      style = {
        code: 'SWING',
        label: isKol ? '💎 KOL Swing' : '💎 Conviction Swing',
        desc: `Sabar hold panjang (Med ${Math.round(hold / 60)}m, ${cadenceLabel}), sangat nyaman di-copy manusia`
      };
    } else if (hold !== null && hold < 45) {
      style = {
        code: 'FAST_SCALPER',
        label: isKol ? '⚡ KOL Fast Scalper' : '⚡ Fast Scalper',
        desc: `Entry-exit cepat (${Math.round(hold)}s hold) — butuh eksekusi sigap`
      };
    } else {
      style = {
        code: 'INTRADAY',
        label: '📊 Intraday Trader',
        desc: `Aktivitas harian normal (${cadenceLabel})`
      };
    }
  } else if (activeRateDay !== null && activeRateDay >= 120) {
    style = isKol
      ? { code: 'HYPER_SCALPER', label: '⚡ KOL Hyper Scalper', desc: `KOL super aktif (${cadenceLabel})` }
      : { code: 'AUTO_BOT', label: '🤖 High-Freq Bot', desc: `Spam transaksi (${cadenceLabel})` };
  } else if (saved?.stage1Status === 'ACTIVE') {
    style = { code: 'ACTIVE', label: '🟢 Active Trader', desc: 'Belum di-Deep Audit' };
  }

  // Never mislabel a Verified KOL as BOT_SNIPER / BOT_SPAM!
  let adjustedTier = saved?.tier || saved?.stage1Status || 'UNSCANNED';
  if (isKol && (adjustedTier === 'BOT_SNIPER' || adjustedTier === 'BOT_SPAM')) {
    adjustedTier = net > 0 ? 'KOL_SCALPER' : 'LOSER';
  }

  return {
    identity,
    style,
    cadence: { txPerDay, txPerWeek, label: cadenceLabel },
    adjustedTier
  };
}

function getMergedWallets() {
  const list = loadWalletList();
  const store = loadAuditStore();
  return list.map((w) => {
    const saved = store.wallets[w.address] || {};
    const persona = classifyWalletPersona(w.address, saved);
    return {
      address: w.address,
      name: w.name,
      emoji: w.emoji,
      alertsOn: w.alertsOn,
      solBalance: saved.solBalance ?? null,
      lastTxTime: saved.lastTxTime ?? null,
      daysInactive: saved.lastTxTime
        ? Number(((Date.now() / 1000 - saved.lastTxTime) / 86400).toFixed(2))
        : null,
      recentTxCount: saved.recentTxCount ?? null,
      txsPerHour: saved.txsPerHour ?? null,
      stage1Status: saved.stage1Status || 'UNSCANNED',
      stage2Done: Boolean(saved.stage2Done),
      deep: saved.deep || null,
      tier: persona.adjustedTier,
      identity: persona.identity,
      style: persona.style,
      cadence: persona.cadence,
      copyScore: saved.deep?.copyScore ?? null
    };
  });
}

function computeSummary(wallets) {
  const total = wallets.length;
  const scannedS1 = wallets.filter((w) => w.stage1Status !== 'UNSCANNED').length;
  const scannedS2 = wallets.filter((w) => w.stage2Done).length;

  const counts = {
    ELITE: 0,
    GOOD: 0,
    KOL_SCALPER: 0,
    AVERAGE: 0,
    BOT_SNIPER: 0,
    LOSER: 0,
    ACTIVE: 0,
    BOT_SPAM: 0,
    DORMANT: 0,
    EMPTY: 0,
    UNSCANNED: 0
  };
  const styleCounts = {
    SHARP_SNIPER: 0,
    SWING: 0,
    HYPER_SCALPER: 0,
    FAST_SCALPER: 0,
    INTRADAY: 0,
    AUTO_BOT: 0,
    VERIFIED_KOLS: 0
  };

  let totalSolTracked = 0;
  for (const w of wallets) {
    if (typeof w.solBalance === 'number') totalSolTracked += w.solBalance;
    if (counts[w.tier] !== undefined) counts[w.tier] += 1;
    else counts.UNSCANNED += 1;
    if (w.identity?.verified && (w.identity.kind === 'KOL' || w.identity.kind === 'KOL_ALT' || w.identity.kind === 'FOUNDER')) {
      styleCounts.VERIFIED_KOLS += 1;
    }
    if (w.style?.code && styleCounts[w.style.code] !== undefined) {
      styleCounts[w.style.code] += 1;
    }
  }

  const tierOrder = { ELITE: 3, GOOD: 2, KOL_SCALPER: 1 };

  // Leaderboard ONLY shows genuinely copyable ELITE & GOOD wallets (zero LOSER/BOT clutter!)
  const topElite = wallets
    .filter((w) => w.stage2Done && w.deep && (w.tier === 'ELITE' || w.tier === 'GOOD'))
    .sort((a, b) => {
      const ta = tierOrder[a.tier] || 0;
      const tb = tierOrder[b.tier] || 0;
      if (tb !== ta) return tb - ta;
      if ((b.deep.gatesPassed || 0) !== (a.deep.gatesPassed || 0)) {
        return (b.deep.gatesPassed || 0) - (a.deep.gatesPassed || 0);
      }
      return (b.deep.copyScore || 0) - (a.deep.copyScore || 0);
    })
    .slice(0, 50);

  // Separate Radar table for Verified KOLs with positive realized PnL or Hyper Scalper activity
  const kolRadar = wallets
    .filter((w) => w.stage2Done && w.deep && (
      w.tier === 'KOL_SCALPER' ||
      (w.identity?.verified && ['KOL', 'KOL_ALT'].includes(w.identity.kind) && w.tier !== 'ELITE' && w.tier !== 'GOOD' && (w.deep.realizedPnlSol || 0) > 0)
    ))
    .sort((a, b) => (b.deep.realizedPnlSol || 0) - (a.deep.realizedPnlSol || 0))
    .slice(0, 25);

  return {
    total,
    scannedS1,
    scannedS2,
    totalSolTracked: Number(totalSolTracked.toFixed(2)),
    counts,
    styleCounts,
    topElite,
    kolRadar
  };
}

// Convert Helius v1/parsed-events/scan item into the same normalized shape as Enhanced Transactions
function normalizeParsedEventTx(item, targetAddr) {
  const p = item?.parsed;
  if (!p || p.error) return null;
  if (p.feePayer !== targetAddr) return null; // Drop spoof txs where someone else included targetAddr as read-only!

  const WSOL = 'So11111111111111111111111111111111111111112';
  let netSolLamports = -(p.fee || 0);
  for (const nt of p.nativeTransfers || []) {
    if (nt.toUserAccount === targetAddr) netSolLamports += Number(nt.amount || 0);
    if (nt.fromUserAccount === targetAddr) netSolLamports -= Number(nt.amount || 0);
  }

  const tokenTransfers = [];
  for (const tt of p.tokenTransfers || []) {
    const dec = tt.decimals ?? 6;
    const amt = Number(tt.rawTokenAmount || 0) / Math.pow(10, dec);
    if (tt.mint === WSOL) {
      // Account for WSOL flows directly into netSolLamports if not already wrapped/unwrapped via nativeTransfers
      const hasNativeMirror = (p.nativeTransfers || []).some(
        (nt) => Math.abs(Number(nt.amount || 0) - Number(tt.rawTokenAmount || 0)) < 5000000
      );
      if (!hasNativeMirror) {
        if (tt.toUserAccount === targetAddr) netSolLamports += Number(tt.rawTokenAmount || 0);
        if (tt.fromUserAccount === targetAddr) netSolLamports -= Number(tt.rawTokenAmount || 0);
      }
    }
    tokenTransfers.push({
      mint: tt.mint,
      fromUserAccount: tt.fromUserAccount,
      toUserAccount: tt.toUserAccount,
      tokenAmount: amt
    });
  }

  return {
    signature: item.signature,
    timestamp: p.blockTime || 0,
    type: 'SWAP',
    fee: p.fee || 0,
    feePayer: p.feePayer,
    transactionError: p.error || null,
    nativeTransfers: p.nativeTransfers || [],
    tokenTransfers,
    accountData: [{ account: targetAddr, nativeBalanceChange: netSolLamports }]
  };
}

// Anti-Spoof Accelerator using Helius v1/parsed-events/scan (blasts through 10,000+ spoof/dust txs for ~15 credits!)
async function fetchViaParsedEventsScan(address, { windowDays = 7, maxScans = 6, maxMatches = 250 } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = windowDays > 0 ? nowSec - windowDays * 86400 : 0;
  const dexPrograms = [
    { programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' }, // Pump.fun
    { programId: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' }, // PumpSwap AMM
    { programId: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj' }, // Raydium LaunchLab
    { programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' }, // Raydium AMM
    { programId: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK' }, // Raydium CLMM
    { programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo' }, // Meteora DLMM
    { programId: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN' }, // Meteora DBC
    { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }  // Jupiter v6
  ];

  const all = [];
  let paginationToken = undefined;
  let reachedCutoff = false;

  for (let i = 0; i < maxScans; i++) {
    const res = await scanParsedEvents(address, {
      programs: dexPrograms,
      paginationToken,
      maxScannedTransactions: 10000,
      limit: 100
    });

    for (const item of res.data || []) {
      const norm = normalizeParsedEventTx(item, address);
      if (!norm) continue;
      if (cutoffSec > 0 && norm.timestamp && norm.timestamp < cutoffSec) {
        reachedCutoff = true;
        break;
      }
      all.push(norm);
    }

    const scannedBlockTime = res?.scan?.scannedThrough?.blockTime || 0;
    if (cutoffSec > 0 && scannedBlockTime > 0 && scannedBlockTime < cutoffSec) {
      reachedCutoff = true;
      break;
    }
    if (reachedCutoff || all.length >= maxMatches || !res.paginationToken) break;
    paginationToken = res.paginationToken;
  }

  return { txs: all, reachedCutoff, windowDays };
}

// Strict timeframe pagination with automatic Anti-Spoof fallback to v1/parsed-events/scan
// Solves spoof/dust-flooded KOLs like decu, cented, jijo, cupseyy!
async function fetchTransactionsByWindow(address, { windowDays = 7, maxPages = 3 } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = windowDays > 0 ? nowSec - windowDays * 86400 : 0;
  const all = [];
  let before = undefined;
  let reachedCutoff = false;

  for (let page = 0; page < maxPages; page++) {
    let batch = [];
    try {
      batch = await getEnhancedTransactions(address, { limit: 100, before });
    } catch {
      break;
    }
    if (!batch || batch.length === 0) {
      reachedCutoff = true;
      break;
    }

    // Check on page 0 if wallet is flooded by read-only spoof/dust spam (feePayer !== address!)
    if (page === 0) {
      const ownTxs = batch.filter((tx) => tx.feePayer === address);
      if (batch.length >= 50 && ownTxs.length < 10) {
        // SPOOF/DUST FLOOD DETECTED (e.g. decu, cented, jijo, cupseyy) -> switch to 10,000-tx server-side scanner!
        return fetchViaParsedEventsScan(address, {
          windowDays,
          maxScans: Math.max(5, maxPages * 2),
          maxMatches: maxPages * 100
        });
      }
    }

    for (const tx of batch) {
      if (cutoffSec > 0 && tx.timestamp && tx.timestamp < cutoffSec) {
        reachedCutoff = true;
        break;
      }
      if (tx.feePayer === address) all.push(tx);
    }
    if (reachedCutoff || batch.length < 100) break;
    before = batch[batch.length - 1].signature;
  }

  return { txs: all, reachedCutoff, windowDays };
}

// Institutional 4-Gate Forensic Analyzer (Fixes Sold>Bought distortion & Unsold Bag blindspots!)
function analyzeEnhancedTransactions(address, txs, { windowDays = 7, reachedCutoff = true } = {}) {
  const tokenMap = new Map();
  const dailyMap = new Map(); // YYYY-MM-DD -> { pnlSol, buys, sells }
  let totalFeesSol = 0;
  let swapTxCount = 0;
  let totalTxAnalyzed = txs.length;
  let newestTs = 0;
  let oldestTs = Infinity;

  const ordered = [...txs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  for (const tx of ordered) {
    if (tx.transactionError) continue;
    const ts = tx.timestamp || 0;
    if (ts > newestTs) newestTs = ts;
    if (ts && ts < oldestTs) oldestTs = ts;

    const feeSol = (tx.fee || 0) / 1e9;
    totalFeesSol += feeSol;

    let netSolDelta = 0;
    const accEntry = (tx.accountData || []).find((a) => a.account === address);
    if (accEntry && typeof accEntry.nativeBalanceChange === 'number') {
      netSolDelta = accEntry.nativeBalanceChange / 1e9;
    } else {
      for (const nt of tx.nativeTransfers || []) {
        if (nt.toUserAccount === address) netSolDelta += (nt.amount || 0) / 1e9;
        if (nt.fromUserAccount === address) netSolDelta -= (nt.amount || 0) / 1e9;
      }
    }

    // Check persistent WSOL ATA changes across all accountData entries (handles Axiom/Jupiter WSOL pools cleanly;
    // atomic wrap+unwrap ATAs net to 0 so no double-count!)
    for (const ad of tx.accountData || []) {
      for (const tbc of ad.tokenBalanceChanges || []) {
        if (tbc.mint === 'So11111111111111111111111111111111111111112' && tbc.userAccount === address) {
          const dec = tbc.rawTokenAmount?.decimals ?? 9;
          const rawAmt = Number(tbc.rawTokenAmount?.tokenAmount || 0);
          netSolDelta += rawAmt / Math.pow(10, dec);
        }
      }
    }

    const mintDeltas = new Map();
    for (const tt of tx.tokenTransfers || []) {
      if (!tt.mint || BASE_MINTS.has(tt.mint)) continue;
      const amt = Number(tt.tokenAmount || 0);
      if (!amt) continue;
      if (tt.toUserAccount === address) mintDeltas.set(tt.mint, (mintDeltas.get(tt.mint) || 0) + amt);
      if (tt.fromUserAccount === address) mintDeltas.set(tt.mint, (mintDeltas.get(tt.mint) || 0) - amt);
    }

    if (mintDeltas.size === 0) continue;
    // Pick the primary traded token (largest abs token delta — prevents dust/reward tokens like PUMP(+0.001) or spoof dust from hijacking buys/sells!)
    const entries = [...mintDeltas.entries()]
      .filter(([, d]) => Math.abs(d) > 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (entries.length === 0) continue;

    const solMoveExcludingFee = Math.abs(netSolDelta + feeSol);
    if (tx.type !== 'SWAP' && solMoveExcludingFee < 0.005) continue;

    swapTxCount += 1;
    // Prefer a token whose flow direction matches SOL direction (received token when spending SOL, sent token when receiving SOL)
    let chosen = entries[0];
    if (entries.length > 1) {
      const dirMatch = entries.find(([, d]) => (netSolDelta < 0 ? d > 0 : d < 0));
      if (dirMatch) chosen = dirMatch;
    }
    const [mint, delta] = chosen;
    if (!tokenMap.has(mint)) {
      tokenMap.set(mint, {
        mint,
        buys: [],
        sells: [],
        buySol: 0,
        sellSol: 0,
        buyAmt: 0,
        sellAmt: 0
      });
    }
    const rec = tokenMap.get(mint);
    const dayKey = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : 'unknown';
    if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { date: dayKey, netSol: 0, buys: 0, sells: 0 });
    const dayRec = dailyMap.get(dayKey);

    if (delta > 0 && netSolDelta < 0) {
      const spent = Math.abs(netSolDelta);
      rec.buys.push({ ts, sol: spent, amt: delta, sig: tx.signature });
      rec.buySol += spent;
      rec.buyAmt += delta;
      dayRec.buys += 1;
      dayRec.netSol -= spent;
    } else if (delta < 0 && netSolDelta > -0.005) {
      const received = Math.max(0, netSolDelta);
      rec.sells.push({ ts, sol: received, amt: Math.abs(delta), sig: tx.signature });
      rec.sellSol += received;
      rec.sellAmt += Math.abs(delta);
      dayRec.sells += 1;
      dayRec.netSol += received;
    }
  }

  let closedTokens = 0;
  let openTokens = 0;
  let soldOnlyTokens = 0;
  let soldExceedsBoughtCount = 0;
  let wins = 0;
  let losses = 0;
  let realizedPnlSol = 0;
  let openCostSol = 0;
  let totalBuySol = 0;
  let totalMatchedSellSol = 0;
  const holdTimesSec = [];
  const buySizes = [];
  const winPnls = [];
  const tokenSummaries = [];

  for (const rec of tokenMap.values()) {
    if (rec.buys.length === 0) {
      soldOnlyTokens += 1;
      continue;
    }

    totalBuySol += rec.buySol;
    for (const b of rec.buys) buySizes.push(b.sol);

    const firstBuyTs = rec.buys[0].ts;
    const lastSellTs = rec.sells.length > 0 ? rec.sells[rec.sells.length - 1].ts : null;
    const holdSec = lastSellTs && lastSellTs >= firstBuyTs ? lastSellTs - firstBuyTs : null;

    // FIX #1: Prevent Sold > Bought distortion from older pre-window bags!
    let matchedSellSol = rec.sellSol;
    let distorted = false;
    if (rec.sells.length > 0 && rec.sellAmt > rec.buyAmt * 1.15 && rec.buyAmt > 0) {
      distorted = true;
      soldExceedsBoughtCount += 1;
      // Pro-rata match only the amount bought INSIDE this timeframe window!
      matchedSellSol = rec.sellSol * (rec.buyAmt / rec.sellAmt);
    }

    totalMatchedSellSol += matchedSellSol;

    if (rec.sells.length === 0) {
      // FIX #2: Track unsold / open / rugged bags explicitly!
      openTokens += 1;
      openCostSol += rec.buySol;
      tokenSummaries.push({
        mint: rec.mint,
        status: 'OPEN/UNSOLD',
        buySol: Number(rec.buySol.toFixed(4)),
        sellSol: 0,
        pnlSol: Number((-rec.buySol).toFixed(4)),
        roiPct: -100,
        buys: rec.buys.length,
        sells: 0,
        holdSec: null,
        distorted: false,
        lastTs: firstBuyTs
      });
      continue;
    }

    if (holdSec !== null) holdTimesSec.push(holdSec);
    // Match cost proportionally if partially sold (<70%) vs fully closed (>=70%)
    const soldRatio = rec.buyAmt > 0 ? Math.min(1, rec.sellAmt / rec.buyAmt) : 1;
    const matchedCost = rec.buySol * soldRatio;
    const pnl = matchedSellSol - matchedCost;
    const remainingCost = Math.max(0, rec.buySol - matchedCost);
    openCostSol += remainingCost;

    closedTokens += 1;
    realizedPnlSol += pnl;
    if (pnl > 0) {
      wins += 1;
      winPnls.push(pnl);
    } else {
      losses += 1;
    }

    tokenSummaries.push({
      mint: rec.mint,
      status: distorted ? 'SOLD>BOUGHT' : soldRatio >= 0.85 ? 'CLOSED' : 'PARTIAL',
      buySol: Number(rec.buySol.toFixed(4)),
      sellSol: Number(matchedSellSol.toFixed(4)),
      pnlSol: Number(pnl.toFixed(4)),
      roiPct: matchedCost > 0 ? Number(((pnl / matchedCost) * 100).toFixed(1)) : 0,
      buys: rec.buys.length,
      sells: rec.sells.length,
      holdSec,
      distorted,
      lastTs: lastSellTs || firstBuyTs
    });
  }

  tokenSummaries.sort((a, b) => b.lastTs - a.lastTs);

  // Strict Net Cashflow in window (Accounts for dead/rugged unsold bags!)
  const strictNetFlowSol = Number((totalMatchedSellSol - totalBuySol).toFixed(4));
  const totalBoughtTokens = closedTokens + openTokens;
  const winRate = closedTokens > 0 ? Number(((wins / closedTokens) * 100).toFixed(1)) : 0;
  holdTimesSec.sort((a, b) => a - b);
  const medianHoldSec = holdTimesSec.length > 0 ? holdTimesSec[Math.floor(holdTimesSec.length / 2)] : null;
  const avgBuySol = buySizes.length > 0
    ? Number((buySizes.reduce((s, v) => s + v, 0) / buySizes.length).toFixed(3))
    : 0;
  const roiPct = totalBuySol > 0 ? Number(((strictNetFlowSol / totalBuySol) * 100).toFixed(1)) : 0;

  const spanHours = newestTs && oldestTs && oldestTs !== Infinity
    ? Number(((newestTs - oldestTs) / 3600).toFixed(1))
    : 0;
  const spanDays = Number((spanHours / 24).toFixed(2));

  // Concentration / 1-hit wonder check
  const totalGrossWins = winPnls.reduce((s, v) => s + v, 0);
  const maxSingleWin = winPnls.length > 0 ? Math.max(...winPnls) : 0;
  const topWinSharePct = totalGrossWins > 0 ? Number(((maxSingleWin / totalGrossWins) * 100).toFixed(1)) : 0;
  const unsoldBagRatioPct = totalBuySol > 0 ? Number(((openCostSol / totalBuySol) * 100).toFixed(1)) : 0;
  const soldExceedsPct = totalBoughtTokens > 0
    ? Number((((soldExceedsBoughtCount + soldOnlyTokens) / (totalBoughtTokens + soldOnlyTokens)) * 100).toFixed(1))
    : 0;

  // === INSTITUTIONAL 4-GATE CHECK (Modeled after GMGN Giga Beta!) ===
  const fullWindowCovered = reachedCutoff || spanDays >= Math.min(windowDays * 0.75, 4);
  const gates = {
    trustworthy: {
      pass: closedTokens >= 4 && soldExceedsPct < 35 && fullWindowCovered,
      detail: `${closedTokens} closed | Span ${spanDays >= 1 ? spanDays.toFixed(1) + 'd' : spanHours + 'h'}${fullWindowCovered ? ' (Full)' : ' (PARTIAL — hyperactive wallet!)'} | Sold>Bought: ${soldExceedsPct}%`
    },
    earningNow: {
      pass: realizedPnlSol > 0 && strictNetFlowSol > -(totalBuySol * 0.15) && winRate >= 35,
      detail: `Realized ${realizedPnlSol >= 0 ? '+' : ''}${realizedPnlSol.toFixed(2)} SOL | Net Cashflow ${strictNetFlowSol >= 0 ? '+' : ''}${strictNetFlowSol.toFixed(2)} SOL | WR ${winRate}%`
    },
    fillable: {
      pass: medianHoldSec !== null && medianHoldSec >= 25 && avgBuySol >= 0.15 && avgBuySol <= 50,
      detail: `Med Hold ${medianHoldSec !== null ? Math.round(medianHoldSec) + 's' : '-'} | Avg Buy ${avgBuySol} SOL`
    },
    cutsLosses: {
      pass: unsoldBagRatioPct < 45 && (wins <= 2 || topWinSharePct < 85),
      detail: `Unsold/Dead Bag ${unsoldBagRatioPct}% (${openTokens} open) | Top-1 Win Share ${topWinSharePct}%`
    }
  };

  const gatesPassed = Object.values(gates).filter((g) => g.pass).length;

  let copyScore = 0;
  const flags = [];

  if (closedTokens >= 3) {
    copyScore += Math.min(28, (winRate / 65) * 28);
    if (realizedPnlSol > 0 && strictNetFlowSol > 0) {
      copyScore += Math.min(30, Math.log10(1 + strictNetFlowSol * 2) * 20);
    } else if (realizedPnlSol > 0 && strictNetFlowSol <= 0) {
      // Holding heavy dead/unsold bags!
      copyScore += 6;
      flags.push('HEAVY_UNSOLD_BAGS');
    } else {
      copyScore -= Math.min(25, Math.abs(strictNetFlowSol) * 4);
    }

    if (medianHoldSec !== null) {
      if (medianHoldSec < 15) {
        copyScore -= 40;
        flags.push('BOT_SNIPER (<15s)');
      } else if (medianHoldSec < 30) {
        copyScore += 4;
        flags.push('FAST_SCALPER');
      } else if (medianHoldSec <= 3600) {
        copyScore += 24;
        flags.push('HUMAN_COPYABLE');
      } else {
        copyScore += 18;
        flags.push('SWING_HOLDER');
      }
    }

    if (avgBuySol >= 0.4 && avgBuySol <= 50) copyScore += 14;
    else if (avgBuySol >= 0.15) copyScore += 8;
    else {
      copyScore -= 10;
      flags.push('MICRO_SIZE');
    }

    if (unsoldBagRatioPct >= 45) {
      copyScore -= 15;
      flags.push('DOES_NOT_CUT_LOSS');
    }
    if (topWinSharePct >= 85 && wins >= 3) {
      copyScore -= 12;
      flags.push('ONE_HIT_WONDER');
    }
    if (soldExceedsPct >= 30) {
      copyScore -= 10;
      flags.push('SOLD_EXCEEDS_BOUGHT');
    }
    if (!fullWindowCovered) {
      copyScore -= 18;
      flags.push(`PARTIAL_WINDOW (${spanHours}h < ${windowDays}d)`);
    }
  } else {
    flags.push('LOW_SAMPLE');
  }

  copyScore = Math.max(0, Math.min(100, Math.round(copyScore)));

  const kol = getVerifiedKol(address);
  let tier = 'AVERAGE';
  let verdict = 'NEUTRAL — Low sample / insufficient edge';
  if (medianHoldSec !== null && medianHoldSec < 15 && closedTokens >= 3) {
    if (kol) {
      tier = strictNetFlowSol > 0 ? 'KOL_SCALPER' : 'LOSER';
      verdict = strictNetFlowSol > 0
        ? `VERIFIED KOL (${kol.handle}) — Hyper/Fast Scalper (${Math.round(medianHoldSec)}s hold, hati-hati slippage!)`
        : `VERIFIED KOL (${kol.handle}) — Fast Scalper sedang bleeding`;
    } else {
      tier = 'BOT_SNIPER';
      verdict = 'DO NOT COPY — Non-KOL Auto/Sniper Bot (<15s hold)';
    }
  } else if (gatesPassed === 4 && copyScore >= 65) {
    tier = 'ELITE';
    verdict = kol ? `VERIFIED KOL (${kol.handle}) — COPYABLE ELITE (4/4 Gates)` : 'COPYABLE ELITE — Passed 4/4 Gates';
  } else if (gates.earningNow.pass && gates.fillable.pass && gatesPassed >= 3 && copyScore >= 50) {
    tier = 'GOOD';
    verdict = `GOOD WATCHLIST — Passed ${gatesPassed}/4 Gates`;
  } else if (closedTokens >= 3 && (!gates.earningNow.pass || strictNetFlowSol < 0)) {
    tier = 'LOSER';
    verdict = kol ? `VERIFIED KOL (${kol.handle}) — Bleeding / Stopped Earning Recently` : 'DO NOT COPY — Bleeding / Stopped Earning Recently';
  }

  const dailyPnl = [...dailyMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((d) => ({ ...d, netSol: Number(d.netSol.toFixed(3)) }));

  return {
    windowDays,
    reachedCutoff,
    spanHours,
    spanDays,
    totalTxAnalyzed,
    swapTxCount,
    uniqueTokens: tokenMap.size,
    closedTokens,
    openTokens,
    soldOnlyTokens,
    soldExceedsBoughtCount,
    soldExceedsPct,
    wins,
    losses,
    winRate,
    realizedPnlSol: Number(realizedPnlSol.toFixed(4)),
    strictNetFlowSol,
    openCostSol: Number(openCostSol.toFixed(4)),
    unsoldBagRatioPct,
    topWinSharePct,
    totalBuySol: Number(totalBuySol.toFixed(4)),
    totalSellSol: Number(totalMatchedSellSol.toFixed(4)),
    roiPct,
    avgBuySol,
    medianHoldSec,
    totalFeesSol: Number(totalFeesSol.toFixed(4)),
    copyScore,
    gatesPassed,
    gates,
    tier,
    verdict,
    flags,
    newestTs,
    oldestTs: oldestTs === Infinity ? null : oldestTs,
    dailyPnl,
    recentTokens: tokenSummaries.slice(0, 15)
  };
}

async function investigateWallet(address, { windowDays = 7, maxPages = 4 } = {}) {
  const addr = address.trim();
  const [bals, fetched] = await Promise.all([
    getMultipleBalances([addr]),
    fetchTransactionsByWindow(addr, { windowDays, maxPages })
  ]);
  const deep = analyzeEnhancedTransactions(addr, fetched.txs, {
    windowDays,
    reachedCutoff: fetched.reachedCutoff
  });
  const persona = classifyWalletPersona(addr, { deep, tier: deep.tier });
  return {
    address: addr,
    solBalance: Number((bals.get(addr) || 0).toFixed(4)),
    deep,
    identity: persona.identity,
    style: persona.style,
    cadence: persona.cadence,
    links: getInvestigationLinks(addr)
  };
}

async function runStage1Triage({ forceAll = false } = {}) {
  if (jobState.running) throw new Error('Audit sedang berjalan.');
  const list = loadWalletList();
  if (list.length === 0) throw new Error('List wallet kosong atau file JSON tidak ditemukan.');

  const store = loadAuditStore();
  const targets = forceAll
    ? list
    : list.filter((w) => !store.wallets[w.address] || store.wallets[w.address].stage1Status === 'UNSCANNED');

  jobState.running = true;
  jobState.stage = 'stage1';
  jobState.stopRequested = false;
  jobState.total = targets.length;
  jobState.processed = 0;
  jobState.startedAt = Date.now();
  jobState.lastError = null;

  try {
    jobState.currentWallet = `Fetching SOL balances (${targets.length} wallets)...`;
    const balances = await getMultipleBalances(targets.map((w) => w.address));
    const nowSec = Math.floor(Date.now() / 1000);

    for (let i = 0; i < targets.length; i++) {
      if (jobState.stopRequested) break;
      const w = targets[i];
      jobState.currentWallet = `${w.name} (${w.address.slice(0, 6)}...)`;
      const bal = Number((balances.get(w.address) || 0).toFixed(4));

      try {
        const sigs = await getSignaturesForAddress(w.address, 25);
        const lastTxTime = sigs?.[0]?.blockTime || null;
        const oldestSigTime = sigs?.[sigs.length - 1]?.blockTime || null;
        const daysInactive = lastTxTime ? (nowSec - lastTxTime) / 86400 : 9999;

        let txsPerHour = 0;
        if (sigs && sigs.length >= 2 && lastTxTime && oldestSigTime) {
          const spanHrs = Math.max(0.01, (lastTxTime - oldestSigTime) / 3600);
          txsPerHour = Number((sigs.length / spanHrs).toFixed(2));
        }

        let stage1Status = 'ACTIVE';
        if (!lastTxTime || (bal < 0.05 && daysInactive > 7)) stage1Status = 'EMPTY';
        else if (daysInactive > 14) stage1Status = 'DORMANT';
        // NOTE: Do NOT mark high-tx famous wallets as BOT_SPAM in Stage 1 because spam-dust bots
        // bombard KOLs like decu/cupsey/cented with 25 dust txs/sec! Let Stage 2 Enhanced Swaps judge!

        const prev = store.wallets[w.address] || {};
        store.wallets[w.address] = {
          ...prev,
          solBalance: bal,
          lastTxTime,
          recentTxCount: sigs?.length || 0,
          txsPerHour,
          stage1Status,
          tier: prev.stage2Done ? prev.tier : stage1Status
        };
      } catch (err) {
        jobState.lastError = `${w.name}: ${err.message}`;
      }

      jobState.processed = i + 1;
      if ((i + 1) % 20 === 0 || i === targets.length - 1) saveAuditStore(store);
    }
    saveAuditStore(store);
  } finally {
    jobState.running = false;
    jobState.stage = null;
    jobState.currentWallet = '';
  }
}

async function runStage2DeepAudit({
  maxWallets = 50,
  minSol = 0.2,
  onlyActiveDays = 14,
  windowDays = 7,
  maxPages = 3,
  reAuditExisting = false,
  specificAddresses = null
} = {}) {
  if (jobState.running) throw new Error('Audit sedang berjalan.');
  const merged = getMergedWallets();
  const store = loadAuditStore();

  let targets = [];
  if (Array.isArray(specificAddresses) && specificAddresses.length > 0) {
    const set = new Set(specificAddresses);
    targets = merged.filter((w) => set.has(w.address));
    // Also allow auditing an address not in the 927 list!
    for (const addr of specificAddresses) {
      if (!targets.some((t) => t.address === addr)) {
        targets.push({ address: addr, name: addr.slice(0, 6) });
      }
    }
  } else {
    targets = merged
      .filter((w) => {
        if (!reAuditExisting && w.stage2Done) return false;
        if (w.stage1Status === 'EMPTY' || w.stage1Status === 'DORMANT') return false;
        if (w.identity?.kind === 'CEX' || w.identity?.kind === 'BRIDGE') return false;
        const bal = w.solBalance || 0;
        const okSol = bal >= minSol && bal <= 5000;
        const okDays = w.daysInactive !== null && w.daysInactive <= onlyActiveDays;
        const okActivity = (w.recentTxCount || 0) >= 8;
        return okSol && okDays && okActivity;
      })
      .sort((a, b) => (b.lastTxTime || 0) - (a.lastTxTime || 0))
      .slice(0, maxWallets);
  }

  if (targets.length === 0) {
    throw new Error('Tidak ada wallet target untuk Deep Audit.');
  }

  jobState.running = true;
  jobState.stage = 'stage2';
  jobState.stopRequested = false;
  jobState.total = targets.length;
  jobState.processed = 0;
  jobState.startedAt = Date.now();
  jobState.lastError = null;

  try {
    for (let i = 0; i < targets.length; i++) {
      if (jobState.stopRequested) break;
      const w = targets[i];
      jobState.currentWallet = `Strict ${windowDays}D Audit: ${w.name} (${w.address.slice(0, 6)}...)`;

      try {
        const fetched = await fetchTransactionsByWindow(w.address, { windowDays, maxPages });
        const deep = analyzeEnhancedTransactions(w.address, fetched.txs, {
          windowDays,
          reachedCutoff: fetched.reachedCutoff
        });
        const prev = store.wallets[w.address] || {};
        store.wallets[w.address] = {
          ...prev,
          stage2Done: true,
          deep,
          tier: deep.tier
        };
      } catch (err) {
        jobState.lastError = `${w.name}: ${err.message}`;
      }

      jobState.processed = i + 1;
      saveAuditStore(store);
    }
  } finally {
    jobState.running = false;
    jobState.stage = null;
    jobState.currentWallet = '';
  }
}

function stopAudit() {
  jobState.stopRequested = true;
}

function getJobState() {
  return { ...jobState };
}

function exportPadreJson({ topN = 50, minScore = 50, includeGood = true } = {}) {
  const wallets = getMergedWallets();
  const eligible = wallets
    .filter((w) => {
      if (!w.stage2Done || !w.deep) return false;
      if (w.tier === 'BOT_SNIPER' || w.tier === 'LOSER') return false;
      if (!includeGood && w.tier !== 'ELITE') return false;
      return (w.deep.copyScore || 0) >= minScore;
    })
    .sort((a, b) => (b.deep.copyScore || 0) - (a.deep.copyScore || 0))
    .slice(0, topN);

  return eligible.map((w) => ({
    trackedWalletAddress: w.address,
    name: `${w.name} [G${w.deep.gatesPassed || 0}/4|S${w.deep.copyScore}|WR${Math.round(w.deep.winRate)}%]`,
    emoji: w.tier === 'ELITE' ? '👑' : '⚡',
    alertsOn: w.tier === 'ELITE',
    transferAlertsOn: true,
    onTransfers: false,
    highlighted: w.tier === 'ELITE',
    highlightColor: w.tier === 'ELITE' ? '#00e599' : null,
    soundEffect: w.tier === 'ELITE' ? 'DING' : null,
    transferSoundEffect: null
  }));
}

module.exports = {
  loadWalletList,
  getMergedWallets,
  computeSummary,
  runStage1Triage,
  runStage2DeepAudit,
  investigateWallet,
  stopAudit,
  getJobState,
  exportPadreJson,
  analyzeEnhancedTransactions
};
