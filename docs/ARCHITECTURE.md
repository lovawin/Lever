# Lever Architecture: Custodial Proxy Trading

## Problem
Most users are geo-blocked from Hyperliquid. Lever should be the access layer — users connect their wallet to Lever, and we handle the venue underneath.

## Architecture

```
User Wallet (MetaMask/Phantom)
    │
    ├─► Deposit USDC → Lever Smart Contract
    │                    │
    │                    ├─► Per-User sub-account on HL
    │                    │   (or single master account with internal balances)
    │                    │
    │                    └─► Backend tracks deposits, trades, P&L
    │
    ├─► Place Order → Lever Backend API
    │                    │
    │                    ├─► Validates balance
    │                    ├─► Deducts platform fee
    │                    ├─► Routes to HL via API wallet
    │                    └─► Returns fill status
    │
    └─► Withdraw → Lever Smart Contract
                     └─► Sends USDC back to user wallet
```

## Two Approaches

### Option A: Per-User HL Sub-accounts
- Each user gets a HL sub-account under our master wallet
- User deposits USDC → we credit their sub-account on HL
- Orders placed on their sub-account, positions are isolated
- Pros: Real isolation, HL margin engine handles liquidations
- Cons: HL sub-account API support, need to manage sub-account creation

### Option B: Internal Ledger + Master Account
- Single master HL account with our wallet
- Internal ledger tracks each user's balance, positions, P&L
- Backend places orders on master account, tracks which user owns what
- Pros: Simpler, one HL account to manage
- Cons: Need our own liquidation engine, risk of one user affecting others

### Option C: Smart Contract Vault (Best for Trust)
- Deploy a smart contract on Ethereum/L2 that holds user funds
- Contract whitelists our backend as the "trader" — can only place HL orders, not withdraw arbitrarily
- User deposits to contract, backend trades on their behalf
- User can withdraw anytime from contract (trustless exit)
- Pros: Non-custodial in spirit, user always can exit
- Cons: More complex, gas costs for deposits/withdrawals on L1

## Decision: Option B (Internal Ledger) for MVP

Simplest to ship. One HL account, internal balances. We can upgrade to Option A or C later.

### MVP Flow:
1. **Signup/Login**: User connects wallet, we create an internal account
2. **Deposit**: User sends USDC to our deposit address (or we generate per-user addresses)
3. **Trading**: User places orders on Lever → our backend executes on HL → platform fee deducted → position tracked internally
4. **Withdrawal**: User requests withdrawal → backend sends USDC from our wallet to user's wallet
5. **Positions**: Backend fetches HL positions and maps to internal users

### Backend Endpoints Needed:
```
POST /api/auth/wallet-login    — Sign message auth
POST /api/deposit/address      — Get deposit address
GET  /api/balance              — Get internal balance
POST /api/order                — Place order (long/short)
POST /api/order/cancel         — Cancel order
GET  /api/positions            — Get open positions
POST /api/withdraw             — Request withdrawal
GET  /api/fees                 — Get fee tier info
```

### Risk Management:
- Position size limits per user
- Max leverage limits
- Monitor HL account margin health
- Daily withdrawal limits initially