const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnv, saveEnv, maskKey } = require('./lib/env');
const { testConnection, getCreditStats } = require('./lib/helius');
const {
  getMergedWallets,
  computeSummary,
  runStage1Triage,
  runStage2DeepAudit,
  investigateWallet,
  stopAudit,
  getJobState,
  exportPadreJson
} = require('./lib/auditor');
const { traceSideWallets, getAllCachedTraces } = require('./lib/tracer');
const {
  fetchTrendingSolanaRunners,
  runAlphaHunt,
  stopAlphaHunt,
  getAlphaHunterState,
  exportAlphaPadreJson
} = require('./lib/alpha-hunter');
const {
  startPinger,
  stopPinger,
  handleHeliusWebhook,
  getPingerStatus
} = require('./lib/pinger');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(PUBLIC_DIR, path.normalize(safePath).replace(/^(\.\.[/\\])+/, ''));
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  try {
    // === CONFIG & HEALTH ===
    if (pathname === '/api/config' && req.method === 'GET') {
      const env = loadEnv();
      return sendJson(res, 200, {
        hasHeliusKey: Boolean(env.HELIUS_API_KEY),
        heliusKeyMasked: maskKey(env.HELIUS_API_KEY),
        walletListPath: env.WALLET_LIST_PATH,
        walletFileExists: fs.existsSync(env.WALLET_LIST_PATH),
        hasTelegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        credits: getCreditStats()
      });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      const updates = {};
      if (typeof body.heliusApiKey === 'string' && body.heliusApiKey.trim()) {
        updates.HELIUS_API_KEY = body.heliusApiKey.trim();
      }
      if (typeof body.walletListPath === 'string' && body.walletListPath.trim()) {
        updates.WALLET_LIST_PATH = body.walletListPath.trim();
      }
      if (typeof body.telegramBotToken === 'string') {
        updates.TELEGRAM_BOT_TOKEN = body.telegramBotToken.trim();
      }
      if (typeof body.telegramChatId === 'string') {
        updates.TELEGRAM_CHAT_ID = body.telegramChatId.trim();
      }
      const next = saveEnv(updates);
      return sendJson(res, 200, {
        ok: true,
        hasHeliusKey: Boolean(next.HELIUS_API_KEY),
        heliusKeyMasked: maskKey(next.HELIUS_API_KEY),
        walletListPath: next.WALLET_LIST_PATH
      });
    }

    if (pathname === '/api/test-helius' && req.method === 'POST') {
      const result = await testConnection();
      return sendJson(res, 200, result);
    }

    // === 927-WALLET AUDITOR & 4-GATE INVESTIGATOR ===
    if (pathname === '/api/wallets' && req.method === 'GET') {
      const wallets = getMergedWallets();
      const summary = computeSummary(wallets);
      return sendJson(res, 200, {
        summary,
        job: getJobState(),
        credits: getCreditStats(),
        wallets
      });
    }

    if (pathname === '/api/audit/stage1' && req.method === 'POST') {
      const body = await readBody(req);
      runStage1Triage({ forceAll: Boolean(body.forceAll) }).catch(() => {});
      return sendJson(res, 200, { ok: true, job: getJobState() });
    }

    if (pathname === '/api/audit/stage2' && req.method === 'POST') {
      const body = await readBody(req);
      runStage2DeepAudit({
        maxWallets: Number(body.maxWallets) || 35,
        minSol: Number(body.minSol ?? 0.2),
        onlyActiveDays: Number(body.onlyActiveDays ?? 14),
        windowDays: Number(body.windowDays ?? 7),
        maxPages: Number(body.maxPages ?? 3),
        reAuditExisting: Boolean(body.reAuditExisting),
        specificAddresses: Array.isArray(body.addresses) ? body.addresses : null
      }).catch(() => {});
      return sendJson(res, 200, { ok: true, job: getJobState() });
    }

    if (pathname === '/api/audit/stop' && req.method === 'POST') {
      stopAudit();
      return sendJson(res, 200, { ok: true, job: getJobState() });
    }

    if (pathname === '/api/investigate' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.address) return sendJson(res, 400, { error: 'Address wajib diisi.' });
      const windowDays = Number(body.windowDays ?? 7);
      // Single-wallet deep investigation pulls up to 16 pages (1,600 txs) so even hyperactive KOLs like cooker cover full 7D!
      const maxPages = Number(body.maxPages) || (windowDays >= 30 ? 20 : 16);
      const result = await investigateWallet(body.address, { windowDays, maxPages });
      return sendJson(res, 200, { ...result, credits: getCreditStats() });
    }

    if (pathname === '/api/export/padre' && req.method === 'GET') {
      const topN = Number(urlObj.searchParams.get('topN') || 50);
      const minScore = Number(urlObj.searchParams.get('minScore') || 50);
      const data = exportPadreJson({ topN, minScore });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="padre-elite-wallets.json"'
      });
      return res.end(JSON.stringify(data, null, 2));
    }

    // === SIDE-WALLET & BRIDGE TRACER ===
    if (pathname === '/api/trace' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.address) return sendJson(res, 400, { error: 'Address wajib diisi.' });
      const result = await traceSideWallets(body.address, {
        depth: Number(body.depth) || 2,
        checkCexDeposit: body.checkCexDeposit !== false,
        minSol: Number(body.minSol ?? 0.05),
        forceRefresh: Boolean(body.forceRefresh)
      });
      return sendJson(res, 200, { ...result, credits: getCreditStats() });
    }

    if (pathname === '/api/traces' && req.method === 'GET') {
      return sendJson(res, 200, { traces: getAllCachedTraces() });
    }

    // === ALPHA HUNTER (BEVAN METHOD: FIND NEW WALLETS OUTSIDE YOUR LIST!) ===
    if (pathname === '/api/alpha/runners' && req.method === 'GET') {
      const runners = await fetchTrendingSolanaRunners();
      return sendJson(res, 200, { runners });
    }

    if (pathname === '/api/alpha/state' && req.method === 'GET') {
      return sendJson(res, 200, { ...getAlphaHunterState(), credits: getCreditStats() });
    }

    if (pathname === '/api/alpha/hunt' && req.method === 'POST') {
      const body = await readBody(req);
      runAlphaHunt({
        mints: Array.isArray(body.mints) ? body.mints : [],
        maxCandidates: Number(body.maxCandidates) || 15,
        windowDays: Number(body.windowDays) || 7,
        onlyNewOutsideList: Boolean(body.onlyNewOutsideList)
      }).catch(() => {});
      return sendJson(res, 200, { ok: true, ...getAlphaHunterState() });
    }

    if (pathname === '/api/alpha/stop' && req.method === 'POST') {
      stopAlphaHunt();
      return sendJson(res, 200, { ok: true, ...getAlphaHunterState() });
    }

    if (pathname === '/api/export/alpha-padre' && req.method === 'GET') {
      const data = exportAlphaPadreJson();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="padre-alpha-discovered.json"'
      });
      return res.end(JSON.stringify(data, null, 2));
    }

    // === CONSENSUS PING ===
    if (pathname === '/api/pinger' && req.method === 'GET') {
      return sendJson(res, 200, { ...getPingerStatus(), credits: getCreditStats() });
    }

    if (pathname === '/api/pinger/start' && req.method === 'POST') {
      const body = await readBody(req);
      const status = startPinger(body);
      return sendJson(res, 200, status);
    }

    if (pathname === '/api/pinger/stop' && req.method === 'POST') {
      return sendJson(res, 200, stopPinger());
    }

    if (pathname === '/api/webhook/helius' && req.method === 'POST') {
      const body = await readBody(req);
      const out = await handleHeliusWebhook(body);
      return sendJson(res, 200, out);
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

const env = loadEnv();
const PORT = Number(env.PORT) || 3777;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  [SOLANA ALPHA SUITE v2] Running locally at http://127.0.0.1:${PORT}`);
  console.log(`  Wallet list: ${env.WALLET_LIST_PATH}`);
  console.log(`  Helius API Key: ${env.HELIUS_API_KEY ? maskKey(env.HELIUS_API_KEY) : 'NOT SET (open Settings in UI)'}\n`);
});
