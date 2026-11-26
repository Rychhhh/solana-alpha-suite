const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const DATA_DIR = path.join(ROOT_DIR, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadEnv() {
  const env = {
    HELIUS_API_KEY: '',
    WALLET_LIST_PATH: './wallets.json',
    PORT: '3777',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    MY_WALLET: ''
  };

  if (fs.existsSync(ENV_PATH)) {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (k) env[k] = v;
    }
  }

  for (const k of Object.keys(env)) {
    if (process.env[k] !== undefined && process.env[k] !== '') {
      env[k] = process.env[k];
    }
  }
  return env;
}

function saveEnv(updates) {
  const current = loadEnv();
  const next = { ...current, ...updates };
  const lines = [
    '# Solana Alpha Suite Local Environment (DO NOT SHARE / COMMIT)',
    `HELIUS_API_KEY=${next.HELIUS_API_KEY || ''}`,
    `WALLET_LIST_PATH=${next.WALLET_LIST_PATH || './wallets.json'}`,
    `PORT=${next.PORT || '3777'}`,
    `TELEGRAM_BOT_TOKEN=${next.TELEGRAM_BOT_TOKEN || ''}`,
    `TELEGRAM_CHAT_ID=${next.TELEGRAM_CHAT_ID || ''}`,
    `MY_WALLET=${next.MY_WALLET || ''}`,
    ''
  ];
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
  return next;
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return `${k.slice(0, 6)}...${k.slice(-4)}`;
}

module.exports = {
  ROOT_DIR,
  ENV_PATH,
  DATA_DIR,
  loadEnv,
  saveEnv,
  maskKey
};
