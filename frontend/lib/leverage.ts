/**
 * Leveraged spot longs on Solana — Kamino Multiply + Jupiter integration.
 *
 * Flow:
 *   1. User deposits SOL as collateral into a Kamino lending market
 *   2. Kamino borrows USDC against that collateral (leverage multiplier)
 *   3. If target token isn't USDC, Jupiter swaps the borrowed USDC → target token
 *   4. User ends up with: SOL collateral position on Kamino + target token in wallet
 *
 * Kamino only supports specific collateral/debt pairs per market:
 *   - Main (SOL/BTC): SOL collateral, USDC/BTC debt
 *   - Altcoins: various collateral, USDC debt
 *   - PUMP: PUMP collateral, USDC debt
 *   - etc.
 *
 * USDC→USDC leverage is NOT supported (that's just borrowing, not leverage).
 * For meme token longs: deposit SOL → borrow USDC → swap to meme via Jupiter.
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

// Kamino markets — each supports specific collateral/debt pairs
const KAMINO_MARKETS: Record<string, { address: string; collMints: string[]; debtMints: string[] }> = {
  main: {
    address: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
    collMints: [SOL_MINT],
    debtMints: [USDC_MINT],
  },
  altcoins: {
    address: "ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5",
    collMints: [SOL_MINT],
    debtMints: [USDC_MINT],
  },
  pump: {
    address: "J21qWrb66pvEYhk24P98JYNHamxGFDcGZB4pYuSuMCBr",
    collMints: [SOL_MINT, "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"],
    debtMints: [USDC_MINT],
  },
  bitcoin: {
    address: "GMqmFygF5iSm5nkckYU6tieggFcR42SyjkkhK5rswFRs",
    collMints: [SOL_MINT],
    debtMints: [USDC_MINT],
  },
};

const KAMINO_DIALECT_API = "https://kamino.dial.to/api";
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

// ─── Market Selection ──────────────────────────────────────────────────────

/**
 * Pick the best Kamino market for a leverage position.
 * We always deposit SOL and borrow USDC, then swap to target.
 * The market just needs SOL as collateral and USDC as debt.
 */
function pickMarket(): { address: string; collMint: string; debtMint: string } {
  // Use the main SOL/BTC market — it has SOL collateral + USDC debt
  const main = KAMINO_MARKETS.main;
  return {
    address: main.address,
    collMint: SOL_MINT,
    debtMint: USDC_MINT,
  };
}

// ─── Kamino Leverage API (Dialect/Blinks — CORS-enabled) ──────────────────

export interface KaminoSetupParams {
  wallet: string;
  market?: string;
  collTokenMint?: string;
  debtTokenMint?: string;
}

export interface KaminoLeverageParams {
  wallet: string;
  market?: string;
  collTokenMint?: string;
  debtTokenMint?: string;
  leverage: number;
  amount: number;
  slippage?: number;
}

/**
 * Step 1: Create a Kamino obligation account.
 * Must be called once before opening a leveraged position.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
 */
export async function kaminoSetup(params: KaminoSetupParams): Promise<string> {
  const market = params.market ?? KAMINO_MARKETS.main.address;
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
  return data.transaction;
}

/**
 * Step 2: Open a leveraged position.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
 * NOTE: User must have completed setup first.
 */
export async function kaminoOpenPosition(params: KaminoLeverageParams): Promise<string> {
  const market = params.market ?? KAMINO_MARKETS.main.address;
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
  return data.transaction;
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
  amount: number;
  slippageBps?: number;
}

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
  return data.swapTransaction;
}

// ─── Wallet Signing Helper ────────────────────────────────────────────────

export async function signAndSendTransaction(
  base64Tx: string,
  walletAdapter: any,
  connection: Connection,
): Promise<string> {
  const txBuf = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(txBuf);

  if (!walletAdapter.signTransaction) {
    throw new Error("Wallet does not support transaction signing");
  }

  const signedTx = await walletAdapter.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  return signature;
}

// ─── Utility ──────────────────────────────────────────────────────────────

