// Known Solana Exchanges, Bridges, Instant Swaps, Jito Tip Accounts, DEX Programs & Routers
// Used to label CEX/Bridge hops accurately and prevent noise in Side-Wallet Tracer graphs

const KNOWN_ENTITIES = {
  // === CEX HOT WALLETS ===
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': { label: 'Binance 2', type: 'CEX' },
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': { label: 'Binance 1', type: 'CEX' },
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': { label: 'Binance 3', type: 'CEX' },
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': { label: 'Bybit Hot', type: 'CEX' },
  'iGdFcQoyR2MwbXwohQcnSv6BrEJTrwdhqzNUosh5TbT': { label: 'Bybit 2', type: 'CEX' },
  '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': { label: 'OKX Hot', type: 'CEX' },
  'is6MTRvbebhpvGNgxVjsE2Vz5GFEe9UT1wF4L2dF5xY': { label: 'OKX 2', type: 'CEX' },
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': { label: 'Coinbase 1', type: 'CEX' },
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': { label: 'Coinbase 2', type: 'CEX' },
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': { label: 'Coinbase 3', type: 'CEX' },
  'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6': { label: 'KuCoin Hot', type: 'CEX' },
  'HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt': { label: 'KuCoin 2', type: 'CEX' },
  'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w': { label: 'Gate.io Hot', type: 'CEX' },
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ': { label: 'MEXC Hot', type: 'CEX' },
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5': { label: 'Kraken Hot', type: 'CEX' },
  'A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR': { label: 'Bitget Hot', type: 'CEX' },
  'FpwQQhQQobihGkoR2fM5uM7fC6u1K3qR1cV7L3a5S1vS': { label: 'HTX Hot', type: 'CEX' },

  // === CROSS-CHAIN BRIDGES & INSTANT NON-KYC SWAPS (Side-Wallet Funding Hiding Spots!) ===
  'G2YxRa6wt1qePMwfJzdXZG62ej4qaTC7YURzuh2Lwd3t': { label: 'FixedFloat Bridge/Swap', type: 'BRIDGE', explorer: 'https://ff.io' },
  '5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5': { label: 'ChangeNOW Bridge/Swap', type: 'BRIDGE', explorer: 'https://changenow.io' },
  'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb': { label: 'Wormhole Token Bridge', type: 'BRIDGE', explorer: 'https://wormholescan.io' },
  'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth': { label: 'Wormhole Core Bridge', type: 'BRIDGE', explorer: 'https://wormholescan.io' },
  'FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfJn6n2B': { label: 'Mayan Swift Bridge', type: 'BRIDGE', explorer: 'https://explorer.mayan.finance' },
  '8LPjGDbxhW4G2Q8S6FvdvUdfGWssgtqbla Xue': { label: 'Mayan Finance', type: 'BRIDGE', explorer: 'https://explorer.mayan.finance' },
  'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4': { label: 'deBridge DLN Source', type: 'BRIDGE', explorer: 'https://app.debridge.finance/orders' },
  'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo': { label: 'deBridge DLN Dest', type: 'BRIDGE', explorer: 'https://app.debridge.finance/orders' },
  'DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh': { label: 'deBridge Program', type: 'BRIDGE', explorer: 'https://app.debridge.finance/orders' },
  'BrdgN2jGUBt53cw6233333333333333333333333333': { label: 'Allbridge Core', type: 'BRIDGE', explorer: 'https://core.allbridge.io' },
  'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3': { label: 'Circle CCTP Bridge', type: 'BRIDGE', explorer: 'https://usdc.range.org' },
  'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd': { label: 'Circle CCTP Transmitter', type: 'BRIDGE', explorer: 'https://usdc.range.org' },
  'H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm': { label: 'SimpleSwap / Instant', type: 'BRIDGE', explorer: 'https://simpleswap.io' },

  // === JITO TIP & MEV ===
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5': { label: 'Jito Tip 1', type: 'MEV' },
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe': { label: 'Jito Tip 2', type: 'MEV' },
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY': { label: 'Jito Tip 3', type: 'MEV' },
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49': { label: 'Jito Tip 4', type: 'MEV' },
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh': { label: 'Jito Tip 5', type: 'MEV' },
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt': { label: 'Jito Tip 6', type: 'MEV' },
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL': { label: 'Jito Tip 7', type: 'MEV' },
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT': { label: 'Jito Tip 8', type: 'MEV' },
  'nextBLoCkPMgmG8ZgJtABeScP35qLa2PEXKnt3z1g3Z': { label: 'NextBlock Tip', type: 'MEV' },

  // === TRADING BOTS / FEE RECIPIENTS ===
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM': { label: 'Pump.fun Fee', type: 'PROTOCOL' },
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': { label: 'Pump.fun Program', type: 'PROTOCOL' },
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': { label: 'PumpSwap AMM', type: 'PROTOCOL' },
  'Axiom3a2w1UbMt2SMgqSvRiuJFTPusDhwKamNgPTeNQ9': { label: 'Axiom Bot', type: 'PROTOCOL' },
  'AVUCZyuT35YSuj4RH7fwiyPu82Djn2Hfg7y2ND2X3ZHh': { label: 'Photon Fee', type: 'PROTOCOL' },
  '9yMwSPk9mrXSN7yDHUuZurAh1sjbJsfpUqjZ7SvVtdco': { label: 'Trojan Fee', type: 'PROTOCOL' },
  'BB5dnY55FXS1e1NXqZDwCzgdYJdMCj3B92PU6Q5Fb6DT': { label: 'GMGN Fee', type: 'PROTOCOL' },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { label: 'Jupiter v6', type: 'PROTOCOL' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { label: 'Raydium AMM', type: 'PROTOCOL' },
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': { label: 'Raydium CLMM', type: 'PROTOCOL' },
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': { label: 'Raydium LaunchLab', type: 'PROTOCOL' },
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': { label: 'Meteora DLMM', type: 'PROTOCOL' },
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN': { label: 'Meteora DBC', type: 'PROTOCOL' },
  '11111111111111111111111111111111': { label: 'System Program', type: 'PROTOCOL' },
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': { label: 'SPL Token', type: 'PROTOCOL' },
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': { label: 'Token-2022', type: 'PROTOCOL' }
};

const BASE_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // WSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
]);

