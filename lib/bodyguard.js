const fs = require('fs');
const path = require('path');
const { DATA_DIR, loadEnv } = require('./env');
const { rpcCall, getEnhancedTransactions } = require('./helius');

const BODYGUARD_FILE = path.join(DATA_DIR, 'bodyguard-cache.json');
const SCORECARD_FILE = path.join(DATA_DIR, 'scorecard.json');

const WSOL = 'So11111111111111111111111111111111111111112';
const PUMP_MINT = 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';

function getWibNow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 19),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function getWibSessionStatus() {
  const now = getWibNow();
  const m = now.minutesOfDay;
  // Opsi 1 Schedule:
  // 06:45 - 08:30 Wakeup & Morning
  // 08:30 - 17:30 Office SWE (0% Crypto)
  // 17:30 - 19:45 Gym & Dinner (finish dinner <= 19:45)
  // 19:45 - 21:30 Quality Time Call Eizra
  // 21:30 - 23:30 ACTIVE TRENCHING (US Wave 1 - 2h max)
  // 23:30 - 06:45 Sleep Call (7h sleep - Laptop OFF)
  if (m >= 510 && m < 1050) {
    return { code: 'OFFICE', allowed: false, badge: '🏢 OFFICE HOURS (08:30–17:30)', msg: 'Jam kerja SWE — 0% buka Padre/Trenches! (Esee aja 0 tx jam segini.)', color: 'amber', now };
  }
  if (m >= 1050 && m < 1185) {
    return { code: 'GYM_DINNER', allowed: false, badge: '🏋️ GYM & DINNER (17:30–19:45)', msg: 'Waktunya gym/gerak + makan malam selesai sebelum 19:45 WIB (anti-GERD).', color: 'cyan', now };
  }
  if (m >= 1185 && m < 1290) {
    return { code: 'CALL_EIZRA', allowed: false, badge: '📞 CALL EIZRA (19:45–21:30)', msg: 'Quality time fokus tanpa laptop — sesi trading buka tepat 21:30 WIB.', color: 'cyan', now };
  }
  if (m >= 1290 && m < 1410) {
    const minsLeft = 1410 - m;
    return { code: 'TRADING', allowed: true, badge: `⚡ PRIME US WAVE 1 (${minsLeft}m left)`, msg: 'Jendela trading AKTIF (21:30–23:30 WIB). Patuhi bid size, Filter 3-Detik & tutup laptop 23:30!', color: 'green', now };
  }
  if (m >= 405 && m < 510) {
    return { code: 'MORNING', allowed: false, badge: '☀ MORNING ROUTINE (06:45–08:30)', msg: 'Bangun segar, sarapan, siap kerja — jangan buka chart pagi-pagi.', color: 'cyan', now };
  }
  return { code: 'SLEEP', allowed: false, badge: '😴 SLEEP CALL (23:30–06:45)', msg: 'Wajib tutup laptop & tidur penuh 7 jam! Jangan begadang.', color: 'red', now };
}

function getSafeBidSize(effectiveSol) {
  if (effectiveSol < 0.5) return { bid: 0.08, tierLabel: '< 0.50 SOL (Survival)', maxBulletsLoss: Math.max(0, Math.floor((effectiveSol - 0.08) / 0.036)) };
  if (effectiveSol < 3.0) return { bid: 0.10, tierLabel: '0.50 – 2.99 SOL (Fase 1)', maxBulletsLoss: Math.max(0, Math.floor((effectiveSol - 0.10) / 0.045)) };
  if (effectiveSol < 6.0) return { bid: 0.20, tierLabel: '3.00 – 5.99 SOL (Fase 2)', maxBulletsLoss: Math.max(0, Math.floor((effectiveSol - 0.20) / 0.09)) };
  if (effectiveSol < 10.0) return { bid: 0.30, tierLabel: '6.00 – 9.99 SOL (Fase 3)', maxBulletsLoss: Math.max(0, Math.floor((effectiveSol - 0.30) / 0.135)) };
  return { bid: 0.50, tierLabel: '10.0+ SOL (Scaling)', maxBulletsLoss: Math.max(0, Math.floor((effectiveSol - 0.50) / 0.225)) };
}

