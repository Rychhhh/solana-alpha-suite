const fs = require('fs');
const path = require('path');
const { loadEnv, DATA_DIR } = require('./env');

const CREDITS_FILE = path.join(DATA_DIR, 'credits.json');
const dexCache = new Map();
const rugCache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCredits() {
  try {
    if (fs.existsSync(CREDITS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
    }
  } catch {}
  return { month: new Date().toISOString().slice(0, 7), used: 0, rpcCalls: 0, enhancedCalls: 0 };
}

let creditState = loadCredits();

function addCredits(amount, kind = 'rpc') {
  const curMonth = new Date().toISOString().slice(0, 7);
  if (creditState.month !== curMonth) {
    creditState = { month: curMonth, used: 0, rpcCalls: 0, enhancedCalls: 0 };
  }
  creditState.used += amount;
  if (kind === 'enhanced') creditState.enhancedCalls += 1;
  else creditState.rpcCalls += 1;
  try {
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(creditState, null, 2));
  } catch {}
}

function getCreditStats() {
  return { ...creditState, limit: 1000000 };
}

class RateLimiter {
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
    this.lastTime = 0;
    this.chain = Promise.resolve();
  }
  schedule(fn) {
    const run = async () => {
      const now = Date.now();
      const wait = Math.max(0, this.lastTime + this.minIntervalMs - now);
      if (wait > 0) await sleep(wait);
      this.lastTime = Date.now();
      return fn();
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }
}

// Helius Free Tier: 10 RPS Standard RPC, 2 RPS Enhanced API
// We run slightly below cap to avoid 429s
const rpcLimiter = new RateLimiter(135);
const enhancedLimiter = new RateLimiter(550);

function getApiKey() {
  const env = loadEnv();
  if (!env.HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY belum diisi! Klik tombol Settings di kanan atas lalu paste API Key dari dashboard.helius.dev.');
  }
  return env.HELIUS_API_KEY.trim();
}

async function rpcCall(method, params = [], retries = 3) {
  const apiKey = getApiKey();
  const url = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await rpcLimiter.schedule(() =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        })
      );

      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw new Error(`Helius RPC HTTP ${res.status}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Helius API Key tidak valid / ditolak (HTTP ${res.status})`);
      }

      const json = await res.json();
      addCredits(1, 'rpc');
      if (json.error) {
        throw new Error(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`);
      }
      return json.result;
    } catch (err) {
      if (attempt < retries && !String(err.message).includes('tidak valid')) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

async function getMultipleBalances(addresses) {
  // Chunk by 100 addresses (1 RPC credit per 100 wallets!)
  const balances = new Map();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await rpcCall('getMultipleAccounts', [chunk, { encoding: 'base64' }]);
    const values = res?.value || [];
    for (let j = 0; j < chunk.length; j++) {
      const lamports = values[j]?.lamports || 0;
      balances.set(chunk[j], lamports / 1e9);
    }
  }
  return balances;
}

async function getSignaturesForAddress(address, limit = 25, before = undefined) {
  const opts = { limit };
  if (before) opts.before = before;
  return rpcCall('getSignaturesForAddress', [address, opts]);
}

async function getEnhancedTransactions(address, { limit = 50, before = undefined, type = undefined } = {}, retries = 3) {
  const apiKey = getApiKey();
  const qs = new URLSearchParams({ 'api-key': apiKey, limit: String(limit) });
  if (before) qs.set('before', before);
  if (type) qs.set('type', type);
  const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${qs.toString()}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await enhancedLimiter.schedule(() => fetch(url));
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(`Helius Enhanced API HTTP ${res.status}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Helius API Key ditolak di Enhanced API (HTTP ${res.status})`);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Helius Enhanced API HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      const data = await res.json();
      // Helius Enhanced transactions endpoint costs ~100 credits per call
      addCredits(100, 'enhanced');
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (attempt < retries && !String(err.message).includes('ditolak')) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function scanParsedEvents(address, { programs, paginationToken = undefined, maxScannedTransactions = 10000, limit = 100 } = {}, retries = 2) {
  const apiKey = getApiKey();
  const url = `https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=${encodeURIComponent(apiKey)}`;
  const body = {
    address,
    match: { programs },
    budget: { maxScannedTransactions },
    limit,
    sortOrder: 'desc'
  };
  if (paginationToken) body.paginationToken = paginationToken;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await enhancedLimiter.schedule(() =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      );
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new Error(`Helius Parsed Events HTTP ${res.status}`);
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Helius Parsed Events HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const json = await res.json();
      addCredits(json?.scan?.creditsCharged || 15, 'enhanced');
      return json;
    } catch (err) {
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  return { data: [], paginationToken: null, scan: {} };
}

async function testConnection() {
  const slot = await rpcCall('getSlot');
  return { ok: true, slot, credits: getCreditStats() };
}

async function getDexScreenerToken(mint) {
  const cached = dexCache.get(mint);
  if (cached && Date.now() - cached.ts < 60_000) return cached.data;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    if (!res.ok) return null;
    const pairs = await res.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    // Pick highest liquidity pair
    pairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    const p = pairs[0];
    const data = {
      mint,
      symbol: p.baseToken?.symbol || mint.slice(0, 6),
      name: p.baseToken?.name || '',
      priceUsd: Number(p.priceUsd || 0),
      marketCap: Number(p.marketCap || p.fdv || 0),
      liquidityUsd: Number(p.liquidity?.usd || 0),
      volume5m: Number(p.volume?.m5 || 0),
      volume1h: Number(p.volume?.h1 || 0),
      volume24h: Number(p.volume?.h24 || 0),
      priceChange5m: Number(p.priceChange?.m5 || 0),
      priceChange1h: Number(p.priceChange?.h1 || 0),
      dexId: p.dexId || '',
      pairCreatedAt: p.pairCreatedAt || null,
      imageUrl: p.info?.imageUrl || '',
      url: p.url || `https://dexscreener.com/solana/${mint}`
    };
    dexCache.set(mint, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

async function getRugCheckSummary(mint) {
  const cached = rugCache.get(mint);
  if (cached && Date.now() - cached.ts < 300_000) return cached.data;
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`);
    if (!res.ok) return null;
    const j = await res.json();
    const data = {
      score: j.score ?? null,
      scoreNormalised: j.score_normalised ?? null,
      risks: (j.risks || []).slice(0, 4).map((r) => ({ name: r.name, level: r.level }))
    };
    rugCache.set(mint, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

module.exports = {
  rpcCall,
  getMultipleBalances,
  getSignaturesForAddress,
  getEnhancedTransactions,
  scanParsedEvents,
  testConnection,
  getCreditStats,
  getDexScreenerToken,
  getRugCheckSummary,
  sleep
};
