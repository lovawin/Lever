# Leveraged Long Research: Solana Lending APIs + Jupiter Swap

> Research date: 2026-08-03  
> Goal: Build a "one-click leveraged long" flow where a user connects a Solana wallet, picks a meme token, chooses leverage (2x-10x), and signs ONE transaction that deposits USDC collateral → borrows more USDC → swaps via Jupiter for the target token.

---

## Table of Contents

1. [Executive Summary & Recommendation](#executive-summary--recommendation)
2. [Kamino Finance](#1-kamino-finance)
3. [MarginFi (now P0 Protocol)]#2-marginfi-now-p0-protocol)
4. [Jupiter Aggregator Swap API](#3-jupiter-aggregator-swap-api)
5. [Jupiter Lend (Bonus)](#4-jupiter-lend-bonus)
6. [Transaction Flow Design](#5-transaction-flow-design)
7. [Existing Leveraged Long Protocols](#6-existing-leveraged-long-protocols)
8. [Key Risks & Considerations](#7-key-risks--considerations)

---

## Executive Summary & Recommendation

### Best Approach: Kamino Multiply via Dialect/Blinks API

**Kamino's Dialect Blinks API** (`https://kamino.dial.to/api`) already provides exactly what we need — a single REST endpoint that generates a fully assembled leveraged position transaction given wallet, market, collateral/debt mints, leverage amount, and slippage. The user just signs and sends.

- **Endpoint**: `POST /v0/leverage/{marketAddress}/openPosition`
- **Parameters**: `collTokenMint`, `debtTokenMint`, `leverage` (1.1-10x), `amount`, `slippage` (0.1-10%), `account` (wallet pubkey)
- **Returns**: Base64-encoded signed transaction ready for wallet signing
- **Flow**: Flash loan → swap (KSwap) → deposit collateral → borrow debt → repay flash loan — all atomic

**For maximum flexibility** (arbitrary meme tokens), we should also support the **Kamino TypeScript SDK** approach which uses KSwap routing and lets us build custom multiply transactions with any supported collateral/debt pair.

**For lending + Jupiter swap compositability**, the **MarginFi/P0 loop() method** or **Jupiter Lend flashloan + Jupiter Swap** approach gives us the most flexibility since we can use Jupiter's swap routing for any token pair.

### Limitation: Meme Token Collateral

⚠️ **Critical constraint**: Neither Kamino nor MarginFi/P0 will accept random meme tokens as collateral. They only support whitelisted reserve/bank assets (SOL, USDC, major LSTs, etc.). This means our leveraged long flow must:

1. **Deposit USDC as collateral** (not the meme token)
2. **Borrow more USDC against that collateral** 
3. **Swap borrowed USDC → meme token via Jupiter**

The meme token itself is NOT held in the lending protocol — it sits in the user's wallet. The lending position is USDC collateral + USDC debt.

---

## 1. Kamino Finance

### Overview
Kamino is a Solana DeFi protocol offering lending markets (Klend), leveraged positions (Multiply/Leverage), concentrated liquidity vaults, and token swaps (KSwap).

### Program Addresses
- **Klend Program**: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- **Main Market**: `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` (main market)
- **xStocks Market**: `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`

### SDK
- **NPM Package**: `@kamino-finance/klend-sdk` (v9.1.5, 23K weekly downloads)
- **GitHub**: https://github.com/kamino-Finance/klend-sdk
- **Languages**: TypeScript/JavaScript
- **Also**: `@kamino-finance/kswap-sdk` (swap routing), `@kamino-finance/scope-sdk` (oracle prices)

### REST API (Buildkit)
Base URL: `https://api.kamino.finance`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ktx/klend/deposit` | POST | Deposit collateral into a reserve |
| `/ktx/klend/borrow` | POST | Borrow from a reserve |
| `/ktx/klend/repay` | POST | Repay borrowed asset |
| `/ktx/klend/withdraw` | POST | Withdraw deposited collateral |
| `/v2/kamino-market` | GET | List all markets with reserves |
| `/kamino-market/{marketPubkey}/users/{userPubkey}/obligations` | GET | User position data |
| `/oracles/prices` | GET | Oracle prices |

**Standard operations** (deposit, borrow, repay, withdraw) are available via both API and SDK.

### Multiply/Leverage (THE KEY FEATURE)

**Multiply** creates leveraged positions in a single atomic transaction using flash loans.

#### How it works:
1. Flash borrow the debt token (e.g., USDC)
2. Swap borrowed amount into collateral token (via KSwap)
3. Deposit collateral (user deposit + swapped amount) into Klend
4. Borrow debt token against collateral
5. Repay flash loan with borrowed amount
6. Result: leveraged position with amplified collateral and outstanding debt

#### SDK Approach (Multiply Deposit with KSwap):
```typescript
import { KaminoMarket, MultiplyObligation, PROGRAM_ID, 
         getDepositWithLeverageIxs, getUserLutAddressAndSetupIxs } from '@kamino-finance/klend-sdk';
import { KswapSdk } from '@kamino-finance/kswap-sdk';
import { Scope } from '@kamino-finance/scope-sdk';

// Load market
const market = await KaminoMarket.load(rpc, marketPubkey, 100);

// Configure leverage
const depositAmount = new Decimal(10);  // $10 USDC
const leverage = 2;  // 2x leverage
const slippageBps = 100;  // 1% slippage

// Get leverage instructions
const leverageIxs = await getDepositWithLeverageIxs(
  market, signer, collTokenMint, debtTokenMint,
  depositAmount, leverage, slippageBps, kswapQuoter, kswapSwapper
);
```

#### Dialect Blinks API (EASIEST APPROACH):
Base URL: `https://kamino.dial.to/api`

**Leverage Open Position:**
```
POST /v0/leverage/{marketAddress}/openPosition
```

Parameters:
- `marketAddress` (path): Market public key (default: `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`)
- `collTokenMint` (query): Collateral token mint (e.g., `So11111111111111111111111111111111111111112` for SOL)
- `debtTokenMint` (query): Debt token mint (e.g., `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` for USDC)
- `leverage` (query): Leverage multiplier (1.1-10x)
- `amount` (query): Deposit amount in human-readable format
- `slippage` (query): Slippage tolerance in % (0.1-10%)
- Body: `{ "type": "transaction", "account": "<wallet_pubkey>" }`

Returns: `{ "type": "transaction", "transaction": "<base64_tx>", "links": { "next": { ... } } }`

**Multiply Deposit:**
```
POST /v0/multiply/{marketAddress}/deposit
```
Same parameters as leverage. Returns array of sequential transactions.

#### ⚠️ Critical: Multiply/Flash Loan NOT Available via REST API

The main `api.kamino.finance` API only supports standard borrow/lend operations. **Multiply and flash loan operations require the TypeScript SDK or the Dialect Blinks API.** This is because these operations involve complex instruction composition (flash loan + swap + deposit + borrow + repay) that must be built client-side.

| Operation | REST API | Dialect API | TypeScript SDK |
|-----------|----------|-------------|----------------|
| Deposit/Borrow/Repay | ✅ | ✅ | ✅ |
| Multiply/Flash Loan | ❌ | ✅ | ✅ |
| Leverage Open Position | ❌ | ✅ | ✅ |
| Position Data | ✅ | ✅ | ✅ |

### eMode (Elevation Mode)
Kamino supports eMode for correlated asset pairs, allowing higher LTV ratios:
- Standard: 75% LTV → 4x max leverage (e.g., SOL/USDC)
- eMode Main: ~87% LTV → ~7.7x (LST/SOL pairs)
- eMode Jito: 90% LTV → 10x (JitoSOL/SOL)

---

## 2. MarginFi (now P0 Protocol)

### Overview
MarginFi has been **rebranded to P0 Protocol** (Project 0). The v2 program remains at `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`.

### Program Address
- **marginfi-v2**: `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`

### SDK (DEPRECATED → Migrate to p0-ts-sdk)
- **Old SDK**: `@mrgnlabs/marginfi-client-v2` — **⚠️ DEPRECATED** as of June 2026
- **New SDK**: `@0dotxyz/p0-ts-sdk` (v2.2.6) — the replacement
- **GitHub**: https://github.com/0dotxyz/p0-ts-sdk
- **Old GitHub**: https://github.com/mrgnlabs/mrgn-ts

### P0 TypeScript SDK Usage

```typescript
import { Project0Client, MarginfiAccount, MarginfiAccountWrapper, getConfig } from "@0dotxyz/p0-ts-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const config = getConfig("production");
const client = await Project0Client.initialize(connection, config);

// Create or fetch account
const account = await MarginfiAccount.fetch(accountAddress, client.program);
const wrappedAccount = new MarginfiAccountWrapper(account, client);

// Deposit USDC
const depositTx = await wrappedAccount.makeDepositTx(usdcBank.address, "100");

// Borrow USDC
const borrowTx = await wrappedAccount.makeBorrowTx(usdcBank.address, "50");

// Check max borrow
const maxBorrow = wrappedAccount.computeMaxBorrowForBank(usdcBank.address);

// Check health
const health = wrappedAccount.computeHealthComponents(MarginRequirementType.Initial);
```

### Loop Method (Leveraged Long)

The old `@mrgnlabs/marginfi-client-v2` SDK had a built-in `loop()` method:

```typescript
// OLD SDK - marginfi-client-v2
await client.loop({
  depositAmount,      // Amount to deposit
  borrowAmount,       // Amount to borrow
  depositBankAddress, // Bank where asset is deposited
  borrowBankAddress,  // Bank from which asset is borrowed
  swapIxs,            // Swap instructions (from Jupiter)
  swapLookupTables,   // ALTs for swap
  priorityFeeUi,      // Priority fee
});
```

The `loop()` method:
1. Deposits collateral into marginfi bank
2. Borrows debt asset against it
3. Uses provided swap instructions to swap borrowed asset → collateral asset
4. All in one transaction using flash loans

**The p0-ts-sdk does NOT yet have a built-in `loop()` method.** You need to build the flash loan + swap + deposit + borrow sequence manually using the underlying primitives:
- `lending_account_start_flashloan` instruction
- Deposit/borrow instructions
- Swap instructions (from Jupiter)
- `lending_account_end_flashloan` instruction

### Flash Loan Architecture (MarginFi/P0)

```
marginfi-v2 program instructions:
- lending_account_deposit: Deposit collateral
- lending_account_borrow: Borrow debt asset
- lending_account_repay: Repay debt
- lending_account_start_flashloan: Start flash loan (sets IN_FLASHLOAN_FLAG)
- lending_account_end_flashloan: End flash loan (verifies health after)
```

The flash loan flow:
1. `start_flashloan` — temporarily disables health checks
2. Deposit collateral
3. Borrow debt
4. Swap instructions (Jupiter)
5. Deposit swapped amount
6. `end_flashloan` — verifies account health is good

### mrgnloop (UI Product)
MarginFi's consumer product "mrgnloop" (https://app.marginfi.com/looper) provides this leverage flow as a UI. It uses flash loans to create leveraged positions in a single transaction. The underlying SDK method `loop()` was available in the old SDK but needs manual composition in p0-ts-sdk.

### Supported Banks (Collateral/Debt Assets)
MarginFi/P0 supports specific assets as banks. Each bank has:
- `assetWeightInit` — collateral factor (e.g., 0.75 = 75% LTV)
- `liabilityWeightInit` — borrow weight
- Interest rate model parameters

Common banks: SOL, USDC, ETH, wBTC, JitoSOL, mSOL, bSOL, JUP, etc.

⚠️ **Meme tokens are NOT supported as collateral or borrowable assets.**

---

## 3. Jupiter Aggregator Swap API

### Overview
Jupiter is Solana's #1 DEX aggregator, routing trades across 20+ DEXes. The Swap API (v2) provides two paths:
- **Meta-Aggregator** (`/order` + `/execute`): All routers compete, best price, managed transaction landing
- **Router** (`/build`): Metis onchain routing only, raw swap instructions, full transaction control

### Base URL
`https://api.jup.ag/swap/v2`

**API key required** via `x-api-key` header. Get one at https://developers.jup.ag/portal

### Meta-Aggregator (Simplest Flow)

#### Step 1: Get Order
```typescript
const orderResponse = await fetch(
  `https://api.jup.ag/swap/v2/order?` + new URLSearchParams({
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    outputMint: "<MEME_TOKEN_MINT>",
    amount: "100000000", // 100 USDC (6 decimals)
    taker: walletPublicKey,
  }),
  { headers: { "x-api-key": API_KEY } }
);
const order = await orderResponse.json();
```

#### Step 2: Sign Transaction
```typescript
// @solana/web3.js approach
const transaction = VersionedTransaction.deserialize(
  Buffer.from(order.transaction, "base64")
);
transaction.sign([signer]);
```

#### Step 3: Execute
```typescript
const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");
const executeResponse = await fetch("https://api.jup.ag/swap/v2/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
  body: JSON.stringify({
    signedTransaction,
    requestId: order.requestId,
  }),
});
```

**Response types:**
```typescript
type OrderResponse = {
  transaction: string | null;  // base64-encoded transaction
  requestId: string;
  outAmount: string;
  router: string;    // "metis" | "jupiterz" | "dflow" | "okx"
  mode: string;     // "ultra" | "manual"
  feeBps: number;
  feeMint: string;
};

type ExecuteResponse = {
  status: "Success" | "Failed";
  signature: string;
  totalInputAmount: string;
  totalOutputAmount: string;
};
```

### Router (For Composable Transactions)

Use `/build` when you need to combine swap instructions with other instructions (like lending operations) in a single transaction.

```typescript
const buildResponse = await fetch(
  `https://api.jup.ag/swap/v2/build?` + new URLSearchParams({
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: "<MEME_TOKEN_MINT>",
    amount: "100000000",
    taker: walletPublicKey,
  }),
  { headers: { "x-api-key": API_KEY } }
);
```

Returns raw instructions:
- `computeBudgetInstructions`
- `setupInstructions`
- `swapInstruction`
- `cleanupInstruction`
- `addressesByLookupTableAddress`

**This is what we need for composable transactions** — we can combine these swap instructions with lending instructions in a single Solana transaction.

### Jupiter Lite API (For Composability)
For maximum control in composable transactions, use the Lite API:
- Base URL: `https://lite-api.jup.ag/swap/v1`
- `GET /quote` — Get a swap quote
- `POST /swap-instructions` — Get individual swap instructions (not a full transaction)

This is used in Jupiter Lend's multiply flow (see section 4).

### Pricing & Fees
- Meta-Aggregator: Platform fee (Jupiter fee)
- Router: No platform fee (can add your own `platformFeeBps`)
- Integrator fees available via `referralAccount` + `referralFee` params

---

## 4. Jupiter Lend (Bonus)

### Overview
Jupiter has its own lending protocol (Jupiter Lend) with a Multiply/looping feature. This is relevant because it's the most integrated solution — Jupiter Lend + Jupiter Swap in one ecosystem.

### SDK
- **NPM**: `@jup-ag/lend` (for borrow/lend/flashloan operations)
- **NPM**: `@jup-ag/lend-read` (for reading vault/state data)

### Multiply Flow (Jupiter Lend)

```typescript
import { getFlashBorrowIx, getFlashPaybackIx } from "@jup-ag/lend/flashloan";
import { getOperateIx } from "@jup-ag/lend/borrow";

// 1. Get flash loan instructions
const flashBorrowIx = await getFlashBorrowIx({ 
  connection, signer, asset: usdcMint, amount: borrowAmount 
});
const flashPaybackIx = await getFlashPaybackIx({ 
  connection, signer, asset: usdcMint, amount: borrowAmount 
});

// 2. Get swap instructions from Jupiter Lite API
const quoteResponse = await fetch(
  `${LITE_API}/quote?inputMint=${usdcMint}&outputMint=${solMint}&amount=${borrowAmount}&slippageBps=100`
).then(r => r.json());

const swapRes = await fetch(`${LITE_API}/swap-instructions`, {
  method: "POST",
  body: JSON.stringify({ quoteResponse, userPublicKey: signer.toBase58() }),
}).then(r => r.json());

// 3. Get vault operate instructions (deposit + borrow)
const { ixs: operateIxs, addressLookupTableAccounts } = await getOperateIx({
  vaultId: 1, positionId: 0,
  colAmount: supplyAmount, debtAmount: borrowAmount,
  connection, signer,
});

// 4. Assemble: FlashBorrow → Swap → VaultOperate → FlashPayback
const instructions = [flashBorrowIx, swapIx, ...operateIxs, flashPaybackIx];
```

### Jupiter Lend Status
Jupiter Lend is a newer product. It supports specific vaults (SOL, USDC, etc.) with fixed vault IDs. It may have more limited asset support than Kamino or MarginFi for collateral.

---

## 5. Transaction Flow Design

### Option A: Kamino Leverage API (Simplest)

**Best for**: Quick implementation, limited to Kamino-supported collateral/debt pairs

```
User picks token → Chooses leverage
        ↓
Frontend calls Kamino Dialect API:
  POST https://kamino.dial.to/api/v0/leverage/{marketAddress}/openPosition
  collTokenMint = USDC_MINT (deposited as collateral)
  debtTokenMint = USDC_MINT (borrowed against collateral)
  amount = deposit amount
  leverage = user's chosen leverage
  slippage = 1%
        ↓
API returns base64 transaction
        ↓
⚠️ PROBLEM: This opens a USDC collateral / USDC debt position.
   It does NOT swap borrowed USDC into the meme token.
   The meme token swap needs to be a SEPARATE step.
```

**Revised Flow for Meme Token Long:**

Since Kamino's leverage positions are collateral/debt pairs within their lending market, and meme tokens aren't supported as collateral, we need a different approach:

1. **Kamino approach**: Deposit USDC → Borrow USDC (2x-10x) → Then separately swap all borrowed USDC to meme token via Jupiter
2. This means **two transactions**, not one atomic transaction
3. Risk: Price moves between the two transactions

### Option B: Custom Composable Transaction (Most Flexible)

**Best for**: True one-click experience, any token pair

```
Build a single Solana transaction with these instructions:
1. flash_loan_start (MarginFi/P0 or Jupiter Lend)
2. deposit_collateral(user_usdc, marginfi_bank)
3. borrow(borrow_usdc, marginfi_bank)
4. swap(borrowed_usdc → meme_token) [Jupiter Router /build instructions]
5. flash_loan_end (health check passes)

All atomic — if any step fails, everything reverts.
```

**Implementation with P0 SDK + Jupiter Router:**
```typescript
// 1. Get swap instructions from Jupiter Router /build
const swapData = await fetch(
  `https://api.jup.ag/swap/v2/build?inputMint=USDC&outputMint=MEME&amount=X&taker=WALLET`
);

// 2. Build flash loan + deposit + borrow + swap + repay sequence
// Using P0's lending_account_start_flashloan / end_flashloan instructions
// Combined with Jupiter's raw swap instructions

// 3. Sign and send as single VersionedTransaction
```

### Option C: MarginFi Loop + Jupiter Swap (Two-Step)

**Best for**: Simpler implementation, accepts 2-transaction flow

```
Transaction 1 (MarginFi):
  deposit USDC → borrow USDC (with leverage)

Transaction 2 (Jupiter Meta-Aggregator):  
  swap borrowed USDC → meme token
```

### Option D: Jupiter Lend Multiply (Newest, Most Integrated)

```typescript
// Single transaction using Jupiter Lend flashloan + Jupiter Swap
const instructions = [
  flashBorrowIx,        // Flash borrow USDC
  swapIx,               // Swap USDC → meme token (Jupiter Lite API)
  // ... deposit collateral + borrow to repay flash loan
  flashPaybackIx,       // Repay flash loan
];
```

**Limitation**: Jupiter Lend vaults are limited to major assets (SOL, USDC, etc.) — no meme token vaults. The meme token goes to the user's wallet, not into a vault.

### Recommended Architecture

For the "one-click leveraged long" use case with meme tokens:

```
┌──────────────────────────────────────────────────────────────┐
│                    USER FLOW                                  │
│                                                                │
│  1. Connect wallet (Phantom/Solflare)                         │
│  2. Select meme token (Jupiter token list)                     │
│  3. Enter USDC amount + leverage slider (2x-10x)               │
│  4. Click "Open Long"                                         │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  BACKEND BUILDS TRANSACTION:                             │   │
│  │                                                          │   │
│  │  a) Get Jupiter swap quote for USDC → meme token        │   │
│  │  b) Calculate borrow amount = deposit * (leverage - 1)  │   │
│  │  c) Build instructions:                                  │   │
│  │     - marginfi.flash_loan_start(borrow_amount)           │   │
│  │     - marginfi.deposit(user_usdc, usdc_bank)            │   │
│  │     - marginfi.borrow(borrow_amount, usdc_bank)          │   │
│  │     - [Jupiter swap instructions: USDC → meme]           │   │
│  │     - marginfi.flash_loan_end()                          │   │
│  │  d) Assemble VersionedTransaction with ALTs               │   │
│  │  e) Send to wallet for signing                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  5. User signs transaction in wallet                           │
│  6. Position: USDC collateral in marginfi + meme token in wallet│
│  7. Debt: USDC borrowed from marginfi                          │
└──────────────────────────────────────────────────────────────┘
```

**Key Insight**: The lending position is always **USDC collateral / USDC debt**. The meme token swap happens within the same atomic transaction, but the meme token itself is NOT collateralized — it goes to the user's wallet. This is how all leverage protocols handle non-whitelisted assets.

---

## 6. Existing Leveraged Long Protocols on Solana

### Kamino Multiply
- **Product**: Built-in leverage looping product
- **How**: Flash loan → swap → deposit → borrow → repay flash loan (atomic)
- **Supported pairs**: Only whitelisted reserves in Kamino markets
- **Max leverage**: 4x standard, ~7.7x eMode, 10x Jito eMode
- **API**: Dialect Blinks API (`/v0/leverage/.../openPosition`, `/v0/multiply/.../deposit`)
- **SDK**: `@kamino-finance/klend-sdk` with `getDepositWithLeverageIxs()`

### MarginFi mrgnloop
- **Product**: Consumer UI at https://app.marginfi.com/looper
- **How**: Flash loan → deposit → borrow → swap (atomic)
- **Supported pairs**: Whitelisted banks only (SOL, USDC, LSTs, etc.)
- **SDK**: `loop()` method in old SDK; manual flash loan composition in p0-ts-sdk

### Jupiter Lend Multiply
- **Product**: Jupiter's own lending protocol with multiply feature
- **How**: Flash loan → swap (Jupiter) → vault deposit + borrow → repay flash loan (atomic)
- **SDK**: `@jup-ag/lend` with `getFlashBorrowIx()` and `getOperateIx()`
- **Newest** of the three, limited vault selection

### Percolator
- **Product**: Permissionless perpetual futures launcher for Solana tokens
- **GitHub**: https://github.com/daatsuka/percolator-launch
- **Different approach**: Perps/derivatives rather than spot leverage
- **Status**: Early stage

### Long Your Longs
- **Product**: Memecoin launchpad (not a leverage protocol per se)

---

## 7. Key Risks & Considerations

### Smart Contract Risk
- Kamino, MarginFi/P0, and Jupiter Lend are all audited, open-source protocols
- Kamino Klend has been live since 2024 with significant TVL
- MarginFi has had past incidents (April 2024 oracle exploit) but has since been upgraded

### Liquidation Risk
- Leverage amplifies losses. A 5x leveraged position gets liquidated at ~20% price drop
- Each protocol has its own liquidation thresholds and health factor calculations
- Must monitor health factor and be ready to deleverage

### Meme Token Specific Risks
- **High volatility**: Meme tokens can drop 90%+ in minutes
- **Liquidity**: Jupiter routing may fail or have extreme slippage on low-liquidity tokens
- **No collateral value**: Meme tokens can't serve as lending collateral
- **Smart contract risk**: Many meme tokens have mint authorities or other attack vectors

### Transaction Complexity
- Leveraged longs with swaps require many instructions (10-20+)
- Solana transaction size limit: 1232 bytes (VersionedTransaction with ALTs helps)
- Compute unit limit: May need `ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })`
- Some protocols require pre-setup transactions (e.g., creating ATAs, setting up lookup tables)

### Oracle Risk
- All lending protocols use on-chain oracles (Pyth, Switchboard) for price feeds
- Oracle stale prices or manipulation can cause unexpected liquidations
- Meme tokens typically don't have reliable oracle feeds — another reason they can't be collateral

---

## Quick Reference: NPM Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@kamino-finance/klend-sdk` | 9.1.5 | Kamino lending SDK (deposit, borrow, multiply) |
| `@kamino-finance/kswap-sdk` | latest | Kamino swap routing |
| `@kamino-finance/scope-sdk` | latest | Oracle price feeds |
| `@0dotxyz/p0-ts-sdk` | 2.2.6 | P0/MarginFi lending SDK (deposit, borrow, flash loan) |
| `@mrgnlabs/marginfi-client-v2` | 6.4.2 | ⚠️ DEPRECATED — migrate to p0-ts-sdk |
| `@solana/web3.js` | 1.x | Solana transaction building |
| `@solana/kit` | latest | New Solana SDK (used by Kamino examples) |
| `@jup-ag/lend` | latest | Jupiter Lend flash loan + vault operations |
| `bn.js` | latest | Big number handling (used by all SDKs) |

## Key Constants

| Asset | Mint Address |
|-------|-------------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Kamino Main Market | `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` |
| Kamino xStocks Market | `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua` |
| marginfi-v2 Program | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` |
| Klend Program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |

## API Endpoints Summary

| Service | Base URL | Auth Required |
|---------|----------|---------------|
| Kamino REST API | `https://api.kamino.finance` | No |
| Kamino Dialect/Blinks API | `https://kamino.dial.to/api` | No |
| Kamino CDN (resources/LUTs) | `https://cdn.kamino.finance` | No |
| Jupiter Swap v2 | `https://api.jup.ag/swap/v2` | Yes (API key) |
| Jupiter Lite API | `https://lite-api.jup.ag/swap/v1` | Yes (API key) |
| MarginFi/P0 | On-chain only (no REST API for tx building) | N/A |