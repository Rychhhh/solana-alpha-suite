let allWallets = [];
let summaryData = null;
let currentTierFilter = 'ALL';
let pollTimer = null;
let alphaPollTimer = null;
let selectedRunnerMints = new Set();

let graphView = { x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0 };

function $(id) { return document.getElementById(id); }

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.style.borderColor = isError ? '#ff4d6d' : '#00e599';
  el.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.style.display = 'none'; }, 3800);
}

function shortAddr(a) {
  if (!a) return '-';
  return `${a.slice(0, 5)}...${a.slice(-4)}`;
}

function fmtUsd(v) {
  if (!v) return '-';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtHold(sec) {
  if (sec === null || sec === undefined) return '-';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function fmtSpan(d) {
  if (!d) return '-';
  let txt = '-';
  if (typeof d.spanDays === 'number' && d.spanDays > 0) {
    txt = d.spanDays >= 1 ? `${d.spanDays.toFixed(1)}d` : `${d.spanHours}h`;
  } else if (d.newestTs && d.oldestTs) {
    const hrs = (d.newestTs - d.oldestTs) / 3600;
    txt = hrs >= 24 ? `${(hrs / 24).toFixed(1)}d` : `${hrs.toFixed(1)}h`;
  }
  if (d.reachedCutoff === false && (d.spanDays || 0) < (d.windowDays || 7) * 0.75) {
    return `<span style="color:var(--amber);" title="Wallet terlalu hiperaktif (>300 tx) — klik Investigate untuk tarik Full 7D hingga 1,600 tx!">⚠ ${txt}</span>`;
  }
  return `<span style="color:var(--green);" title="Full window ter-cover">${txt}</span>`;
}

function fmtAgo(tsSec) {
  if (!tsSec) return '-';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast(`Copied: ${shortAddr(text)}`));
}

// === NAVIGATION ===
document.querySelectorAll('.nav-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tabName}`));
  if (tabName === 'tracer') loadCachedTraces();
  if (tabName === 'pinger') refreshPinger();
  if (tabName === 'alpha') refreshAlphaState();
  if (tabName === 'bodyguard') refreshBodyguard();
}

// === SETTINGS ===
$('btnOpenSettings').addEventListener('click', openSettings);

async function openSettings() {
  try {
    const cfg = await api('/api/config');
    $('cfgHeliusKey').value = '';
    $('cfgKeyHint').textContent = cfg.hasHeliusKey
      ? `API Key aktif: ${cfg.heliusKeyMasked} (kosongkan jika tidak ingin mengganti)`
      : 'Belum ada API Key. Copy dari dashboard.helius.dev → API Keys.';
    $('cfgWalletPath').value = cfg.walletListPath || '';
    if ($('cfgMyWallet')) $('cfgMyWallet').value = cfg.myWallet || '';
  } catch {}
  $('settingsModal').classList.add('open');
}

function closeSettings() { $('settingsModal').classList.remove('open'); }

async function saveSettingsUI() {
  try {
    const body = {
      heliusApiKey: $('cfgHeliusKey').value.trim(),
      walletListPath: $('cfgWalletPath').value.trim(),
      telegramBotToken: $('cfgTgToken').value.trim(),
      telegramChatId: $('cfgTgChatId').value.trim(),
      myWallet: $('cfgMyWallet') ? $('cfgMyWallet').value.trim() : ''
    };
    const res = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
    showToast(`Config tersimpan! Helius Key: ${res.heliusKeyMasked || 'belum diisi'}`);
    closeSettings();
    await refreshConfig();
    await refreshWallets();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function testHeliusUI() {
  try {
    if ($('cfgHeliusKey').value.trim()) {
      await api('/api/config', { method: 'POST', body: JSON.stringify({ heliusApiKey: $('cfgHeliusKey').value.trim() }) });
    }
    const res = await api('/api/test-helius', { method: 'POST' });
    showToast(`Helius Connected! Slot: ${res.slot.toLocaleString()}`);
    await refreshConfig();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function refreshConfig() {
  try {
    const cfg = await api('/api/config');
    $('noKeyBanner').style.display = cfg.hasHeliusKey ? 'none' : 'flex';
    const btn = $('btnOpenSettings');
    if (cfg.hasHeliusKey) {
      btn.textContent = `⚙ Key: ${cfg.heliusKeyMasked}`;
      btn.className = 'btn';
    } else {
      btn.textContent = '⚠ Set Helius Key';
      btn.className = 'btn btn-amber';
    }
    if (cfg.credits) updateCredits(cfg.credits);
  } catch {}
}

function updateCredits(c) {
  if (!c) return;
  $('creditsUsed').textContent = Number(c.used || 0).toLocaleString();
}

// === WALLETS & AUDITOR ===
async function refreshWallets() {
  try {
    const data = await api('/api/wallets');
    allWallets = data.wallets || [];
    summaryData = data.summary;
    updateCredits(data.credits);
    renderJobBanner(data.job);
    renderOverview(summaryData);
    renderTierPills(summaryData);
    renderWalletsTable();

    if (data.job?.running) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(refreshWallets, 1800);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderJobBanner(job) {
  const banner = $('jobBanner');
  if (!job || !job.running) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  $('jobTitle').textContent = job.stage === 'stage1' ? 'Stage 1: Fast Triage' : 'Stage 2: Strict 4-Gate Deep Audit';
  $('jobDetail').textContent = job.currentWallet || '';
  $('jobProgressFill').style.width = `${pct}%`;
  $('jobCounter').textContent = `${job.processed} / ${job.total} (${pct}%)`;
}

function gatePill(d) {
  if (!d) return '-';
  if (typeof d.gatesPassed !== 'number') return '<span class="muted">v1 (re-audit)</span>';
  const cls = d.gatesPassed === 4 ? 'badge-ELITE' : d.gatesPassed === 3 ? 'badge-GOOD' : 'badge-LOSER';
  return `<span class="badge ${cls}">${d.gatesPassed}/4</span>`;
}

function identityBadge(w) {
  if (!w?.identity?.verified) return '';
  return `<div style="margin-top:2px;"><span class="badge badge-KOL">${escHtml(w.identity.label)}</span></div>`;
}

function styleBadge(w) {
  if (!w?.style || !w.style.code || w.style.code === 'UNKNOWN') return '<span class="muted">-</span>';
  return `<span class="badge badge-${w.style.code}" title="${escHtml(w.style.desc || '')}">${escHtml(w.style.label)}</span>`;
}

function renderOverview(s) {
  if (!s) return;
  $('walletCountBadge').textContent = `${s.total} Wallets`;
  $('kpiTotal').textContent = s.total.toLocaleString();
  $('kpiScanned').textContent = `Stage 1: ${s.scannedS1} | Deep 4-Gate: ${s.scannedS2}`;

  const eliteGood = (s.counts.ELITE || 0) + (s.counts.GOOD || 0);
  $('kpiElite').textContent = eliteGood;
  $('kpiEliteSub').textContent = `Elite: ${s.counts.ELITE || 0} | Good: ${s.counts.GOOD || 0} | Verified KOLs: ${s.styleCounts?.VERIFIED_KOLS || 0}`;

  $('kpiActive').textContent = s.counts.ACTIVE || 0;
  const noise = (s.counts.BOT_SNIPER || 0) + (s.counts.BOT_SPAM || 0) + (s.counts.DORMANT || 0) + (s.counts.EMPTY || 0) + (s.counts.LOSER || 0);
  $('kpiNoise').textContent = noise;
  $('kpiNoiseSub').textContent = `Auto Bot: ${s.styleCounts?.AUTO_BOT || 0} | Dormant/Empty: ${(s.counts.DORMANT || 0) + (s.counts.EMPTY || 0)} | Loser: ${s.counts.LOSER || 0}`;
  $('kpiSol').textContent = `${s.totalSolTracked.toLocaleString()} SOL`;

  const tbody = $('eliteLeaderboardBody');
  if (!s.topElite || s.topElite.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px;">Belum ada wallet ELITE / GOOD. Lanjut klik <b>2. Audit 35 Active</b> untuk scan sisa wallet aktif.</td></tr>';
  } else {
    tbody.innerHTML = s.topElite.map((w, idx) => {
      const d = w.deep;
      const netVal = typeof d.strictNetFlowSol === 'number' ? d.strictNetFlowSol : d.realizedPnlSol;
      const rCls = d.realizedPnlSol >= 0 ? 'pos' : 'neg';
      const nCls = netVal >= 0 ? 'pos' : 'neg';
      return `
        <tr>
          <td class="mono muted">${idx + 1}</td>
          <td><b>${escHtml(w.emoji)} ${escHtml(w.name)}</b> <span class="mono muted" style="font-size:10.5px;">${shortAddr(w.address)}</span>${identityBadge(w)}</td>
          <td>${styleBadge(w)}</td>
          <td class="mono muted" style="font-size:11px;">${escHtml(w.cadence?.label || '-')}</td>
          <td><span class="badge badge-${w.tier}">${w.tier}</span> ${gatePill(d)}</td>
          <td class="mono"><b>${d.copyScore}</b></td>
          <td class="mono">${fmtSpan(d)}</td>
          <td class="mono">${d.winRate}% <span class="muted">(${d.wins}W/${d.losses}L)</span></td>
          <td class="mono"><span class="${rCls}">${d.realizedPnlSol >= 0 ? '+' : ''}${d.realizedPnlSol}</span> <span class="muted">/</span> <b class="${nCls}">${netVal >= 0 ? '+' : ''}${netVal}</b></td>
          <td class="mono">${fmtHold(d.medianHoldSec)}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="jumpToInvestigate('${w.address}')">Investigate</button>
            <a class="btn btn-xs" href="https://intel.arkm.com/explorer/address/${w.address}" target="_blank">Arkham</a>
            <a class="btn btn-xs" href="https://gmgn.ai/sol/address/${w.address}" target="_blank">GMGN</a>
          </td>
        </tr>`;
    }).join('');
  }

  // Render separate KOL Fast/Hyper Scalpers Radar table
  const kolCard = $('kolRadarCard');
  const kolList = s.kolRadar || [];
  if (kolList.length > 0) {
    kolCard.style.display = 'block';
    $('kolRadarBody').innerHTML = kolList.map((w, idx) => {
      const d = w.deep;
      const netVal = typeof d.strictNetFlowSol === 'number' ? d.strictNetFlowSol : d.realizedPnlSol;
      const rCls = d.realizedPnlSol >= 0 ? 'pos' : 'neg';
      const nCls = netVal >= 0 ? 'pos' : 'neg';
      return `
        <tr>
          <td class="mono muted">${idx + 1}</td>
          <td><b>${escHtml(w.emoji)} ${escHtml(w.name)}</b> <span class="mono muted" style="font-size:10.5px;">${shortAddr(w.address)}</span>${identityBadge(w)}</td>
          <td>${styleBadge(w)}</td>
          <td class="mono muted" style="font-size:11px;">${escHtml(w.cadence?.label || '-')}</td>
          <td><span class="badge badge-${w.tier}">${w.tier}</span> ${gatePill(d)}</td>
          <td class="mono">${fmtSpan(d)}</td>
          <td class="mono">${d.winRate}% <span class="muted">(${d.wins}W/${d.losses}L)</span></td>
          <td class="mono"><span class="${rCls}">${d.realizedPnlSol >= 0 ? '+' : ''}${d.realizedPnlSol}</span> <span class="muted">/</span> <b class="${nCls}">${netVal >= 0 ? '+' : ''}${netVal}</b></td>
          <td class="mono">${fmtHold(d.medianHoldSec)}</td>
          <td>
            <button class="btn btn-xs btn-primary" onclick="jumpToInvestigate('${w.address}')">Investigate</button>
            <a class="btn btn-xs" href="https://intel.arkm.com/explorer/address/${w.address}" target="_blank">Arkham</a>
            <a class="btn btn-xs" href="https://gmgn.ai/sol/address/${w.address}" target="_blank">GMGN</a>
          </td>
        </tr>`;
    }).join('');
  } else {
    kolCard.style.display = 'none';
  }
}

function renderTierPills(s) {
  const filters = [
    { key: 'ALL', label: `ALL (${s.total})` },
    { key: 'STYLE:VERIFIED_KOLS', label: `👑 VERIFIED KOLS (${s.styleCounts?.VERIFIED_KOLS || 0})` },
    { key: 'STYLE:SHARP_SNIPER', label: `🎯 SHARP SNIPER (${s.styleCounts?.SHARP_SNIPER || 0})` },
    { key: 'STYLE:SWING', label: `💎 SWING (${s.styleCounts?.SWING || 0})` },
    { key: 'STYLE:HYPER_SCALPER', label: `⚡ HYPER SCALPER (${s.styleCounts?.HYPER_SCALPER || 0})` },
    { key: 'ELITE', label: `ELITE (${s.counts.ELITE || 0})` },
    { key: 'GOOD', label: `GOOD (${s.counts.GOOD || 0})` },
    { key: 'KOL_SCALPER', label: `KOL_SCALPER (${s.counts.KOL_SCALPER || 0})` },
    { key: 'ACTIVE', label: `ACTIVE (${s.counts.ACTIVE || 0})` },
    { key: 'STYLE:AUTO_BOT', label: `🤖 AUTO BOT (${s.styleCounts?.AUTO_BOT || 0})` },
    { key: 'LOSER', label: `LOSER (${s.counts.LOSER || 0})` },
    { key: 'DORMANT', label: `DORMANT (${s.counts.DORMANT || 0})` },
    { key: 'EMPTY', label: `EMPTY (${s.counts.EMPTY || 0})` }
  ];
  $('tierFilterPills').innerHTML = filters.map((f) =>
    `<button class="pill ${currentTierFilter === f.key ? 'active' : ''}" onclick="setTierFilter('${f.key}')">${f.label}</button>`
  ).join('');
}

function setTierFilter(t) {
  currentTierFilter = t;
  renderTierPills(summaryData);
  renderWalletsTable();
}

$('searchWallet').addEventListener('input', renderWalletsTable);
$('sortWallets').addEventListener('change', renderWalletsTable);
['fltMinWr', 'fltMinClosed', 'fltMinHold', 'fltMinSpan', 'fltNetPos', 'fltGreenDays'].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', renderWalletsTable);
});

function applyHighWrPreset() {
  currentTierFilter = 'ALL';
  $('fltMinWr').value = '55';
  $('fltMinClosed').value = '6';
  $('fltMinHold').value = '25';
  $('fltMinSpan').value = '1';
  $('fltNetPos').checked = true;
  $('fltGreenDays').checked = true;
  $('sortWallets').value = 'consistency';
  renderTierPills(summaryData);
  renderWalletsTable();
  showToast('Filter aktif: WR >= 55%, Net > 0, Closed >= 6, Hold >= 25s, Span >= 1d, Green Days >= 50%!');
}

function resetCustomFilters() {
  $('fltMinWr').value = '0';
  $('fltMinClosed').value = '0';
  $('fltMinHold').value = '0';
  $('fltMinSpan').value = '0';
  $('fltNetPos').checked = false;
  $('fltGreenDays').checked = false;
  renderWalletsTable();
}

function getConsistencyMetrics(d) {
  if (!d) return { greenDays: 0, activeDays: 0, pct: 0, pf: 0 };
  const list = Array.isArray(d.dailyPnl) ? d.dailyPnl : [];
  const activeDays = typeof d.activeDays === 'number' ? d.activeDays : list.length;
  const greenDays = typeof d.greenDays === 'number' ? d.greenDays : list.filter((x) => x.netSol > 0).length;
  const pct = typeof d.dailyConsistencyPct === 'number' ? d.dailyConsistencyPct : (activeDays > 0 ? Math.round((greenDays / activeDays) * 100) : 0);
  const pf = typeof d.profitFactor === 'number' ? d.profitFactor : 0;
  return { greenDays, activeDays, pct, pf };
}

function renderWalletsTable() {
  const q = $('searchWallet').value.trim().toLowerCase();
  const sortBy = $('sortWallets').value;
  const minWr = Number($('fltMinWr')?.value || 0);
  const minClosed = Number($('fltMinClosed')?.value || 0);
  const minHold = Number($('fltMinHold')?.value || 0);
  const minSpan = Number($('fltMinSpan')?.value || 0);
  const netPosOnly = Boolean($('fltNetPos')?.checked);
  const greenDaysOnly = Boolean($('fltGreenDays')?.checked);
  const hasNumericFilter = minWr > 0 || minClosed > 0 || minHold > 0 || minSpan > 0 || netPosOnly || greenDaysOnly;

  let rows = allWallets.filter((w) => {
    if (currentTierFilter === 'STYLE:VERIFIED_KOLS') {
      if (!w.identity?.verified || !['KOL', 'KOL_ALT', 'FOUNDER'].includes(w.identity.kind)) return false;
    } else if (currentTierFilter.startsWith('STYLE:')) {
      const code = currentTierFilter.slice(6);
      if (w.style?.code !== code) return false;
    } else if (currentTierFilter !== 'ALL' && w.tier !== currentTierFilter) {
      return false;
    }
    if (hasNumericFilter) {
      const d = w.deep;
      if (!d) return false;
      const netVal = typeof d.strictNetFlowSol === 'number' ? d.strictNetFlowSol : d.realizedPnlSol;
      const cm = getConsistencyMetrics(d);
      if ((d.winRate || 0) < minWr) return false;
      if ((d.closedTokens || 0) < minClosed) return false;
      if ((d.medianHoldSec ?? -1) < minHold) return false;
      if ((d.spanDays || 0) < minSpan) return false;
      if (netPosOnly && (netVal <= 0 || (d.realizedPnlSol || 0) <= 0)) return false;
      if (greenDaysOnly && cm.activeDays >= 2 && cm.pct < 50) return false;
    }
    if (q) {
      const hay = `${w.name} ${w.address} ${w.identity?.handle || ''} ${w.style?.label || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if ($('fltMatchCount')) $('fltMatchCount').textContent = `Showing ${rows.length} wallets`;

  rows.sort((a, b) => {
    if (sortBy === 'copyScore') return (b.copyScore ?? -1) - (a.copyScore ?? -1) || (b.solBalance ?? -1) - (a.solBalance ?? -1);
    if (sortBy === 'consistency') {
      const ca = getConsistencyMetrics(a.deep);
      const cb = getConsistencyMetrics(b.deep);
      return (cb.pct - ca.pct) || ((b.deep?.winRate ?? -1) - (a.deep?.winRate ?? -1)) || ((b.deep?.strictNetFlowSol ?? -9999) - (a.deep?.strictNetFlowSol ?? -9999));
    }
    if (sortBy === 'profitFactor') return (getConsistencyMetrics(b.deep).pf - getConsistencyMetrics(a.deep).pf) || ((b.deep?.winRate ?? -1) - (a.deep?.winRate ?? -1));
    if (sortBy === 'pnl') return (b.deep?.strictNetFlowSol ?? b.deep?.realizedPnlSol ?? -9999) - (a.deep?.strictNetFlowSol ?? a.deep?.realizedPnlSol ?? -9999);
    if (sortBy === 'winRate') return (b.deep?.winRate ?? -1) - (a.deep?.winRate ?? -1);
    if (sortBy === 'solBalance') return (b.solBalance ?? -1) - (a.solBalance ?? -1);
    if (sortBy === 'lastTxTime') return (b.lastTxTime ?? 0) - (a.lastTxTime ?? 0);
    return 0;
  });

  const display = rows.slice(0, 200);
  $('allWalletsBody').innerHTML = display.map((w) => {
    const d = w.deep;
    const netVal = d ? (typeof d.strictNetFlowSol === 'number' ? d.strictNetFlowSol : d.realizedPnlSol) : null;
    const rCls = d ? (d.realizedPnlSol >= 0 ? 'pos' : 'neg') : 'muted';
    const nCls = netVal !== null ? (netVal >= 0 ? 'pos' : 'neg') : 'muted';
    const cm = getConsistencyMetrics(d);
    const consStr = d ? `${cm.activeDays ? `<span class="${cm.pct >= 50 ? 'pos' : 'neg'}">${cm.greenDays}/${cm.activeDays}d (${cm.pct}%)</span>` : '-'}${cm.pf ? ` · <b>${cm.pf}x</b>` : ''}` : '-';
    return `
      <tr>
        <td><b style="cursor:pointer;" onclick="copyText('${w.address}')">${escHtml(w.emoji)} ${escHtml(w.name)}</b> <span class="mono muted" style="font-size:10.5px;">${shortAddr(w.address)}</span>${identityBadge(w)}</td>
        <td>${styleBadge(w)}</td>
        <td class="mono muted" style="font-size:11px;">${escHtml(w.cadence?.label || '-')}</td>
        <td><span class="badge badge-${w.tier}">${w.tier}</span></td>
        <td class="mono">${w.solBalance !== null ? w.solBalance.toFixed(1) : '-'}</td>
        <td class="mono">${d ? `${gatePill(d)} <b>${d.copyScore}</b>` : '-'}</td>
        <td class="mono">${fmtSpan(d)}</td>
        <td class="mono">${d ? `<b>${d.winRate}%</b> <span class="muted">(${d.closedTokens})</span>` : '-'}</td>
        <td class="mono" style="font-size:11px;">${consStr}</td>
        <td class="mono">${d ? `<span class="${rCls}">${d.realizedPnlSol >= 0 ? '+' : ''}${d.realizedPnlSol}</span> <span class="muted">/</span> <span class="${nCls}">${netVal >= 0 ? '+' : ''}${netVal}</span>` : '-'}</td>
        <td class="mono">${d ? fmtHold(d.medianHoldSec) : '-'}</td>
        <td>
          <button class="btn btn-xs btn-primary" onclick="jumpToInvestigate('${w.address}')">Investigate</button>
          <a class="btn btn-xs" href="https://intel.arkm.com/explorer/address/${w.address}" target="_blank">Arkham</a>
          <a class="btn btn-xs" href="https://gmgn.ai/sol/address/${w.address}" target="_blank">GMGN</a>
        </td>
      </tr>`;
  }).join('');
}

async function startStage1(forceAll) {
  try {
    await api('/api/audit/stage1', { method: 'POST', body: JSON.stringify({ forceAll }) });
    showToast('Stage 1 Fast Triage dimulai...');
    refreshWallets();
  } catch (err) { showToast(err.message, true); }
}

async function startStage2(maxWallets, reAuditExisting = false) {
  try {
    const windowDays = Number($('stage2WindowDays')?.value) || 7;
    await api('/api/audit/stage2', {
      method: 'POST',
      body: JSON.stringify({ maxWallets, minSol: 0.2, onlyActiveDays: 14, windowDays, maxPages: windowDays >= 30 ? 4 : 3, reAuditExisting })
    });
    showToast(`Strict ${windowDays}D 4-Gate Audit dimulai untuk ${maxWallets} wallet...`);
    refreshWallets();
  } catch (err) { showToast(err.message, true); }
}

async function reAuditTopExisting() {
  const existing = allWallets.filter((w) => w.stage2Done).map((w) => w.address);
  if (!existing.length) return showToast('Belum ada wallet yang sudah Stage 2.', true);
  const windowDays = Number($('stage2WindowDays')?.value) || 7;
  try {
    await api('/api/audit/stage2', {
      method: 'POST',
      body: JSON.stringify({ addresses: existing, windowDays, maxPages: windowDays >= 30 ? 4 : 3 })
    });
    showToast(`Re-auditing ${existing.length} wallet pakai Engine v2 (Strict ${windowDays}D 4-Gate)...`);
    refreshWallets();
  } catch (err) { showToast(err.message, true); }
}

async function stopAuditJob() {
  try { await api('/api/audit/stop', { method: 'POST' }); showToast('Menghentikan scan...'); } catch {}
}

// === FULL INVESTIGATOR + SIDE-WALLET & BRIDGE TRACER ===
function jumpToInvestigate(address) {
  switchTab('tracer');
  $('traceAddressInput').value = address;
  runFullInvestigation(false);
}

async function runFullInvestigation(forceRefresh = false) {
  const address = $('traceAddressInput').value.trim();
  if (!address) return showToast('Masukkan Solana wallet address dulu!', true);
  const depth = Number($('traceDepth').value) || 2;
  const windowDays = Number($('invWindowDays').value) || 7;
  const btn = $('btnRunFullInvestigate');
  btn.disabled = true;
  btn.textContent = '⏳ Investigating + Tracing...';
  $('traceStatsLine').textContent = `Menjalankan Strict ${windowDays}D 4-Gate Audit + Side-Wallet & Bridge Hop-${depth} untuk ${address}...`;

  try {
    const [inv, trace] = await Promise.all([
      api('/api/investigate', { method: 'POST', body: JSON.stringify({ address, windowDays }) }),
      api('/api/trace', { method: 'POST', body: JSON.stringify({ address, depth, checkCexDeposit: true, forceRefresh }) })
    ]);
    if (trace.credits) updateCredits(trace.credits);
    renderDossier(inv, trace);
    renderTraceResult(trace);
    loadCachedTraces();
    showToast(`Investigasi selesai! Verdict: ${inv.deep.verdict}`);
  } catch (err) {
    showToast(err.message, true);
    $('traceStatsLine').textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Full Investigate + Trace';
  }
}

function renderDossier(inv, trace) {
  const box = $('investigatorDossier');
  box.style.display = 'block';
  const d = inv.deep;
  const links = inv.links;

  const vColor = d.tier === 'ELITE' ? '#00e599' : d.tier === 'GOOD' || d.tier === 'KOL_SCALPER' ? '#38bdf8' : '#ff4d6d';
  const idHtml = inv.identity?.verified ? `<span class="badge badge-KOL" style="margin-left:6px;">${escHtml(inv.identity.label)}</span>` : '';
  const styleHtml = inv.style?.label ? `<span class="badge badge-${inv.style.code}" style="margin-left:6px;">${escHtml(inv.style.label)}</span>` : '';
  $('invVerdictTitle').innerHTML =
    `<span style="color:${vColor}">${escHtml(d.verdict)}</span>` +
    `${idHtml}${styleHtml} ` +
    `<span class="badge badge-${d.tier}" style="margin-left:6px;">${d.gatesPassed}/4 GATES · SCORE ${d.copyScore}</span>`;

  $('invSubMeta').innerHTML =
    `Wallet: <b>${escHtml(trace.targetName)}</b> (${inv.address}) · Bal: <b>${inv.solBalance} SOL</b> · ` +
    `Cadence: <b>${escHtml(inv.cadence?.label || '-')}</b> · ` +
    `Window: <b>${d.windowDays}D</b> (${fmtSpan(d)}, ${d.totalTxAnalyzed} tx) · ` +
    `Realized: <b>${d.realizedPnlSol >= 0 ? '+' : ''}${d.realizedPnlSol} SOL</b> · ` +
    `Strict Net Flow: <b class="${d.strictNetFlowSol >= 0 ? 'pos' : 'neg'}">${d.strictNetFlowSol >= 0 ? '+' : ''}${d.strictNetFlowSol} SOL</b> · ` +
    `Unsold Bags: <b>${d.openTokens} (${d.openCostSol} SOL)</b>`;

  $('invExternalLinks').innerHTML = `
    <a class="btn btn-xs btn-amber" href="${links.arkham}" target="_blank">🔎 Arkham Intel</a>
    <a class="btn btn-xs" href="${links.solscan}" target="_blank">Solscan</a>
    <a class="btn btn-xs" href="${links.solscanTransfers}" target="_blank">Solscan Transfers</a>
    <a class="btn btn-xs" href="${links.gmgn}" target="_blank">GMGN</a>
    <a class="btn btn-xs" href="${links.axiom}" target="_blank">Axiom</a>
    <a class="btn btn-xs" href="${links.cielo}" target="_blank">Cielo</a>
    <a class="btn btn-xs" href="${links.orb}" target="_blank">Helius Orb</a>
    <a class="btn btn-xs" href="${links.wormholescan}" target="_blank">Wormholescan</a>
    <a class="btn btn-xs" href="${links.debridge}" target="_blank">deBridge</a>
    <a class="btn btn-xs" href="${links.mayan}" target="_blank">Mayan</a>
  `;

  const g = d.gates;
  const gateCards = [
    { title: '1. Data Trustworthy?', obj: g.trustworthy },
    { title: `2. Still Earning (${d.windowDays}D)?`, obj: g.earningNow },
    { title: '3. Human Fillable?', obj: g.fillable },
    { title: '4. Cuts Losses?', obj: g.cutsLosses }
  ];
  $('invGateGrid').innerHTML = gateCards.map((c) => `
    <div class="gate-card ${c.obj.pass ? 'pass' : 'fail'}">
      <div style="font-weight:600;color:${c.obj.pass ? '#00e599' : '#ff4d6d'}">${c.obj.pass ? '✅' : '❌'} ${c.title}</div>
      <div class="mono muted" style="font-size:11px;margin-top:4px;">${escHtml(c.obj.detail)}</div>
    </div>
  `).join('');

  $('invDailyBars').innerHTML = (d.dailyPnl || []).length
    ? d.dailyPnl.map((day) => `
        <div class="day-chip ${day.netSol >= 0 ? 'pos' : 'neg'}">
          ${day.date.slice(5)}: <b>${day.netSol >= 0 ? '+' : ''}${day.netSol} SOL</b> <span class="muted">(${day.buys}B/${day.sells}S)</span>
        </div>`).join('')
    : '<span class="muted">Tidak ada swap di periode ini.</span>';

  const bBanner = $('invBridgeBanner');
  if (trace.bridgesDetected && trace.bridgesDetected.length > 0) {
    bBanner.style.display = 'block';
    bBanner.innerHTML = `🌉 <b>CROSS-CHAIN BRIDGE / INSTANT SWAP TERDETEKSI (${trace.bridgesDetected.length}x):</b> ` +
      trace.bridgesDetected.slice(0, 5).map((b) =>
        `<span class="mono">${escHtml(b.bridge)} (${b.solMoved} SOL)</span>`
      ).join(' · ') + ' — <i>Cek Wormholescan / deBridge / Mayan / Arkham di toolbar atas untuk lacak wallet chain asal (ETH/Base/Arb)!</i>';
  } else {
    bBanner.style.display = 'none';
  }
}

function renderTraceResult(data) {
  $('traceStatsLine').innerHTML =
    `Target: <b>${escHtml(data.targetName)}</b> (${shortAddr(data.target)}) · ` +
    `Tx Scanned: <b>${data.stats.rootTxScanned}</b> · Nodes: <b>${data.stats.nodesCount}</b> · ` +
    `Side Wallets: <b class="pos">${data.stats.suspectsCount}</b> · ` +
    `Shared CEX (95%+): <b style="color:var(--cyan)">${data.stats.confirmedCexMatches}</b> · ` +
    `Bridges: <b style="color:#e879f9">${data.stats.bridgesCount || 0}</b>`;

  $('suspectsCountBadge').textContent = `${data.suspects.length} found`;

  if (!data.suspects.length) {
    $('suspectsList').innerHTML = '<div class="card-body muted">Tidak ditemukan koneksi transfer langsung / shared CEX deposit di 200 tx terakhir. Cek tombol <b>Arkham Intel</b> &amp; <b>Solscan Transfers</b> di atas untuk funding historis pertama!</div>';
  } else {
    $('suspectsList').innerHTML = data.suspects.map((s) => {
      const badgeColor = s.confidence >= 90 ? 'badge-ELITE' : s.confidence >= 75 ? 'badge-GOOD' : 'badge-ACTIVE';
      return `
        <div style="padding:10px 14px;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span class="mono" style="font-weight:600;cursor:pointer;" onclick="copyText('${s.address}')">
              ${s.trackedName ? `⭐ ${escHtml(s.trackedName)} · ` : ''}${shortAddr(s.address)}
            </span>
            <span class="badge ${badgeColor}">${s.confidence}% CONF</span>
          </div>
          <div class="mono muted" style="font-size:11px;margin-top:3px;">
            Bal: <b>${s.solBalance !== null ? s.solBalance : '?'} SOL</b> | Flow: ${s.totalSolFlow} SOL | Hop-${s.hop}
          </div>
          <div style="font-size:11.5px;margin-top:4px;color:#cbd5e1;">
            ${s.reasons.map((r) => `• ${escHtml(r)}`).join('<br>')}
          </div>
          <div class="controls-row" style="margin-top:6px;">
            <button class="btn btn-xs btn-primary" onclick="jumpToInvestigate('${s.address}')">Investigate</button>
            <a class="btn btn-xs btn-amber" href="https://intel.arkm.com/explorer/address/${s.address}" target="_blank">Arkham</a>
            <a class="btn btn-xs" href="https://solscan.io/account/${s.address}#transfers" target="_blank">Solscan</a>
            <a class="btn btn-xs" href="https://gmgn.ai/sol/address/${s.address}" target="_blank">GMGN</a>
          </div>
        </div>`;
    }).join('');
  }

  renderGraphSvg(data);
}

function renderGraphSvg(data) {
  const svg = $('traceGraphSvg');
  const width = svg.clientWidth || 860;
  const height = svg.clientHeight || 520;
  graphView = { x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0 };

  const cx = width / 2;
  const cy = height / 2;
  const hop0 = data.nodes.filter((n) => n.hop === 0);
  const hop1 = data.nodes.filter((n) => n.hop === 1);
  const hop2 = data.nodes.filter((n) => n.hop >= 2);

  const pos = new Map();
  hop0.forEach((n) => pos.set(n.id, { x: cx, y: cy }));
  hop1.forEach((n, i) => {
    const angle = (i / Math.max(1, hop1.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, { x: cx + Math.cos(angle) * 185, y: cy + Math.sin(angle) * 155 });
  });
  hop2.forEach((n, i) => {
    const angle = (i / Math.max(1, hop2.length)) * Math.PI * 2 - Math.PI / 2 + 0.25;
    pos.set(n.id, { x: cx + Math.cos(angle) * 340, y: cy + Math.sin(angle) * 230 });
  });

  const roleColor = {
    TARGET: '#00e599',
    CONFIRMED_SIDE: '#38bdf8',
    BRIDGE: '#e879f9',
    FUNDER: '#a78bfa',
    RECIPIENT: '#a78bfa',
    SPL_LINK: '#c084fc',
    HOP2_WALLET: '#64748b',
    CEX_DEPOSIT: '#ffb703',
    CEX: '#ff4d6d',
    MEV: '#475569',
    PROTOCOL: '#475569'
  };

  let edgeMarkup = '';
  for (const e of data.edges) {
    const p1 = pos.get(e.from);
    const p2 = pos.get(e.to);
    if (!p1 || !p2) continue;
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2 - 14;
    const stroke = e.type === 'SHARED_CEX_DEPOSIT'
      ? '#38bdf8'
      : e.type === 'BRIDGE_HOP'
        ? '#e879f9'
        : e.type === 'CEX_SWEEP'
          ? '#ffb703'
          : e.type === 'SPL_TRANSFER'
            ? '#c084fc'
            : '#334155';
    const dash = e.type === 'HOP2_SOL' ? 'stroke-dasharray="4 3"' : '';
    edgeMarkup += `
      <path d="M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}" fill="none" stroke="${stroke}" stroke-width="${e.type === 'SHARED_CEX_DEPOSIT' || e.type === 'BRIDGE_HOP' ? 2.4 : 1.5}" ${dash} marker-end="url(#arrow)" opacity="0.85"/>
      <text x="${mx}" y="${my}" fill="#94a3b8" font-size="9.5" font-family="monospace" text-anchor="middle">${escHtml(e.label)}</text>
    `;
  }

  let nodeMarkup = '';
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const color = roleColor[n.role] || '#94a3b8';
    const r = n.role === 'TARGET' ? 18 : n.role === 'CONFIRMED_SIDE' || n.role === 'BRIDGE' ? 14 : 11;
    nodeMarkup += `
      <g class="graph-node" style="cursor:pointer;" onclick="copyText('${n.id}')">
        <circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="${color}" opacity="0.14"/>
        <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#0d1118" stroke="${color}" stroke-width="2.2"/>
        <text x="${p.x}" y="${p.y + r + 13}" fill="#e6edf7" font-size="10.5" font-weight="600" font-family="monospace" text-anchor="middle">${escHtml(n.label)}</text>
        <text x="${p.x}" y="${p.y + r + 25}" fill="#7f8ea3" font-size="9.5" font-family="monospace" text-anchor="middle">${n.solBalance !== null ? `${n.solBalance} SOL` : ''}</text>
      </g>
    `;
  }

  svg.innerHTML = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/>
      </marker>
    </defs>
    <g id="graphViewport">${edgeMarkup}${nodeMarkup}</g>
  `;
}

const svgEl = $('traceGraphSvg');
svgEl.addEventListener('mousedown', (e) => {
  graphView.dragging = true;
  graphView.startX = e.clientX - graphView.x;
  graphView.startY = e.clientY - graphView.y;
});
window.addEventListener('mousemove', (e) => {
  if (!graphView.dragging) return;
  graphView.x = e.clientX - graphView.startX;
  graphView.y = e.clientY - graphView.startY;
  applyGraphTransform();
});
window.addEventListener('mouseup', () => { graphView.dragging = false; });
svgEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.1 : 0.9;
  graphView.scale = Math.max(0.4, Math.min(2.5, graphView.scale * delta));
  applyGraphTransform();
}, { passive: false });

function applyGraphTransform() {
  const vp = $('graphViewport');
  if (vp) vp.setAttribute('transform', `translate(${graphView.x},${graphView.y}) scale(${graphView.scale})`);
}

async function loadCachedTraces() {
  try {
    const res = await api('/api/traces');
    const list = res.traces || [];
    if (!list.length) {
      $('cachedTracesList').innerHTML = '<span class="muted">Belum ada history trace.</span>';
      return;
    }
    $('cachedTracesList').innerHTML = list.map((t) =>
      `<button class="btn btn-xs" onclick="jumpToInvestigate('${t.target}')">${escHtml(t.targetName)} (${t.stats.suspectsCount} side)</button>`
    ).join('');
  } catch {}
}

// === ALPHA HUNTER (BEVAN METHOD) ===
async function loadTrendingRunners() {
  const btn = $('btnLoadRunners');
  btn.disabled = true;
  btn.textContent = '⏳ Loading DexScreener...';
  try {
    const res = await api('/api/alpha/runners');
    const runners = res.runners || [];
    if (!runners.length) {
      showToast('Tidak ada trending Solana runner ditemukan saat ini.', true);
      return;
    }
    $('trendingRunnersBox').innerHTML = runners.map((r) => `
      <div class="runner-chip ${selectedRunnerMints.has(r.mint) ? 'selected' : ''}" onclick="toggleRunnerMint('${r.mint}', this)">
        <b>$${escHtml(r.symbol)}</b>
        <span class="muted">MC ${fmtUsd(r.marketCap)} · Vol ${fmtUsd(r.volume24h)}</span>
      </div>
    `).join('');
    showToast(`Loaded ${runners.length} Solana runners! Klik 2–4 koin di atas untuk pilih.`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 1. Auto-Load Trending Runners (0 cr)';
  }
}

function toggleRunnerMint(mint, el) {
  if (selectedRunnerMints.has(mint)) {
    selectedRunnerMints.delete(mint);
    el.classList.remove('selected');
  } else {
    if (selectedRunnerMints.size >= 6) return showToast('Maksimal 6 token runner sekali scan.', true);
    selectedRunnerMints.add(mint);
    el.classList.add('selected');
  }
  $('alphaMintsInput').value = [...selectedRunnerMints].join('\n');
}

async function startAlphaHuntUI() {
  const raw = $('alphaMintsInput').value.trim();
  const mints = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (!mints.length) return showToast('Masukkan minimal 1 Token CA runner (atau klik Auto-Load Trending Runners)!', true);

  try {
    await api('/api/alpha/hunt', {
      method: 'POST',
      body: JSON.stringify({
        mints,
        maxCandidates: Number($('alphaMaxCand').value) || 15,
        windowDays: Number($('alphaWindowDays').value) || 7,
        onlyNewOutsideList: $('alphaOnlyNew').checked
      })
    });
    showToast(`Alpha Hunt dimulai pada ${mints.length} koin runner!`);
    refreshAlphaState();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function stopAlphaHuntUI() {
  try { await api('/api/alpha/stop', { method: 'POST' }); showToast('Menghentikan Alpha Hunter...'); } catch {}
}

async function refreshAlphaState() {
  try {
    const res = await api('/api/alpha/state');
    if (res.credits) updateCredits(res.credits);
    const job = res.job;
    $('btnStartAlphaHunt').style.display = job.running ? 'none' : 'inline-flex';
    $('btnStopAlphaHunt').style.display = job.running ? 'inline-flex' : 'none';
    $('alphaStatusLine').textContent = job.running
      ? `⏳ [${job.processed}/${job.total}] ${job.step}`
      : res.data?.updatedAt
        ? `Last hunt: ${new Date(res.data.updatedAt).toLocaleString()} · Runners: ${(res.data.runnersAnalyzed || []).map((r) => '$' + r.symbol).join(', ')} · Total buyers found: ${res.data.totalUniqueBuyersFound || 0}`
        : '';

    const list = res.data?.wallets || [];
    $('alphaFoundBadge').textContent = `${list.length} audited`;
    if (list.length > 0) {
      $('alphaResultsBody').innerHTML = list.map((w) => {
        const d = w.deep;
        const netVal = d.strictNetFlowSol;
        const pnlCls = netVal >= 0 ? 'pos' : 'neg';
        return `
          <tr>
            <td class="mono" style="cursor:pointer;" onclick="copyText('${w.address}')"><b>${shortAddr(w.address)}</b></td>
            <td><span class="badge ${w.inMyList ? 'badge-ACTIVE' : 'badge-ELITE'}">${w.inMyList ? 'IN LIST' : 'NEW ALPHA'}</span></td>
            <td class="mono"><b>${w.runnersCount}x</b> <span class="muted">(${w.runnersHit.map((s) => '$' + escHtml(s)).join(', ')})</span></td>
            <td>${gatePill(d)} <span class="badge badge-${w.tier}">${w.tier}</span></td>
            <td class="mono"><b>${d.copyScore}</b></td>
            <td class="mono">${w.solBalance.toFixed(2)}</td>
            <td class="mono">${d.winRate}% (${d.wins}W/${d.losses}L)</td>
            <td class="mono ${pnlCls}">${d.realizedPnlSol >= 0 ? '+' : ''}${d.realizedPnlSol} / <b>${netVal >= 0 ? '+' : ''}${netVal}</b></td>
            <td class="mono">${fmtHold(d.medianHoldSec)}</td>
            <td>
              <button class="btn btn-xs btn-primary" onclick="jumpToInvestigate('${w.address}')">Investigate</button>
              <a class="btn btn-xs btn-amber" href="https://intel.arkm.com/explorer/address/${w.address}" target="_blank">Arkham</a>
              <a class="btn btn-xs" href="https://gmgn.ai/sol/address/${w.address}" target="_blank">GMGN</a>
            </td>
          </tr>`;
      }).join('');
    }

    if (job.running) {
      clearTimeout(alphaPollTimer);
      alphaPollTimer = setTimeout(refreshAlphaState, 2000);
    }
  } catch {}
}

// === CONSENSUS PING ===
async function refreshPinger() {
  try {
    const p = await api('/api/pinger');
    if (p.credits) updateCredits(p.credits);
    $('btnStartPing').style.display = p.running ? 'none' : 'inline-flex';
    $('btnStopPing').style.display = p.running ? 'inline-flex' : 'none';
    $('pingerStatusLine').innerHTML = p.running
      ? `<span class="pos">● LIVE MONITORING</span> — Watching <b>${p.watchlistCount}</b> wallets | Consensus: <b>&ge;${p.minConsensusWallets}</b> wallets dalam <b>${p.windowMinutes}m</b> | Last poll: ${p.lastPollAt ? fmtAgo(Math.floor(p.lastPollAt / 1000)) : 'starting...'}`
      : `Stopped. Klik <b>▶ Start Live Ping</b> saat sesi trenching (Opsi 1: 21:30–23:30 WIB).`;

    $('consensusCount').textContent = `${p.consensus.length} alerts`;
    $('consensusFeed').innerHTML = p.consensus.length
      ? p.consensus.map((c) => `
          <div class="ping-item consensus">
            <div>
              <div>
                <b>🔥 ${c.walletCount} tracked wallets bought $${escHtml(c.symbol)}</b>
                <span class="muted mono">(${c.totalSol} SOL in ${c.spanMin}m)</span>
                ${c.passesTrench3Sec ? '<span class="badge badge-ELITE" style="margin-left:6px;">✅ PASS 3-SEC FILTER</span>' : ''}
              </div>
              <div class="mono muted" style="font-size:11px;margin-top:3px;">
                MC: <b style="color:var(--text)">${fmtUsd(c.marketCap)}</b> · Liq: ${fmtUsd(c.liquidityUsd)} · 5m Vol: ${fmtUsd(c.volume5m)} · V/MC: ${c.volMcRatio ?? '-'}x · Rug: ${c.rugScore ?? '-'} · ${fmtAgo(c.ts)}
              </div>
              <div class="muted" style="font-size:11.5px;margin-top:2px;">
                Buyers: ${c.wallets.map((w) => `${escHtml(w.name)} (${w.sol} SOL)`).join(', ')}
              </div>
            </div>
            <div class="controls-row">
              <a class="btn btn-primary btn-xs" href="${c.padreUrl}" target="_blank">Open Padre</a>
              <a class="btn btn-xs" href="${c.dexUrl}" target="_blank">DexScreener</a>
              <button class="btn btn-xs" onclick="copyText('${c.mint}')">Copy CA</button>
            </div>
          </div>`).join('')
      : '<div class="card-body muted">Belum ada Consensus Buy.</div>';

    $('rawPingsCount').textContent = `${p.pings.length} swaps`;
    $('rawPingsFeed').innerHTML = p.pings.length
      ? p.pings.slice(0, 40).map((item) => `
          <div class="ping-item">
            <div>
              <span class="badge badge-${item.tier}">${item.tier}</span>
              <b>${escHtml(item.walletName)}</b> bought <b class="pos">${item.solSpent} SOL</b> of <b>$${escHtml(item.symbol)}</b>
              <span class="mono muted" style="margin-left:6px;">MC ${fmtUsd(item.marketCap)} · ${fmtAgo(item.ts)}</span>
            </div>
            <div class="controls-row">
              <a class="btn btn-xs" href="${item.padreUrl}" target="_blank">Padre</a>
              <button class="btn btn-xs" onclick="copyText('${item.mint}')">CA</button>
            </div>
          </div>`).join('')
      : '<div class="card-body muted">Belum ada swap masuk.</div>';
  } catch {}
}

async function startPingerUI() {
  try {
    await api('/api/pinger/start', {
      method: 'POST',
      body: JSON.stringify({
        minConsensusWallets: Number($('pingMinWallets').value) || 2,
        windowMinutes: Number($('pingWindowMin').value) || 15,
        maxWallets: Number($('pingWatchTop').value) || 20,
        pollIntervalSec: 45
      })
    });
    showToast('Live Consensus Ping dimulai!');
    refreshPinger();
  } catch (err) { showToast(err.message, true); }
}

async function stopPingerUI() {
  try { await api('/api/pinger/stop', { method: 'POST' }); showToast('Live Ping dihentikan.'); refreshPinger(); } catch {}
}

// === BODYGUARD, 3-SEC FILTER & KOBE 5/5 SCORECARD ===
let bgCooldownEndTs = 0;

function updateWibClockUI() {
  const clockEl = $('bgClockWib');
  if (!clockEl) return;
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  clockEl.textContent = `${d.toISOString().slice(11, 19)} WIB`;
  if (bgCooldownEndTs > Date.now()) {
    const rem = Math.max(0, Math.ceil((bgCooldownEndTs - Date.now()) / 1000));
    const mm = String(Math.floor(rem / 60)).padStart(2, '0');
    const ss = String(rem % 60).padStart(2, '0');
    const tEl = $('bgGuardTitle');
    if (tEl && tEl.dataset.level === 'COOLDOWN') {
      tEl.textContent = `🛑 COOLDOWN 30 MENIT AKTIF (${mm}:${ss} tersisa)`;
    }
  }
}

function renderBodyguardData(snap) {
  if (!snap) return;
  if (snap.credits) updateCredits(snap.credits);

  // 1. WIB Opsi 1 Session Banner
  const sess = snap.session;
  if (sess) {
    $('bgSessionBadge').textContent = sess.badge;
    $('bgSessionMsg').textContent = sess.msg;
    const sb = $('bgSessionBanner');
    sb.style.borderColor = sess.color === 'green' ? 'rgba(0,229,153,0.5)' : sess.color === 'red' ? 'rgba(255,77,109,0.5)' : sess.color === 'amber' ? 'rgba(255,183,3,0.5)' : 'rgba(56,189,248,0.4)';
  }

  if (snap.myWallet && !$('bgWalletInput').value) {
    $('bgWalletInput').value = snap.myWallet;
  }

  // 2. Scorecard
  const sc = snap.scorecard;
  if (sc) {
    $('scDateLabel').textContent = sc.todayDate;
    $('scScoreBadge').textContent = `${sc.todayScore} / 5`;
    $('scScoreBadge').style.color = sc.todayScore === 5 ? 'var(--green)' : sc.todayScore >= 3 ? 'var(--amber)' : 'var(--red)';
    $('bgKpiStreak').textContent = `${sc.perfectStreak}d`;
    $('bgKpiNoGoon').textContent = `0-Goon Streak: ${sc.noGoonStreak}d · Today: ${sc.todayScore}/5`;
    const c = sc.today?.checks || {};
    ['officeClean', 'noGooning', 'gymAndDinner', 'tradingSop', 'sleepOnTime'].forEach((k) => {
      const el = $(`sc_${k}`);
      if (el) el.checked = Boolean(c[k]);
    });
    if ($('scNoteInput') && document.activeElement !== $('scNoteInput')) {
      $('scNoteInput').value = sc.today?.note || '';
    }
    $('scHistoryChips').innerHTML = (sc.history || []).map((h) => {
      const cls = h.score === 5 ? 'pos' : h.score <= 2 ? 'neg' : '';
      return `<span class="day-chip ${cls}" title="${escHtml(h.note || '')}">${h.date.slice(5)}: <b>${h.score}/5</b></span>`;
    }).join('');
  }

  // 3. Wallet Audit & Guard Banner
  const a = snap.audit;
  if (!a) return;

  const g = a.guardStatus || {};
  const gb = $('bgGuardBanner');
  $('bgGuardTitle').textContent = g.title || '🛡 Personal Trading Bodyguard';
  $('bgGuardTitle').dataset.level = g.level || 'READY';
  $('bgGuardMsg').textContent = g.message || '';
  if (g.level === 'DAILY_STOP' || g.level === 'COOLDOWN') {
    gb.style.borderColor = 'rgba(255,77,109,0.7)';
    gb.style.background = 'rgba(255,77,109,0.1)';
    bgCooldownEndTs = g.cooldownRemainingSec ? Date.now() + g.cooldownRemainingSec * 1000 : 0;
  } else if (g.level === 'WIN_LOCK') {
    gb.style.borderColor = 'rgba(0,229,153,0.7)';
    gb.style.background = 'rgba(0,229,153,0.1)';
    bgCooldownEndTs = 0;
  } else {
    gb.style.borderColor = 'rgba(0,229,153,0.35)';
    gb.style.background = 'var(--bg-elev)';
    bgCooldownEndTs = 0;
  }

  $('bgKpiSol').textContent = `${a.liquidSol.toFixed(3)} SOL`;
  $('bgKpiRent').textContent = a.emptyAccounts > 0
    ? `⚡ +${a.reclaimableSol.toFixed(4)} SOL rent (${a.emptyAccounts} akun kosong) → Efektif ${a.effectiveSol.toFixed(3)} SOL`
    : `0 akun kosong · Efektif ${a.effectiveSol.toFixed(3)} SOL`;
  $('bgKpiBid').textContent = `${a.sizing.bid} SOL`;
  $('bgKpiTier').textContent = `${a.sizing.tierLabel} · ~${a.sizing.maxBulletsLoss}x nyawa loss`;

  const tPnl = a.today?.pnlSol || 0;
  $('bgKpiTodayPnl').textContent = `${tPnl >= 0 ? '+' : ''}${tPnl.toFixed(4)} SOL`;
  $('bgKpiTodayPnl').className = `kpi-value ${tPnl >= 0 ? 'pos' : 'neg'}`;
  $('bgKpiTodayWl').textContent = `${a.today?.wins || 0}W / ${a.today?.losses || 0}L · ${a.today?.oversizes || 0} oversize · ${a.today?.panicHolds || 0} fast(<35s)`;

  $('bgKpiOverallWr').textContent = `${a.overall?.winRate || 0}% (${a.overall?.wins || 0}W/${a.overall?.losses || 0}L)`;
  const nDep = a.netFromDepositSol || 0;
  $('bgKpiOverallSub').textContent = a.totalDepositedSol > 0
    ? `Deposit ${a.totalDepositedSol} SOL · Net ${nDep >= 0 ? '+' : ''}${nDep} SOL`
    : `${a.overall?.closedTrades || 0} closed trades`;

  $('bgDailySummaryChips').innerHTML = (a.dailySummary || []).slice(0, 7).map((d) => {
    const cls = d.pnlSol >= 0 ? 'pos' : 'neg';
    return `<span class="day-chip ${cls}">${d.date.slice(5)}: <b>${d.pnlSol >= 0 ? '+' : ''}${d.pnlSol.toFixed(3)} SOL</b> (${d.wins}W/${d.losses}L)</span>`;
  }).join('');

  $('bgTradesBody').innerHTML = (a.trades || []).length
    ? a.trades.map((t) => {
        const cls = t.pnlSol >= 0 ? 'pos' : 'neg';
        const flags = [];
        if (t.isOversize) flags.push('<span class="badge badge-BOT">⚠ OVERSIZE</span>');
        if (t.isPanicHold) flags.push('<span class="badge badge-LOSER">⚡ FAST &lt;35s</span>');
        if (!t.isOversize && !t.isPanicHold && t.isWin) flags.push('<span class="badge badge-ELITE">✅ CLEAN SOP</span>');
        if (!flags.length) flags.push('<span class="muted">Normal</span>');
        return `
          <tr>
            <td class="mono">${t.date} <span class="muted">${t.firstTime}</span></td>
            <td><b style="cursor:pointer;" onclick="copyText('${t.mint}')">$${escHtml(t.symbol)}</b></td>
            <td class="mono">${fmtHold(t.holdSec)}</td>
            <td class="mono">${t.buySol.toFixed(4)}</td>
            <td class="mono">${t.sellSol.toFixed(4)}</td>
            <td class="mono ${cls}"><b>${t.pnlSol >= 0 ? '+' : ''}${t.pnlSol.toFixed(4)}</b> (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct}%)</td>
            <td>${flags.join(' ')}</td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="muted" style="text-align:center;padding:18px;">Belum ada trade tercatat.</td></tr>';
}

async function refreshBodyguard() {
  try {
    const snap = await api('/api/bodyguard');
    renderBodyguardData(snap);
  } catch {}
}

async function scanMyWalletUI() {
  const wallet = $('bgWalletInput').value.trim();
  const btn = $('btnScanMyWallet');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning...';
  try {
    const snap = await api('/api/bodyguard/scan', {
      method: 'POST',
      body: JSON.stringify({ wallet })
    });
    renderBodyguardData(snap);
    showToast(`Wallet discan! Liquid ${snap.audit.liquidSol.toFixed(3)} SOL (+${snap.audit.reclaimableSol.toFixed(4)} rent).`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Scan My Wallet';
  }
}

async function checkToken3SecUI() {
  const mint = $('bgTokenCaInput').value.trim();
  if (!mint) return showToast('Paste Token CA Solana dulu!', true);
  const btn = $('btnCheckToken3Sec');
  btn.disabled = true;
  btn.textContent = '⏳ Cek...';
  try {
    const r = await api('/api/bodyguard/check-token', {
      method: 'POST',
      body: JSON.stringify({ mint })
    });
    const vColor = r.verdict === 'PASS' ? 'var(--green)' : r.verdict === 'WATCH' ? 'var(--amber)' : 'var(--red)';
    $('bgTokenFilterResult').innerHTML = `
      <div style="padding:10px 12px;border-radius:7px;border:1px solid ${vColor};background:var(--bg);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div>
            <b style="font-size:14px;color:${vColor};">${r.verdictLabel}</b>
            <div class="mono muted" style="font-size:11.5px;margin-top:2px;">
              $${escHtml(r.symbol)} (${escHtml(r.dexId)}) · Score <b>${r.passCount}/6</b> · MC <b>${fmtUsd(r.mc)}</b> · Liq ${fmtUsd(r.liq)} (${r.liqMcPct}%) · Age ${r.ageMin ?? '?'}m
            </div>
          </div>
          <div class="controls-row">
            <a class="btn btn-primary btn-xs" href="${r.padreUrl}" target="_blank">Open Padre</a>
            <a class="btn btn-xs" href="${r.dexUrl}" target="_blank">DexScreener</a>
          </div>
        </div>
        <div class="gate-grid" style="margin:10px 0 6px;">
          ${r.checks.map((c) => `
            <div class="gate-card ${c.pass ? 'pass' : c.warn ? '' : 'fail'}" style="padding:7px 9px;">
              <div style="font-size:11.5px;font-weight:600;">${c.pass ? '✅' : c.warn ? '⚠️' : '❌'} ${escHtml(c.name)}</div>
              <div class="mono muted" style="font-size:11px;margin-top:2px;">${escHtml(c.detail)}</div>
            </div>`).join('')}
        </div>
        <div class="mono" style="font-size:11.5px;padding-top:6px;border-top:1px solid var(--border);">
          <b>Rencana Exit Otomatis (dari MC sekarang):</b>
          <span class="neg">SL (-32%): ${fmtUsd(r.plan.stopLossMc)}</span> ·
          <span class="pos">TP1 50% (Sell Init): ${fmtUsd(r.plan.tp1Mc)}</span> ·
          <span class="pos">TP2 30% (~3x): ${fmtUsd(r.plan.tp2Mc)}</span> ·
          <span style="color:var(--cyan);">Moonbag SL: ${fmtUsd(r.plan.moonbagSlMc)}</span>
        </div>
      </div>`;
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cek Filter';
  }
}

async function saveScorecardUI() {
  try {
    const checks = {
      officeClean: $('sc_officeClean').checked,
      noGooning: $('sc_noGooning').checked,
      gymAndDinner: $('sc_gymAndDinner').checked,
      tradingSop: $('sc_tradingSop').checked,
      sleepOnTime: $('sc_sleepOnTime').checked
    };
    const note = $('scNoteInput').value.trim();
    const res = await api('/api/bodyguard/scorecard', {
      method: 'POST',
      body: JSON.stringify({ checks, note })
    });
    renderBodyguardData({ scorecard: res.scorecard });
    if (res.scorecard.todayScore === 5) showToast('🔥 5/5 PERFECT KOBE DAY! Pertahankan besok!');
  } catch (err) {
    showToast(err.message, true);
  }
}

(async () => {
  await refreshConfig();
  await refreshWallets();
  refreshBodyguard();
  updateWibClockUI();
  setInterval(updateWibClockUI, 1000);
  setInterval(() => {
    if ($('tab-pinger').classList.contains('active')) refreshPinger();
  }, 8000);
})();
