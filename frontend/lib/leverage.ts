/**
 * Leveraged spot longs on Solana — Kamino + Jupiter integration.
 *
 * Architecture:
 *   1. User deposits USDC as collateral into Kamino lending
 *   2. Borrows more USDC (leverage multiplier)
 *   3. Swaps borrowed + original USDC → meme token via Jupiter
 *   4. All atomic via flash loan: start → deposit → borrow → swap → end
 *
 * The meme token goes to the user's wallet (can't be lending collateral).
 * The lending position is USDC collateral / USDC debt.
 *
 * Two-step flow via Kamino Blinks API (CORS-enabled, direct browser calls):
 *   Step 1: /setup — create obligation account on Kamino (one-time)
 *   Step 2: /openPosition — open leveraged position (user signs tx)
 *
 * For tokens not in Kamino's swap routes, we do:
 *   Step 1: /setup (same)
 *   Step 2: /openPosition with USDC deposit → borrows more USDC
 *   Step 3 (optional): Jupiter swap the resulting USDC → target meme token
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

const KAMINO_DIALECT_API = "https://kamino.dial.to/api";
const KAMINO_REST_API = "https://api.kamino.finance";
const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TokenSearchResult {
  mint: string;
  symbol: string;
  name: string;
  logoUri?: string;
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
}

// ─── Token Search (DexScreener — CORS-enabled) ─────────────────────────────

export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  if (query.length < 2) return [];

  const r = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const pairs = data.pairs ?? [];

  const seen = new Set<string>();
  const results: TokenSearchResult[] = [];

  for (const p of pairs) {
    const mint = p.baseToken?.address;
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);

    results.push({
      mint,
      symbol: p.baseToken?.symbol ?? "???",
      name: p.baseToken?.name ?? p.baseToken?.symbol ?? "Unknown",
      logoUri: p.baseToken?.logoUri,
      priceUsd: parseFloat(p.priceUsd ?? "0") || undefined,
      volume24h: parseFloat(p.volume?.h24 ?? "0") || undefined,
      liquidity: parseFloat(p.liquidity?.usd ?? "0") || undefined,
    });
  }

  results.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return results.slice(0, 20);
}

// ─── Kamino Leverage API (Dialect/Blinks — CORS-enabled) ──────────────────

export interface KaminoSetupParams {
  wallet: string;             // base58 Solana pubkey
  market?: string;
  collTokenMint?: string;
  debtTokenMint?: string;
}

export interface KaminoLeverageParams {
  wallet: string;
  market?: string;
  collTokenMint?: string;
  debtTokenMint?: string;
  leverage: number;           // 1.1 - 10
  amount: number;             // Human-readable deposit amount
  slippage?: number;          // 0.1 - 10%
}

/**
 * Step 1: Create a Kamino obligation account.
 * Must be called once before opening a leveraged position.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
 */
export async function kaminoSetup(params: KaminoSetupParams): Promise<string> {
  const market = params.market ?? KAMINO_MAIN_MARKET;
  const collMint = params.collTokenMint ?? SOL_MINT;
  const debtMint = params.debtTokenMint ?? USDC_MINT;

  const url = new URL(`${KAMINO_DIALECT_API}/v0/leverage/${market}/setup`);
  url.searchParams.set("collTokenMint", collMint);
  url.searchParams.set("debtTokenMint", debtMint);

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "transaction", account: params.wallet }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Kamino setup failed (${r.status}): ${err}`);
  }

  const data = await r.json();
  return data.transaction; // base64-encoded VersionedTransaction
}

/**
 * Step 2: Open a leveraged position.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
 * NOTE: User must have completed setup first.
 */
export async function kaminoOpenPosition(params: KaminoLeverageParams): Promise<string> {
  const market = params.market ?? KAMINO_MAIN_MARKET;
  const collMint = params.collTokenMint ?? SOL_MINT;
  const debtMint = params.debtTokenMint ?? USDC_MINT;

  const url = new URL(`${KAMINO_DIALECT_API}/v0/leverage/${market}/openPosition`);
  url.searchParams.set("collTokenMint", collMint);
  url.searchParams.set("debtTokenMint", debtMint);
  url.searchParams.set("leverage", String(params.leverage));
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("slippage", String(params.slippage ?? 1.0));

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "transaction", account: params.wallet }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Kamino leverage failed (${r.status}): ${err}`);
  }

  const data = await r.json();
  return data.transaction; // base64-encoded VersionedTransaction
}

/**
 * Get available Kamino markets.
 */
export async function getKaminoMarkets(): Promise<Array<{ name: string; lendingMarket: string }>> {
  const r = await fetch(`${KAMINO_REST_API}/v2/kamino-market`);
  if (!r.ok) throw new Error(`Kamino markets failed: ${r.status}`);
  return r.json();
}

// ─── Jupiter Swap (direct — may need proxy for CORS) ─────────────────────

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;         // In smallest unit (6 decimals for USDC, 9 for SOL)
  slippageBps?: number;
}

/**
 * Get a Jupiter swap quote.
 * Uses v6 quote API (may need proxy for CORS).
 */
export async function getJupiterQuote(params: JupiterQuoteParams): Promise<any> {
  const url = new URL(`${JUPITER_QUOTE_API}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));

  const r = await fetch(url.toString());
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Jupiter quote failed (${r.status}): ${err}`);
  }
  return r.json();
}

/**
 * Get a swap transaction from Jupiter.
 * Returns base64-encoded VersionedTransaction.
 */
