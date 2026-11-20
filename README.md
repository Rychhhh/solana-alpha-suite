# Solana Alpha Suite v2

Zero-dependency local Solana on-chain wallet auditor, forensic side-wallet & cross-chain bridge tracer, winning-token alpha hunter, and live consensus ping dashboard — built to run on **Helius Free Tier (`1,000,000 credits/month`)**.

## Features

1. **2-Stage Batch Wallet Auditor & Pruner (900+ Wallets)**
   - **Stage 1 (Fast Triage):** Batch `getMultipleAccounts` SOL balances + recent activity triage (`~1 credit/wallet`) to separate `ACTIVE` traders from `EMPTY` and `DORMANT` noise.
   - **Stage 2 (Institutional 4-Gate Audit — Strict 7D / 30D):**
     - **Gate 1 — Data Trustworthy:** Rejects `Sold > Bought` pre-window distortion and flags partial hyperactive windows.
     - **Gate 2 — Still Earning Now:** Checks strict 7D/30D Realized PnL + Strict Net Cashflow (including open/unsold bags).
     - **Gate 3 — Human Fillable:** Measures median hold time & average buy size so manual traders avoid `<15s` uncopyable bots.
     - **Gate 4 — Cuts Losses:** Checks dead/unsold bag ratio and single-trade concentration (anti one-hit-wonder).
   - **Anti-Spoof Accelerator (`Helius v1/parsed-events/scan`):** Automatically detects read-only dust/spoof floods on high-profile KOL wallets and scans up to `10,000` txs server-side per call across Pump.fun, PumpSwap AMM, LaunchLab, Raydium, Meteora, and Jupiter.
   - **Verified On-Chain KOL Registry & Trader Archetypes:** Labels verified KOLs (`@handle`), `🎯 Sharp Sniper`, `💎 Conviction Swing`, `⚡ Hyper Scalper`, `📊 Intraday`, and `🤖 MEV / Auto Bot` with `Tx/Day (~Week)` cadence.
   - **1-Click Export** to Axiom / Padre native wallet tracker JSON.

2. **Wallet Investigator, Side-Wallet & Cross-Chain Bridge Tracer**
   - Interactive pan/zoom dark-mode SVG fund-flow hop graph (Depth 1–2).
   - **Shared CEX Deposit Address Hunter:** Detects personal exchange deposit wallets swept to CEX hot wallets and flags other wallets depositing to the same address (`95%+` confidence).
   - **Direct SPL Transfer Linker** (non-DEX token transfers) & **Cross-Chain Bridge Detector** (Wormhole, Mayan, deBridge, FixedFloat, ChangeNOW, SimpleSwap, Allbridge, Circle CCTP).
   - 1-click deep investigation toolbar: **Arkham Intel, Solscan, GMGN, Axiom, Cielo, Helius Orb, Wormholescan, deBridge, Mayan**.

3. **Alpha Hunter (Find New Smart Money Outside Your List)**
   - Auto-loads live trending Solana runners from DexScreener (`0` Helius credits) or accepts custom winning token CAs.
   - Extracts active buyers on-chain, ranks multi-runner overlaps (`>= 2` runners), and runs 4-Gate Strict 7D filtering.

4. **Live Consensus Ping Engine**
   - Monitors your elite watchlist and fires **Consensus Buy Alerts** when `>= N` tracked wallets buy the same token within a sliding window, enriched with DexScreener (MC, Liquidity, 5m Volume), Rugcheck, 1-click Padre links, optional Telegram push, and `POST /api/webhook/helius` receiver.

## Quick Start

Requires **Node.js 18+** (zero `npm install` dependencies).

```bash
git clone https://github.com/Rychhhh/solana-alpha-suite.git
cd solana-alpha-suite
cp .env.example .env
# Add your free HELIUS_API_KEY and WALLET_LIST_PATH in .env (or configure via UI Settings)
npm start
```

Open **`http://127.0.0.1:3777`** in your browser.
