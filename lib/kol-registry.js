// Verified On-Chain Solana KOL & Entity Registry
// Matches ONLY by exact on-chain Solana address (never blindly trusts user nicknames!)

const VERIFIED_KOLS = {
  // === TIER-1 VERIFIED PUBLIC SOLANA KOLS ===
  '8deJ9xeUvXSJwicYptA9mHsU2rN2pDx37KWzkDkEXhU6': { name: 'Cooker', handle: '@CookerFlips', verified: true, group: 'KOL' },
  '2Bonf26MDnpJPwJkocnQLfHWjdeStLD5iCtV3yC7Q6z4': { name: 'Cooker Alt', handle: '@CookerFlips', verified: true, group: 'KOL_ALT' },
  'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o': { name: 'Cented', handle: '@Cented7', verified: true, group: 'KOL' },
  '8YcbyX92UHTU23HZv3ccP9o13qibErQkKaUjoxqxd7SJ': { name: 'Cented Dev', handle: '@Cented7', verified: true, group: 'KOL_ALT' },
  '6nU2L7MQVUWjtdKHVpuZA9aind73nd3rXC4YFo8KQCy4': { name: 'Cented Circle', handle: '@Cented7', verified: true, group: 'KOL_ALT' },
  'DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj': { name: 'Euris', handle: '@Euris_JT', verified: true, group: 'KOL' },
  'G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC': { name: 'Clukz', handle: '@clukzSOL', verified: true, group: 'KOL' },
  'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm': { name: 'Gake', handle: '@Ga__ke', verified: true, group: 'KOL' },
  'CNudZYFgpbT26fidsiNrWfHeGTBMMeVWqruZXsEkcUPc': { name: 'Gake Alt', handle: '@Ga__ke', verified: true, group: 'KOL_ALT' },
  'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK': { name: 'Cupsey', handle: '@Cupseyy', verified: true, group: 'KOL' },
  '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f': { name: 'Cupsey Main', handle: '@Cupseyy', verified: true, group: 'KOL' },
  '8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd': { name: 'Pow', handle: '@traderpow', verified: true, group: 'KOL' },
  'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm': { name: 'Ansem', handle: '@blknoiz06', verified: true, group: 'KOL' },
  '7QZGS7MQ4S6hRmE8iXoFTXgQ2hXVUCho2ZhgeWvLNPZT': { name: 'Murad', handle: '@MustStopMurad', verified: true, group: 'KOL' },
  '8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR': { name: 'Casino', handle: '@casino616', verified: true, group: 'KOL' },
  '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk': { name: 'Jijo', handle: '@jijo_exe', verified: true, group: 'KOL' },
  '8MaVa9kdt3NW4Q5HyNAm1X5LbR8PQRVDc1W8NMVK88D5': { name: 'Daumen', handle: '@daumeneth', verified: true, group: 'KOL' },
  'JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN': { name: 'West', handle: '@ratwizardx', verified: true, group: 'KOL' },
  '5rkPDK4JnVAumgzeV2Zu8vjggMTtHdDtrsd5o9dhGZHD': { name: 'Dave Portnoy', handle: '@stoolpresidente', verified: true, group: 'KOL' },
  'mpa4abUkjQoAvPzREkh5Mo75hZhPFQ2FSH6w7dWKuQ5': { name: 'Toly', handle: '@aeyakovenko', verified: true, group: 'FOUNDER' },
  '5CP6zv8a17mz91v6rMruVH6ziC5qAL8GFaJzwrX9Fvup': { name: 'Naseem', handle: '@naseem', verified: true, group: 'KOL' },
  'G5nxEXuFMfV74DSnsrSatqCW32F34XUnBeq3PfDS7w5E': { name: 'Profit', handle: '@profitier', verified: true, group: 'KOL' },
  '7iabBMwmSvS4CFPcjW2XYZY53bUCHzXjCFEFhxeYP4CY': { name: 'Leens', handle: '@leensx100', verified: true, group: 'KOL' },
  'LeenseyyUU3ccdBPCFCrrZ8oKU2B3T2uToGGZ7eVABY': { name: 'Leens Swing', handle: '@leensx100', verified: true, group: 'KOL_ALT' },
  '3JoVBiQEA2QKsq7TzW5ez5jVRtbbYgTNijoZzp5qgkr2': { name: 'Frank', handle: '@frankdegods', verified: true, group: 'KOL' },
  'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC': { name: 'Kadenox', handle: '@kadenox', verified: true, group: 'KOL' },
  'HaZtFxgw99iM97LxmwFuDW6k4MP1XwsWTGoy7GUoSELj': { name: 'Cobie', handle: '@cobie', verified: true, group: 'KOL' },
  '3vkpy5YHqnqJTnA5doWTpcgKyZiYsaXYzYM9wm8s3WTi': { name: 'Alon', handle: '@a1lon9', verified: true, group: 'FOUNDER' },
  'ApRnQN2HkbCn7W2WWiT2FEKvuKJp9LugRyAE1a9Hdz1': { name: 'SolCrow', handle: '@solcrow', verified: true, group: 'KOL' },
  'GgbCFRHHAPv5i1fqt1D1buf8FPNA31oKrkZvXDyZymsT': { name: 'Shizuku', handle: '@ShizukuSOL', verified: true, group: 'KOL' },
  '8NJ7Ujpji8uMF2675mqaTSEm2DCbfJA7fiRKtiaqkaLN': { name: 'Chester', handle: '@chesterSOL', verified: true, group: 'KOL' },
  'FVxeFYgyT4GC6D7gaLkMSu2qtSJfw2N4RVPZowi2A64Y': { name: 'GrandFnf', handle: '@GrandFnf', verified: true, group: 'KOL' },
  '39qpCe9zdyC2g53UJeyGh5jwGBKjFwidCbnD5W53aVBW': { name: 'Orangie', handle: '@orangie', verified: true, group: 'KOL' },
  'HdxkiXqeN6qpK2YbG51W23QSWj3Yygc1eEk2zwmKJExp': { name: 'Itai', handle: '@itai', verified: true, group: 'KOL' },
  '4LohkHqDKib6ooEwPzgX5m6G9UXyFmgeNe2NBdy2UF56': { name: 'TheTradoor', handle: '@f_TheTradoor', verified: true, group: 'KOL' },
  '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9': { name: 'Decu', handle: '@decu0x', verified: true, group: 'KOL' },
  '6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP': { name: 'Cupsey Whale', handle: '@Cupseyy', verified: true, group: 'KOL' },
  '4UwK5AE6Djdf3MfwtPGE8pFYD47MhU9fiStDVmSHJVMB': { name: 'CottagePvP', handle: '@CottagePvP', verified: true, group: 'KOL' },
  'BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd': { name: 'Dvces', handle: '@dvces', verified: true, group: 'KOL' },
  '6S8GezkxYUfZy9JPtYnanbcZTMB87Wjt1qx3c6ELajKC': { name: 'Nyhrox', handle: '@nyhrox', verified: true, group: 'KOL' },
  'H31vEBxSJk1nQdUN11qZgZyhScyShhscKhvhZZU3dQoU': { name: 'Faze Megga', handle: '@Megga', verified: true, group: 'KOL' },
  'GijFWw4oNyh9ko3FaZforNsi3jk6wDovARpkKahPD4o5': { name: 'Lunar Main', handle: '@lunar', verified: true, group: 'KOL' },
  '6aXFYXbFob1ZKAEDCcqZnX2vooA3TgEqDoy5dAQbeWoV': { name: 'Flames', handle: '@FlamesSOL', verified: true, group: 'KOL' },
  '387FRwow6MKDhSwuMULhKjqeXuxoBY4BbbaSntdk9LaH': { name: 'Shawty', handle: '@shawty', verified: true, group: 'KOL' },
  '3h65MmPZksoKKyEpEjnWU2Yk2iYT5oZDNitGy5cTaxoE': { name: 'Jidn', handle: '@jidn', verified: true, group: 'KOL' },
  '831yhv67QpKqLBJjbmw2xoDUeeFHGUx8RnuRj9imeoEs': { name: 'Trey', handle: '@trey', verified: true, group: 'KOL' },
  'VJSDW6S74YXR4rRR9P4xwhMvLZJQMhrUb8XMFirUsy1': { name: 'Beanz', handle: '@beanz', verified: true, group: 'KOL' },
  'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT': { name: 'Trunoest', handle: '@trunoest', verified: true, group: 'KOL' }
};

function getVerifiedKol(address) {
  return VERIFIED_KOLS[address] || null;
}

module.exports = {
  VERIFIED_KOLS,
  getVerifiedKol
};