export async function getJupiterSwapTx(
  quoteResponse: any,
  wallet: string,
  slippageBps = 100,
): Promise<string> {
  const r = await fetch(`${JUPITER_QUOTE_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Jupiter swap failed (${r.status}): ${err}`);
  }

  const data = await r.json();
  return data.swapTransaction; // base64-encoded VersionedTransaction
}

// ─── Wallet Signing Helper ────────────────────────────────────────────────

/**
 * Sign and send a base64-encoded VersionedTransaction using Solana wallet adapter.
 * Returns the transaction signature.
 */
export async function signAndSendTransaction(
  base64Tx: string,
  walletAdapter: any, // SignerWalletAdapter from @solana/wallet-adapter-base
  connection: Connection,
): Promise<string> {
  // Deserialize the transaction
  const txBuf = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(txBuf);

  // Sign with the wallet
  // signTransaction is available on SignerWalletAdapter
  if (!walletAdapter.signTransaction) {
    throw new Error("Wallet does not support transaction signing");
  }

  // For VersionedTransaction, we need to use signTransaction from the adapter
  // Some adapters return the signed tx, others modify in-place
  const signedTx = await walletAdapter.signTransaction(tx);

  // Send the signed transaction
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // Confirm the transaction
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  return signature;
}

// ─── Utility ──────────────────────────────────────────────────────────────

/** USDC has 6 decimals */
export function usdcToRaw(amount: number): number {
  return Math.round(amount * 1_000_000);
}

/** Calculate leverage metrics */
export function calculateLeverageMetrics(collateralUsd: number, leverage: number) {
  const notionalUsd = collateralUsd * leverage;
  const borrowUsd = notionalUsd - collateralUsd;
  const liquidationDrop = (1 / leverage) * 100; // % drop that triggers liquidation
  return { notionalUsd, borrowUsd, liquidationDropPct: liquidationDrop };
}

// ─── High-Level Flow ───────────────────────────────────────────────────────

export interface OpenLeveragePositionParams {
  walletAddress: string;  // base58 Solana pubkey
  walletAdapter: any;     // SignerWalletAdapter
  connection: Connection;
  collateralUsd: number;
  leverage: number;
  targetMint: string;     // Token to long
  slippagePercent?: number;
}

/**
 * Open a leveraged long position:
 * 1. Try Kamino setup (creates obligation if needed — may fail if already set up, that's OK)
 * 2. Open leveraged position via Kamino (deposits USDC, borrows more, swaps)
 * 3. If target mint isn't USDC or SOL, do a separate Jupiter swap
 *
 * Returns the transaction signature(s).
 */
export async function openLeveragePosition(params: OpenLeveragePositionParams): Promise<{
  signatures: string[];
  steps: string[];
}> {
  const {
    walletAddress,
    walletAdapter,
    connection,
    collateralUsd,
    leverage,
    targetMint,
    slippagePercent = 1,
  } = params;

  const signatures: string[] = [];
  const steps: string[] = [];

  try {
    // Step 1: Try setup (creates obligation if needed — OK if fails = already exists)
    try {
      steps.push("Creating Kamino obligation...");
      const setupTx = await kaminoSetup({
        wallet: walletAddress,
        collTokenMint: USDC_MINT, // Deposit USDC as collateral
        debtTokenMint: USDC_MINT,  // Borrow USDC
      });
      const setupSig = await signAndSendTransaction(setupTx, walletAdapter, connection);
      signatures.push(setupSig);
      steps.push(`Obligation created: ${setupSig}`);
    } catch (e: any) {
      // Setup fails if obligation already exists — that's fine
      if (e?.message?.includes("already") || e?.message?.includes("0x1")) {
        steps.push("Obligation already exists, skipping setup");
      } else {
        // Unexpected error — still log but continue
        steps.push(`Setup skipped: ${e?.message ?? "unknown"}`);
      }
    }

    // Step 2: Open leveraged position via Kamino
    steps.push("Opening leveraged position...");
    const positionTx = await kaminoOpenPosition({
      wallet: walletAddress,
      collTokenMint: USDC_MINT,  // Deposit USDC
      debtTokenMint: USDC_MINT,   // Borrow USDC
      leverage,
      amount: collateralUsd,
      slippage: slippagePercent,
    });
    const positionSig = await signAndSendTransaction(positionTx, walletAdapter, connection);
    signatures.push(positionSig);
    steps.push(`Position opened: ${positionSig}`);

    // Step 3: If target isn't USDC, swap the borrowed USDC → target via Jupiter
    if (targetMint !== USDC_MINT) {
      steps.push("Swapping USDC → target token via Jupiter...");
      const borrowUsd = collateralUsd * (leverage - 1);
      const rawAmount = usdcToRaw(borrowUsd);

      const quote = await getJupiterQuote({
        inputMint: USDC_MINT,
        outputMint: targetMint,
        amount: rawAmount,
        slippageBps: Math.round(slippagePercent * 100),
      });

      const swapBase64 = await getJupiterSwapTx(quote, walletAddress, Math.round(slippagePercent * 100));
      const swapSig = await signAndSendTransaction(swapBase64, walletAdapter, connection);
      signatures.push(swapSig);
      steps.push(`Swap complete: ${swapSig}`);
    }

    return { signatures, steps };
  } catch (error: any) {
    // Attach partial progress info to the error
    error.steps = steps;
    error.signatures = signatures;
    throw error;
  }
}