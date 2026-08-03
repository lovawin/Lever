# Lever

Long/short memecoins. Hyperliquid-powered, multi-chain wallet support.

## Stack
- **Frontend:** Next.js 14, Tailwind, viem (EVM), @solana/web3.js, @hyperliquid/sdk
- **Backend:** Python 3.13, FastAPI
- **Chains:** Hyperliquid L1 (settlement), Solana (wallet + tokens), Robinhood Chain (EVM)
- **Funding:** 10k NFT collection, trading-tier-gated

## Phase 1
- Hyperliquid perps integration (long/short memecoins)
- Wallet connect: Phantom + MetaMask
- Signals API (volume, buy/sell ratio, liquidity health)
- Single trade UI

## Repo layout
- `frontend/` — Next.js app (deploys to Vercel)
- `backend/` — FastAPI signals service (deploys to Render)
- `brand/` — name, colors, NFT metadata schema
- `contracts/` — NFT contracts (ERC-1155)
- `docs/` — design notes
