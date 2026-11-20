const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./env');
const {
  BASE_MINTS,
  getKnownEntity,
  isIgnoredForSideWallet,
  isCexAddress,
  isBridgeAddress,
  getInvestigationLinks
} = require('./known-entities');
const { getEnhancedTransactions, getMultipleBalances } = require('./helius');
const { loadWalletList } = require('./auditor');

const TRACES_FILE = path.join(DATA_DIR, 'traces.json');

function loadTraceCache() {
  try {
    if (fs.existsSync(TRACES_FILE)) {
      return JSON.parse(fs.readFileSync(TRACES_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveTraceCache(cache) {
  fs.writeFileSync(TRACES_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function buildKnownTrackedMap() {
  const map = new Map();
  for (const w of loadWalletList()) {
    map.set(w.address, w.name);
  }
  return map;
}

function extractTransfersFromTxs(walletAddr, txs, minSol = 0.05) {
  const solIn = new Map();
  const solOut = new Map();
  const splLinks = new Map();
  const bridgeHits = [];
  const boughtMints = [];

  const DEX_SOURCES = new Set([
    'PUMP_FUN', 'PUMP_AMM', 'RAYDIUM', 'JUPITER', 'METEORA', 'ORCA',
    'PHOTON', 'AXIOM', 'MOONSHOT', 'BOOP', 'LAUNCHLAB', 'DFLOW'
  ]);

  for (const tx of txs) {
    if (tx.transactionError) continue;
    const ts = tx.timestamp || 0;

    // Check if any account or transfer touches a known Cross-Chain Bridge / Instant Swap
    const touchedAccounts = new Set([
      ...(tx.accountData || []).map((a) => a.account),
      ...(tx.nativeTransfers || []).flatMap((n) => [n.fromUserAccount, n.toUserAccount]),
      ...(tx.instructions || []).map((ix) => ix.programId)
    ]);

    for (const acc of touchedAccounts) {
      if (acc && isBridgeAddress(acc)) {
        const ent = getKnownEntity(acc);
        const solMoved = (tx.nativeTransfers || [])
          .filter((n) => n.fromUserAccount === walletAddr || n.toUserAccount === walletAddr)
          .reduce((s, n) => s + (n.amount || 0) / 1e9, 0);
        bridgeHits.push({
          bridge: ent.label,
          bridgeAddr: acc,
          explorer: ent.explorer || '',
          solMoved: Number(solMoved.toFixed(3)),
          ts,
          sig: tx.signature
        });
      }
    }

    const hasNonBaseTokenMove = (tx.tokenTransfers || []).some(
      (tt) => tt.mint && !BASE_MINTS.has(tt.mint) && (tt.toUserAccount === walletAddr || tt.fromUserAccount === walletAddr)
    );
    const hasSolMove = (tx.nativeTransfers || []).some(
      (nt) => (nt.amount || 0) / 1e9 >= 0.01 && (nt.toUserAccount === walletAddr || nt.fromUserAccount === walletAddr)
    );
    const isDexSource = DEX_SOURCES.has(String(tx.source || '').toUpperCase());
    const isLikelySwap = tx.type === 'SWAP' || isDexSource || (hasNonBaseTokenMove && hasSolMove);

    if (!isLikelySwap) {
      for (const nt of tx.nativeTransfers || []) {
        const sol = (nt.amount || 0) / 1e9;
        if (sol < minSol) continue;
        if (nt.toUserAccount === walletAddr && nt.fromUserAccount && nt.fromUserAccount !== walletAddr) {
          const cur = solIn.get(nt.fromUserAccount) || { totalSol: 0, count: 0, lastTs: 0, firstTs: Infinity };
          cur.totalSol += sol;
          cur.count += 1;
          if (ts > cur.lastTs) cur.lastTs = ts;
          if (ts < cur.firstTs) cur.firstTs = ts;
          solIn.set(nt.fromUserAccount, cur);
        }
        if (nt.fromUserAccount === walletAddr && nt.toUserAccount && nt.toUserAccount !== walletAddr) {
          const cur = solOut.get(nt.toUserAccount) || { totalSol: 0, count: 0, lastTs: 0, firstTs: Infinity };
          cur.totalSol += sol;
          cur.count += 1;
          if (ts > cur.lastTs) cur.lastTs = ts;
          if (ts < cur.firstTs) cur.firstTs = ts;
          solOut.set(nt.toUserAccount, cur);
        }
      }

      if (!hasSolMove) {
        for (const tt of tx.tokenTransfers || []) {
          if (!tt.mint || BASE_MINTS.has(tt.mint)) continue;
          if (!tt.tokenAmount || Number(tt.tokenAmount) <= 0) continue;
          let peer = null;
          let dir = null;
          if (tt.fromUserAccount === walletAddr && tt.toUserAccount && tt.toUserAccount !== walletAddr) {
            peer = tt.toUserAccount;
            dir = 'OUT';
          } else if (tt.toUserAccount === walletAddr && tt.fromUserAccount && tt.fromUserAccount !== walletAddr) {
            peer = tt.fromUserAccount;
            dir = 'IN';
          }
          if (peer && !isIgnoredForSideWallet(peer)) {
            const cur = splLinks.get(peer) || { count: 0, mints: new Set(), dir };
            cur.count += 1;
            cur.mints.add(tt.mint);
            splLinks.set(peer, cur);
          }
        }
      }
    } else {
      for (const tt of tx.tokenTransfers || []) {
        if (!tt.mint || BASE_MINTS.has(tt.mint)) continue;
        if (tt.toUserAccount === walletAddr) boughtMints.push({ mint: tt.mint, ts });
      }
    }
  }

  return { solIn, solOut, splLinks, bridgeHits, boughtMints };
}

async function traceSideWallets(targetAddress, { depth = 2, checkCexDeposit = true, minSol = 0.05, forceRefresh = false } = {}) {
  const addr = targetAddress.trim();
  const cache = loadTraceCache();
  if (!forceRefresh && cache[addr] && Date.now() - cache[addr].cachedAt < 3600_000) {
    return cache[addr];
  }

  const trackedMap = buildKnownTrackedMap();
  const nodesMap = new Map();
  const edges = [];
  const suspectsMap = new Map();

  function ensureNode(id, role = 'WALLET', hop = 1) {
    if (nodesMap.has(id)) {
      const n = nodesMap.get(id);
      if (hop < n.hop) n.hop = hop;
      return n;
    }
    const ent = getKnownEntity(id);
    const trackedName = trackedMap.get(id) || null;
    const node = {
      id,
      label: id === addr
        ? (trackedName ? `TARGET: ${trackedName}` : `TARGET ${id.slice(0, 6)}`)
        : ent
          ? ent.label
          : trackedName
            ? trackedName
            : `${id.slice(0, 4)}...${id.slice(-4)}`,
      role: id === addr ? 'TARGET' : ent ? ent.type : role,
      hop,
      trackedName,
      solBalance: null
    };
    nodesMap.set(id, node);
    return node;
  }

  function addSuspect(sAddr, confidence, reason, solFlow = 0, hop = 1) {
    if (sAddr === addr || isIgnoredForSideWallet(sAddr)) return;
    const prev = suspectsMap.get(sAddr) || {
      address: sAddr,
      confidence: 0,
      reasons: [],
      totalSolFlow: 0,
      hop,
      trackedName: trackedMap.get(sAddr) || null,
      solBalance: null,
      links: getInvestigationLinks(sAddr)
    };
    prev.confidence = Math.max(prev.confidence, confidence);
    if (!prev.reasons.includes(reason)) prev.reasons.push(reason);
    prev.totalSolFlow = Number((prev.totalSolFlow + solFlow).toFixed(4));
    prev.hop = Math.min(prev.hop, hop);
    suspectsMap.set(sAddr, prev);
  }

  ensureNode(addr, 'TARGET', 0);

  // Pull up to 200 recent txs (2 pages) for thorough funding + bridge + transfer capture
  const page1 = await getEnhancedTransactions(addr, { limit: 100 });
  let rootTxs = [...page1];
  if (page1.length === 100) {
    try {
      const page2 = await getEnhancedTransactions(addr, { limit: 100, before: page1[page1.length - 1].signature });
      rootTxs = rootTxs.concat(page2);
    } catch {}
  }

  const rootParsed = extractTransfersFromTxs(addr, rootTxs, minSol);
  const hop1Candidates = [];
  const allBridges = [...rootParsed.bridgeHits];

  for (const bh of rootParsed.bridgeHits) {
    ensureNode(bh.bridgeAddr, 'BRIDGE', 1);
    edges.push({
      from: bh.bridgeAddr,
      to: addr,
      type: 'BRIDGE_HOP',
      amountSol: bh.solMoved,
      count: 1,
      label: `BRIDGE ${bh.bridge} (${bh.solMoved} SOL)`
    });
  }

  for (const [fromAddr, info] of rootParsed.solIn.entries()) {
    const ent = getKnownEntity(fromAddr);
    ensureNode(fromAddr, ent ? ent.type : 'FUNDER', 1);
    edges.push({
      from: fromAddr,
      to: addr,
      type: ent?.type === 'BRIDGE' ? 'BRIDGE_HOP' : 'SOL_TRANSFER',
      amountSol: Number(info.totalSol.toFixed(3)),
      count: info.count,
      label: `${info.totalSol.toFixed(2)} SOL (${info.count}x)`
    });

    if (!isIgnoredForSideWallet(fromAddr)) {
      const conf = info.count >= 2 ? 85 : 75;
      addSuspect(fromAddr, conf, `Direct SOL Funder (${info.totalSol.toFixed(2)} SOL, ${info.count}x)`, info.totalSol, 1);
      hop1Candidates.push({ address: fromAddr, dir: 'IN', totalSol: info.totalSol });
    }
  }

  for (const [toAddr, info] of rootParsed.solOut.entries()) {
    const ent = getKnownEntity(toAddr);
    ensureNode(toAddr, ent ? ent.type : 'RECIPIENT', 1);
    edges.push({
      from: addr,
      to: toAddr,
      type: ent?.type === 'BRIDGE' ? 'BRIDGE_HOP' : 'SOL_TRANSFER',
      amountSol: Number(info.totalSol.toFixed(3)),
      count: info.count,
      label: `${info.totalSol.toFixed(2)} SOL (${info.count}x)`
    });

    if (!isIgnoredForSideWallet(toAddr)) {
      const conf = info.count >= 2 ? 88 : 78;
      addSuspect(toAddr, conf, `Direct SOL Cashout/Funding (${info.totalSol.toFixed(2)} SOL, ${info.count}x)`, info.totalSol, 1);
      hop1Candidates.push({ address: toAddr, dir: 'OUT', totalSol: info.totalSol });
    }
  }

  for (const [peerAddr, info] of rootParsed.splLinks.entries()) {
    ensureNode(peerAddr, 'SPL_LINK', 1);
    edges.push({
      from: info.dir === 'OUT' ? addr : peerAddr,
      to: info.dir === 'OUT' ? peerAddr : addr,
      type: 'SPL_TRANSFER',
      amountSol: 0,
      count: info.count,
      label: `Direct SPL (${info.mints.size} token)`
    });
    addSuspect(peerAddr, 86, `Direct SPL Token Transfer (${info.mints.size} memecoin, non-DEX)`, 0, 1);
  }

  if (depth >= 2) {
    const topHop1 = hop1Candidates
      .sort((a, b) => b.totalSol - a.totalSol)
      .filter((v, idx, arr) => arr.findIndex((x) => x.address === v.address) === idx)
      .slice(0, 6);

    for (const cand of topHop1) {
      try {
        const subTxs = await getEnhancedTransactions(cand.address, { limit: 60 });
        const subParsed = extractTransfersFromTxs(cand.address, subTxs, minSol);
        for (const bh of subParsed.bridgeHits) {
          allBridges.push({ ...bh, viaWallet: cand.address });
        }

        let sweptToCex = null;
        if (checkCexDeposit) {
          for (const [subTo, info] of subParsed.solOut.entries()) {
            if (isCexAddress(subTo)) {
              sweptToCex = getKnownEntity(subTo);
              ensureNode(subTo, 'CEX', 2);
              edges.push({
                from: cand.address,
                to: subTo,
                type: 'CEX_SWEEP',
                amountSol: Number(info.totalSol.toFixed(3)),
                count: info.count,
                label: `Sweep ${info.totalSol.toFixed(2)} SOL → ${sweptToCex.label}`
              });
              const candNode = nodesMap.get(cand.address);
              if (candNode) {
                candNode.role = 'CEX_DEPOSIT';
                candNode.label = `${sweptToCex.label} Deposit (${cand.address.slice(0, 4)}...)`;
              }
              suspectsMap.delete(cand.address);
              break;
            }
          }
        }

        if (sweptToCex) {
          for (const [otherSender, info] of subParsed.solIn.entries()) {
            if (otherSender === addr || isIgnoredForSideWallet(otherSender)) continue;
            ensureNode(otherSender, 'CONFIRMED_SIDE', 2);
            edges.push({
              from: otherSender,
              to: cand.address,
              type: 'SHARED_CEX_DEPOSIT',
              amountSol: Number(info.totalSol.toFixed(3)),
              count: info.count,
              label: `Shared Deposit (${info.totalSol.toFixed(2)} SOL)`
            });
            addSuspect(
              otherSender,
              95,
              `SHARED ${sweptToCex.label} DEPOSIT ADDRESS (${info.totalSol.toFixed(2)} SOL) — 95%+ Same Owner!`,
              info.totalSol,
              2
            );
          }
        } else {
          const topPeers = [...subParsed.solOut.entries(), ...subParsed.solIn.entries()]
            .filter(([p]) => p !== addr && !isIgnoredForSideWallet(p))
            .sort((a, b) => b[1].totalSol - a[1].totalSol)
            .slice(0, 4);

          for (const [peer, info] of topPeers) {
            ensureNode(peer, 'HOP2_WALLET', 2);
            const isOut = subParsed.solOut.has(peer);
            edges.push({
              from: isOut ? cand.address : peer,
              to: isOut ? peer : cand.address,
              type: 'HOP2_SOL',
              amountSol: Number(info.totalSol.toFixed(3)),
              count: info.count,
              label: `Hop-2 ${info.totalSol.toFixed(2)} SOL`
            });
            addSuspect(
              peer,
              65,
              `Hop-2 Cluster via ${cand.address.slice(0, 6)}... (${info.totalSol.toFixed(2)} SOL)`,
              info.totalSol,
              2
            );
          }
        }
      } catch {}
    }
  }

  const allIds = [...nodesMap.keys()];
  if (allIds.length > 0) {
    try {
      const bals = await getMultipleBalances(allIds);
      for (const [id, node] of nodesMap.entries()) {
        node.solBalance = Number((bals.get(id) || 0).toFixed(3));
      }
      for (const [id, s] of suspectsMap.entries()) {
        s.solBalance = Number((bals.get(id) || 0).toFixed(3));
      }
    } catch {}
  }

  const suspects = [...suspectsMap.values()].sort(
    (a, b) => b.confidence - a.confidence || b.totalSolFlow - a.totalSolFlow
  );

  const uniqueEdges = [];
  const edgeKeys = new Set();
  for (const e of edges) {
    const k = `${e.from}->${e.to}:${e.type}`;
    if (edgeKeys.has(k)) continue;
    edgeKeys.add(k);
    uniqueEdges.push(e);
  }

  const result = {
    target: addr,
    targetName: trackedMap.get(addr) || addr.slice(0, 8),
    links: getInvestigationLinks(addr),
    cachedAt: Date.now(),
    bridgesDetected: allBridges.slice(0, 15),
    stats: {
      rootTxScanned: rootTxs.length,
      nodesCount: nodesMap.size,
      edgesCount: uniqueEdges.length,
      suspectsCount: suspects.length,
      confirmedCexMatches: suspects.filter((s) => s.confidence >= 95).length,
      bridgesCount: allBridges.length
    },
    nodes: [...nodesMap.values()],
    edges: uniqueEdges,
    suspects
  };

  cache[addr] = result;
  saveTraceCache(cache);
  return result;
}

function getAllCachedTraces() {
  const cache = loadTraceCache();
  return Object.values(cache)
    .map((t) => ({
      target: t.target,
      targetName: t.targetName,
      cachedAt: t.cachedAt,
      stats: t.stats
    }))
    .sort((a, b) => b.cachedAt - a.cachedAt);
}

module.exports = {
  traceSideWallets,
  getAllCachedTraces
};