export function usdcToRaw(amount: number): number {
  return Math.round(amount * 1_000_000);
}

export function calculateLeverageMetrics(collateralUsd: number, leverage: number) {
  const notionalUsd = collateralUsd * leverage;
  const borrowUsd = notionalUsd - collateralUsd;
  const liquidationDrop = (1 / leverage) * 100;
  return { notionalUsd, borrowUsd, liquidationDropPct: liquidationDrop };
}

// ─── High-Level Flow ───────────────────────────────────────────────────────

export interface OpenLeveragePositionParams {
  walletAddress: string;
  walletAdapter: any;
  connection: Connection;
  collateralSol: number;    // SOL amount to deposit (e.g. 0.1)
  leverage: number;          // 1.1 - 10
  targetMint: string;        // Token to long (USDC_MINT for no swap, any SPL token otherwise)
  slippagePercent?: number;
}

/**
 * Open a leveraged long position:
 *   1. Kamino setup — create obligation (one-time, OK if already exists)
 *   2. Kamino openPosition — deposit SOL, borrow USDC with leverage
 *   3. If target isn't USDC, Jupiter swap borrowed USDC → target token
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
    collateralSol,
    leverage,
    targetMint,
    slippagePercent = 1,
  } = params;

  const { address: marketAddr } = pickMarket();

  const signatures: string[] = [];
  const steps: string[] = [];

  try {
    // Step 1: Try setup (creates obligation if needed — OK if already exists)
    try {
      steps.push("Creating Kamino obligation...");
      const setupTx = await kaminoSetup({
        wallet: walletAddress,
        market: marketAddr,
        collTokenMint: SOL_MINT,
        debtTokenMint: USDC_MINT,
      });
      const setupSig = await signAndSendTransaction(setupTx, walletAdapter, connection);
      signatures.push(setupSig);
      steps.push(`Obligation created: ${setupSig.slice(0, 8)}…`);
    } catch (e: any) {
      if (e?.message?.includes("already") || e?.message?.includes("0x1")) {
        steps.push("Obligation already exists, skipping setup");
      } else {
        steps.push(`Setup skipped: ${e?.message ?? "unknown"}`);
      }
    }

    // Step 2: Open leveraged position — deposit SOL, borrow USDC
    steps.push("Opening leveraged position (deposit SOL, borrow USDC)…");
    const positionTx = await kaminoOpenPosition({
      wallet: walletAddress,
      market: marketAddr,
      collTokenMint: SOL_MINT,
      debtTokenMint: USDC_MINT,
      leverage,
      amount: collateralSol,
      slippage: slippagePercent,
    });
    const positionSig = await signAndSendTransaction(positionTx, walletAdapter, connection);
    signatures.push(positionSig);
    steps.push(`Position opened: ${positionSig.slice(0, 8)}…`);

    // Step 3: If target isn't USDC, swap borrowed USDC → target via Jupiter
    if (targetMint !== USDC_MINT) {
      steps.push("Swapping borrowed USDC → target token via Jupiter…");
      const borrowUsd = collateralSol * (leverage - 1) * 150; // rough SOL price * leverage
      // Get SOL price to estimate borrowed amount
      // For now, use a reasonable USDC amount estimate
      const rawAmount = usdcToRaw(Math.max(borrowUsd, 1)); // at least 1 USDC

      const quote = await getJupiterQuote({
        inputMint: USDC_MINT,
        outputMint: targetMint,
        amount: rawAmount,
        slippageBps: Math.round(slippagePercent * 100),
      });

      const swapBase64 = await getJupiterSwapTx(quote, walletAddress, Math.round(slippagePercent * 100));
      const swapSig = await signAndSendTransaction(swapBase64, walletAdapter, connection);
      signatures.push(swapSig);
      steps.push(`Swap complete: ${swapSig.slice(0, 8)}…`);
    }

    return { signatures, steps };
  } catch (error: any) {
    error.steps = steps;
    error.signatures = signatures;
    throw error;
  }
}