function getKnownEntity(address) {
  return KNOWN_ENTITIES[address] || null;
}

function isIgnoredForSideWallet(address) {
  const ent = KNOWN_ENTITIES[address];
  if (!ent) return false;
  return ent.type === 'CEX' || ent.type === 'BRIDGE' || ent.type === 'MEV' || ent.type === 'PROTOCOL';
}

function isCexAddress(address) {
  const ent = KNOWN_ENTITIES[address];
  return Boolean(ent && ent.type === 'CEX');
}

function isBridgeAddress(address) {
  const ent = KNOWN_ENTITIES[address];
  return Boolean(ent && ent.type === 'BRIDGE');
}

function getInvestigationLinks(address) {
  return {
    arkham: `https://intel.arkm.com/explorer/address/${address}`,
    solscan: `https://solscan.io/account/${address}`,
    solscanTransfers: `https://solscan.io/account/${address}#transfers`,
    gmgn: `https://gmgn.ai/sol/address/${address}`,
    axiom: `https://axiom.trade/wallet/${address}`,
    cielo: `https://app.cielo.finance/profile/${address}`,
    orb: `https://orb.helius.dev/address/${address}`,
    wormholescan: `https://wormholescan.io/#/txs?address=${address}`,
    debridge: `https://app.debridge.finance/orders?s=${address}`,
    mayan: `https://explorer.mayan.finance/?q=${address}`
  };
}

module.exports = {
  KNOWN_ENTITIES,
  BASE_MINTS,
  getKnownEntity,
  isIgnoredForSideWallet,
  isCexAddress,
  isBridgeAddress,
  getInvestigationLinks
};