function loadCachedAudit() {
  try {
    if (fs.existsSync(BODYGUARD_FILE)) {
      return JSON.parse(fs.readFileSync(BODYGUARD_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveCachedAudit(data) {
  try {
    fs.writeFileSync(BODYGUARD_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

async function sendBodyguardTelegram(text) {
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

async function auditMyWallet(walletAddress) {
  const env = loadEnv();
  const wallet = (walletAddress || env.MY_WALLET || '').trim();
  if (!wallet) {
    throw new Error('Wallet address pribadi belum diisi! Pasang di tab Bodyguard atau Settings.');
  }

  const [balRes, spl1, spl2, rawTxs] = await Promise.all([
    rpcCall('getBalance', [wallet]),
    rpcCall('getTokenAccountsByOwner', [wallet, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]),
    rpcCall('getTokenAccountsByOwner', [wallet, { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, { encoding: 'jsonParsed' }]),
    getEnhancedTransactions(wallet, { limit: 100 })
  ]);

  const liquidSol = Number(((balRes?.value || 0) / 1e9).toFixed(6));
  const allTok = [...(spl1?.value || []), ...(spl2?.value || [])];
  let emptyAccounts = 0;
  let reclaimableLamports = 0;
  const openPositions = [];

  for (const a of allTok) {
    const info = a.account?.data?.parsed?.info;
    const amt = Number(info?.tokenAmount?.uiAmount || 0);
    if (amt === 0) {
      emptyAccounts += 1;
      reclaimableLamports += a.account?.lamports || 0;
    } else if (info?.mint && info.mint !== PUMP_MINT) {
      openPositions.push({ mint: info.mint, amount: amt });
    }
  }
  const reclaimableSol = Number((reclaimableLamports / 1e9).toFixed(6));
  const effectiveSol = Number((liquidSol + reclaimableSol).toFixed(6));
  const sizing = getSafeBidSize(effectiveSol);

  // Parse chronological transactions using exact nativeBalanceChange
  const txs = [...(Array.isArray(rawTxs) ? rawTxs : [])].reverse();
  const rows = [];
  let totalDepositedSol = 0;

  for (const tx of txs) {
    if (!tx || tx.transactionError) continue;
    const ts = tx.timestamp || 0;
    const wib = new Date(ts * 1000 + 7 * 3600 * 1000);
    const date = wib.toISOString().slice(0, 10);
    const time = wib.toISOString().slice(11, 19);

    let nativeDelta = 0;
    for (const ad of (tx.accountData || [])) {
      if (ad.account === wallet) nativeDelta += (ad.nativeBalanceChange || 0) / 1e9;
    }

    const tok = {};
    for (const t of (tx.tokenTransfers || [])) {
      if (!t.mint || t.mint === WSOL || t.mint === PUMP_MINT) continue;
      if (t.toUserAccount === wallet) tok[t.mint] = (tok[t.mint] || 0) + Number(t.tokenAmount || 0);
      if (t.fromUserAccount === wallet) tok[t.mint] = (tok[t.mint] || 0) - Number(t.tokenAmount || 0);
    }

    let mint = null;
    let tokDelta = 0;
    for (const [m, d] of Object.entries(tok)) {
      if (Math.abs(d) > Math.abs(tokDelta)) {
        mint = m;
        tokDelta = d;
      }
    }

    if (!mint && nativeDelta >= 0.05 && tx.type === 'TRANSFER') {
      totalDepositedSol += nativeDelta;
    }

    if (mint) {
      rows.push({ date, time, ts, nativeDelta, mint, tokDelta });
    }
  }

  // Fetch token symbols via Helius DAS getAssetBatch
  const uniqMints = [...new Set(rows.map((r) => r.mint))];
  const metaMap = {};
  if (uniqMints.length > 0) {
    try {
      const assets = await rpcCall('getAssetBatch', { ids: uniqMints.slice(0, 50) });
      for (const a of (assets || [])) {
        if (a?.id) {
          metaMap[a.id] = {
            symbol: a.content?.metadata?.symbol || a.id.slice(0, 6),
            name: a.content?.metadata?.name || ''
          };
        }
      }
    } catch {}
  }

  // Group into per-date token trades
  const tradeMap = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.mint}`;
    if (!tradeMap.has(key)) {
      tradeMap.set(key, {
        date: r.date,
        mint: r.mint,
        symbol: metaMap[r.mint]?.symbol || r.mint.slice(0, 6),
        buys: 0,
        sells: 0,
        buySol: 0,
        sellSol: 0,
        maxSingleBuySol: 0,
        firstTs: r.ts,
        lastTs: r.ts,
        firstTime: r.time,
        lastTime: r.time
      });
    }
    const t = tradeMap.get(key);
    t.lastTs = r.ts;
    t.lastTime = r.time;
    if (r.tokDelta > 0) {
      const spent = Math.max(0, -r.nativeDelta);
      t.buys += 1;
      t.buySol += spent;
      if (spent > t.maxSingleBuySol) t.maxSingleBuySol = spent;
    } else {
      t.sells += 1;
      t.sellSol += Math.max(0, r.nativeDelta);
    }
  }

  const trades = [...tradeMap.values()]
    .map((t) => {
      const buySol = Number(t.buySol.toFixed(4));
      const sellSol = Number(t.sellSol.toFixed(4));
      const pnlSol = Number((sellSol - buySol).toFixed(4));
      const pnlPct = buySol > 0 ? Number(((pnlSol / buySol) * 100).toFixed(1)) : 0;
      const holdSec = Math.max(0, t.lastTs - t.firstTs);
      const isClosed = t.buys > 0 && t.sells > 0;
      const isWin = isClosed && pnlSol > 0;
      const isLoss = isClosed && pnlSol < -0.004;
      const isPanicHold = isClosed && holdSec < 35;
      const isOversize = t.maxSingleBuySol > 0.115; // > 0.10 SOL + gas
      return {
        ...t,
        buySol,
        sellSol,
        pnlSol,
        pnlPct,
        holdSec,
        isClosed,
        isWin,
        isLoss,
        isPanicHold,
        isOversize
      };
    })
    .sort((a, b) => b.lastTs - a.lastTs);

  // Today's (WIB) discipline evaluation
  const nowWib = getWibNow();
  const todayTrades = trades.filter((t) => t.date === nowWib.date && t.isClosed);
  const todayWins = todayTrades.filter((t) => t.isWin).length;
  const todayLosses = todayTrades.filter((t) => t.isLoss).length;
  const todayPnlSol = Number(todayTrades.reduce((s, t) => s + t.pnlSol, 0).toFixed(4));
  const todayOversizes = todayTrades.filter((t) => t.isOversize).length;
  const todayPanicHolds = todayTrades.filter((t) => t.isPanicHold).length;

  // Check consecutive losses & 30-min cooldown from latest closed trade
  const nowSec = Math.floor(Date.now() / 1000);
  const latestClosed = todayTrades[0] || null;
  let cooldownRemainingSec = 0;
  if (latestClosed && latestClosed.isLoss) {
    const elapsed = nowSec - latestClosed.lastTs;
    if (elapsed < 1800) {
      cooldownRemainingSec = 1800 - elapsed;
    }
  }

  let consecutiveLossesToday = 0;
  for (const t of todayTrades) {
    if (t.isLoss) consecutiveLossesToday += 1;
    else break;
  }

  // Determine overall Guard Status
  const dailyStopLimit = Number((-sizing.bid * 0.95).toFixed(3)); // e.g., -0.076 SOL at 0.08 bid
  let guardStatus = {
    level: 'READY',
    title: '✅ GUARD CLEAR — SIAP EKSEKUSI SESUAI SOP',
    message: `Max bid: ${sizing.bid} SOL | Filter 3-Detik wajib lolos | TP1 50% di +60%–+100%, SL -30%.`,
    cooldownRemainingSec: 0
  };

  if (consecutiveLossesToday >= 2 || todayPnlSol <= dailyStopLimit) {
    guardStatus = {
      level: 'DAILY_STOP',
      title: '🚨 DAILY STOP LOSS HIT — TUTUP PADRE SEKARANG!',
      message: `Hari ini sudah ${todayLosses}x kalah (Net ${todayPnlSol} SOL). DILARANG trade lagi sampai besok 21:30 WIB!`,
      cooldownRemainingSec
    };
  } else if (cooldownRemainingSec > 0) {
    const mins = Math.ceil(cooldownRemainingSec / 60);
    guardStatus = {
      level: 'COOLDOWN',
      title: `🛑 COOLDOWN 30 MENIT AKTIF (${mins}m tersisa)`,
      message: `Baru saja cut loss di $${latestClosed.symbol} (${latestClosed.pnlPct}%). LEPAS MOUSE — dilarang revenge buy!`,
      cooldownRemainingSec
    };
  } else if (todayPnlSol >= 0.12) {
    guardStatus = {
      level: 'WIN_LOCK',
      title: `🏆 DAILY WIN LOCKED (+${todayPnlSol} SOL)!`,
      message: 'Target profit harian sudah tercapai! Kantongi profitnya — JANGAN buka koin baru hari ini.',
      cooldownRemainingSec: 0
    };
  }

  // Group daily summary
  const byDateMap = new Map();
  for (const t of trades) {
    if (!byDateMap.has(t.date)) {
      byDateMap.set(t.date, { date: t.date, wins: 0, losses: 0, pnlSol: 0, trades: 0 });
    }
    const d = byDateMap.get(t.date);
    d.trades += 1;
    if (t.isWin) d.wins += 1;
    if (t.isLoss) d.losses += 1;
    d.pnlSol = Number((d.pnlSol + t.pnlSol).toFixed(4));
  }

  const allClosed = trades.filter((t) => t.isClosed);
  const totalWins = allClosed.filter((t) => t.isWin).length;
  const totalLosses = allClosed.filter((t) => t.isLoss).length;

  const result = {
    wallet,
    updatedAt: Date.now(),
    liquidSol,
    emptyAccounts,
    reclaimableSol,
    effectiveSol,
    totalDepositedSol: Number(totalDepositedSol.toFixed(4)),
    netFromDepositSol: totalDepositedSol > 0 ? Number((effectiveSol - totalDepositedSol).toFixed(4)) : 0,
    openPositionsCount: openPositions.length,
    sizing,
    guardStatus,
    today: {
      date: nowWib.date,
      trades: todayTrades.length,
      wins: todayWins,
      losses: todayLosses,
      consecutiveLosses: consecutiveLossesToday,
      pnlSol: todayPnlSol,
      oversizes: todayOversizes,
      panicHolds: todayPanicHolds
    },
    overall: {
      closedTrades: allClosed.length,
      wins: totalWins,
      losses: totalLosses,
      winRate: allClosed.length ? Number(((totalWins / allClosed.length) * 100).toFixed(1)) : 0
    },
    dailySummary: [...byDateMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    trades: trades.slice(0, 60)
  };

  saveCachedAudit(result);

  if (guardStatus.level === 'DAILY_STOP' || guardStatus.level === 'COOLDOWN') {
    await sendBodyguardTelegram(`<b>${guardStatus.title}</b>\n${guardStatus.message}\nSaldo efektif: <b>${effectiveSol.toFixed(3)} SOL</b>`);
  }

  return result;
}

// === 0-CREDIT 3-SECOND TRENCH FILTER CHECKER ===
async function checkToken3SecFilter(mint) {
  const cleanMint = (mint || '').trim();
  if (!cleanMint || cleanMint.length < 30) {
    throw new Error('Paste Token CA Solana yang valid.');
  }

  const [dexRes, rugRes] = await Promise.all([
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${cleanMint}`).then((r) => r.json()).catch(() => ({})),
    fetch(`https://api.rugcheck.xyz/v1/tokens/${cleanMint}/report`).then((r) => r.json()).catch(() => ({}))
  ]);

  const pairs = Array.isArray(dexRes?.pairs) ? dexRes.pairs.filter((p) => p.chainId === 'solana') : [];
  if (!pairs.length) {
    throw new Error('Token belum terdeteksi di DexScreener (atau CA salah).');
  }
  pairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
  const p = pairs[0];

  const mc = Number(p.marketCap || p.fdv || 0);
  const liq = Number(p.liquidity?.usd || 0);
  const vol1h = Number(p.volume?.h1 || 0);
  const vol5m = Number(p.volume?.m5 || 0);
  const vol24h = Number(p.volume?.h24 || 0);
  const ageMin = p.pairCreatedAt ? Math.max(0, Math.round((Date.now() - p.pairCreatedAt) / 60000)) : null;
  const bestVol = ageMin !== null && ageMin > 60 ? vol1h : Math.max(vol1h, vol24h);
  const buys5m = Number(p.txns?.m5?.buys || 0);
  const sells5m = Number(p.txns?.m5?.sells || 0);
  const chg5m = Number(p.priceChange?.m5 || 0);
  const isDeadVolume = vol5m < 1000 || (buys5m + sells5m) < 8;

  const creatorBal = Number(rugRes?.creatorBalance || 0);
  const insiders = Number(rugRes?.graphInsidersDetected || 0);
  const risks = Array.isArray(rugRes?.risks) ? rugRes.risks : [];
  const totalHolders = Number(rugRes?.totalHolders || 0);

  // Top 10 excluding #1 LP pool
  const topHolders = Array.isArray(rugRes?.topHolders) ? rugRes.topHolders : [];
  const topNonLp = topHolders.slice(1, 11);
  const top10ExclLpPct = Number(topNonLp.reduce((s, h) => s + (Number(h.pct) || 0), 0).toFixed(1));
  const maxSingleHolderPct = topNonLp.length ? Number((Number(topNonLp[0].pct) || 0).toFixed(1)) : 0;

  const volMcRatio = mc > 0 ? Number((bestVol / mc).toFixed(2)) : 0;
  const liqMcPct = mc > 0 ? Number(((liq / mc) * 100).toFixed(1)) : 0;

  // Evaluate 6 Trench Filter Rules
  const checks = [
    {
      name: '1. Zona MC ($8K–$25K ideal)',
      pass: mc >= 8000 && mc <= 30000,
      warn: mc > 30000 && mc <= 120000,
      detail: mc < 8000 ? `$${(mc / 1000).toFixed(1)}K — Terlalu rendah (< $8K, kuburan saldo!)` : mc <= 30000 ? `$${(mc / 1000).toFixed(1)}K — Sweet spot zona entry lu!` : `$${(mc / 1000).toFixed(1)}K — Sudah tinggi, jangan FOMO pucuk!`
    },
    {
      name: '2. Volume vs MC (V >= 1.5x MC)',
      pass: volMcRatio >= 1.5,
      warn: volMcRatio >= 1.0 && volMcRatio < 1.5,
      detail: `Vol $${(bestVol / 1000).toFixed(1)}K (${volMcRatio}x MC) ${volMcRatio < 1 ? '— FAKE / BUNDLER PUMP!' : ''}`
    },
    {
      name: '3. Likuiditas Sehat (>= 12% MC)',
      pass: liqMcPct >= 12 && liq >= 4000,
      warn: liqMcPct >= 8 && liqMcPct < 12,
      detail: `Liq $${(liq / 1000).toFixed(1)}K (${liqMcPct}% dari MC)`
    },
    {
      name: '4. Dev Sold & 0 Insiders',
      pass: creatorBal === 0 && insiders === 0 && risks.length === 0,
      warn: creatorBal === 0 && insiders === 0 && risks.length > 0,
      detail: `Dev Bal: ${creatorBal === 0 ? 'DS (0)' : creatorBal} · Insiders: ${insiders} · Risks: ${risks.length}`
    },
    {
      name: '5. Top 10 Holders (Excl. LP < 25%)',
      pass: top10ExclLpPct > 0 && top10ExclLpPct <= 25 && maxSingleHolderPct <= 4.5,
      warn: top10ExclLpPct > 25 && top10ExclLpPct <= 35,
      detail: `Top 10: ${top10ExclLpPct}% · Max single: ${maxSingleHolderPct}% · Holders: ${totalHolders}`
    },
    {
      name: '6. Momentum 5m & Anti-FOMO Pucuk',
      pass: !isDeadVolume && buys5m >= sells5m && chg5m >= -15 && chg5m <= 55,
      warn: !isDeadVolume && buys5m >= sells5m && chg5m > 55,
      detail: isDeadVolume
        ? `DEAD / SEPI! 5m Vol $${vol5m.toFixed(0)} (${buys5m}B / ${sells5m}S)`
        : `5m: ${buys5m}B / ${sells5m}S · Vol $${(vol5m / 1000).toFixed(1)}K · Chg5m: ${chg5m >= 0 ? '+' : ''}${chg5m.toFixed(1)}% ${chg5m > 55 ? '(⚠ Baru ngegas vertikal, tunggu pullback!)' : ''}`
    }
  ];

  const passCount = checks.filter((c) => c.pass).length;
  const hardFail = isDeadVolume || mc < 7000 || volMcRatio < 0.8 || creatorBal > 0 || insiders > 0 || top10ExclLpPct > 38;

  let verdict = 'SKIP';
  let verdictLabel = '❌ INSTANT SKIP — JANGAN MASUK';
  if (!hardFail && passCount >= 5) {
    verdict = 'PASS';
    verdictLabel = '🔥 PASS — LAYAK KLIK CHART & CARI ENTRY';
  } else if (!hardFail && passCount >= 3) {
    verdict = 'WATCH';
    verdictLabel = '⚠️ WATCH — CEK CHART & TUNGGU PULLBACK';
  }

  return {
    mint: cleanMint,
    symbol: p.baseToken?.symbol || cleanMint.slice(0, 6),
    name: p.baseToken?.name || '',
    dexId: p.dexId || '',
    mc,
    liq,
    vol5m,
    vol1h,
    volMcRatio,
    liqMcPct,
    ageMin,
    buys5m,
    sells5m,
    chg5m,
    totalHolders,
    top10ExclLpPct,
    maxSingleHolderPct,
    risks: risks.map((r) => r.name || r.description).slice(0, 5),
    checks,
    passCount,
    verdict,
    verdictLabel,
    plan: {
      stopLossMc: Math.round(mc * 0.68),
      tp1Mc: Math.round(mc * 1.75), // +75% -> Sell Init / 50%
      tp2Mc: Math.round(mc * 2.8),  // ~3x -> Sell 30%
      moonbagSlMc: Math.round(mc * 1.15)
    },
    padreUrl: `https://trade.padre.gg/trade/solana/${cleanMint}`,
    dexUrl: p.url || `https://dexscreener.com/solana/${cleanMint}`
  };
}

// === KOBE 5/5 DAILY SCORECARD ===
const DEFAULT_CHECKS = {
  officeClean: false,   // 1. 0 crypto di jam kantor (08:30-17:30)
  noGooning: false,     // 2. 0 gooning hari ini
  gymAndDinner: false,  // 3. Gym / gerak fisik + makan < 19:45
  tradingSop: false,    // 4. Bid <= max, 0 revenge/martingale, patuh cooldown
  sleepOnTime: false    // 5. Laptop off 23:30, tidur penuh 7 jam
};

function loadScorecardStore() {
  try {
    if (fs.existsSync(SCORECARD_FILE)) {
      return JSON.parse(fs.readFileSync(SCORECARD_FILE, 'utf8'));
    }
  } catch {}
  return { days: {} };
}

function saveScorecardStore(store) {
  try {
    fs.writeFileSync(SCORECARD_FILE, JSON.stringify(store, null, 2));
  } catch {}
}

function scoreCount(checks) {
  return Object.values(checks || {}).filter(Boolean).length;
}

function getScorecard() {
  const store = loadScorecardStore();
  const todayDate = getWibNow().date;
  if (!store.days[todayDate]) {
    store.days[todayDate] = { checks: { ...DEFAULT_CHECKS }, note: '', updatedAt: null };
  }

  // Compute current clean streak (consecutive days ending today or yesterday with 5/5)
  const dates = Object.keys(store.days).sort().reverse();
  let perfectStreak = 0;
  let noGoonStreak = 0;
  for (const d of dates) {
    const entry = store.days[d];
    const sc = scoreCount(entry.checks);
    if (sc === 5) perfectStreak += 1;
    else if (d !== todayDate) break;
  }
  for (const d of dates) {
    const entry = store.days[d];
    if (entry.checks?.noGooning) noGoonStreak += 1;
    else if (d !== todayDate) break;
  }

  const history = dates.slice(0, 14).map((d) => ({
    date: d,
    score: scoreCount(store.days[d].checks),
    checks: store.days[d].checks,
    note: store.days[d].note || ''
  }));

  return {
    todayDate,
    today: store.days[todayDate],
    todayScore: scoreCount(store.days[todayDate].checks),
    perfectStreak,
    noGoonStreak,
    history
  };
}

function updateScorecard({ date, checks, note }) {
  const store = loadScorecardStore();
  const targetDate = (date || getWibNow().date).trim();
  const prev = store.days[targetDate] || { checks: { ...DEFAULT_CHECKS }, note: '' };
  store.days[targetDate] = {
    checks: { ...DEFAULT_CHECKS, ...(prev.checks || {}), ...(checks || {}) },
    note: typeof note === 'string' ? note.slice(0, 300) : (prev.note || ''),
    updatedAt: Date.now()
  };
  saveScorecardStore(store);
  return getScorecard();
}

function getBodyguardSnapshot() {
  const env = loadEnv();
  return {
    myWallet: env.MY_WALLET || '',
    session: getWibSessionStatus(),
    audit: loadCachedAudit(),
    scorecard: getScorecard()
  };
}

module.exports = {
  getWibSessionStatus,
  getSafeBidSize,
  auditMyWallet,
  checkToken3SecFilter,
  getScorecard,
  updateScorecard,
  getBodyguardSnapshot
};
