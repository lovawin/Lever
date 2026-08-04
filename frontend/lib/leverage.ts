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
 * Two implementation paths:
 *   A) Kamino Dialect/Blinks API (simplest — one REST call)
 *   B) Custom composable tx (P0/MarginFi flash loan + Jupiter Router /build)
 *
 * Path A is what we'll ship first.
 */

import { PublicKey } from "@solana/web3.js";

// ─── Constants ───────────────────────────────────────────────────────────

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Kamino main market */
export const KAMINO_MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");

/** marginfi v2 program */
export const MARGINFI_PROGRAM = new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");

// ─── Types ───────────────────────────────────────────────────────────────

export type LeverageMode = "perps" | "spot";

export interface LeverageQuote {
  /** Collateral amount (what user deposits) */
  collateralUsd: number;
  /** Leverage multiplier (2-5x for spot, up to 20x for perps) */
  leverage: number;
  /** Total position size (collateral * leverage) */
  notionalUsd: number;
  /** Amount borrowed from lending protocol */
  borrowUsd: number;
  /** Target token mint address */
  targetMint: string;
  /** Estimated slippage in % */
  estimatedSlippage: number;
  /** Estimated liquidation price (USDC debt / collateral LTV) */
  estimatedLiquidationPrice: number;
  /** Which implementation path to use */
  implementation: "kamino-blinks" | "custom-compose";
}

export interface KaminoLeverageRequest {
  marketAddress: string;      // Kamino market pubkey
  collTokenMint: string;      // USDC mint
  debtTokenMint: string;      // USDC mint (borrowing same asset)
  leverage: number;            // 1.1 - 10
  amount: number;              // Human-readable deposit amount
  slippage: number;            // 0.1 - 10%
  account: string;             // Wallet pubkey (base58)
}

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;             // In smallest unit (lamports for SOL, raw for USDC)
  slippageBps?: number;       // Default 100 = 1%
}

// ─── Kamino Dialect/Blinks API ───────────────────────────────────────────
// This is the easiest path — one REST call returns a fully assembled tx.
// POST https://kamino.dial.to/api/v0/leverage/{marketAddress}/openPosition

const KAMINO_DIALECT_API = "https://kamino.dial.to/api";

/**
 * Open a leveraged position via Kamino's Blinks API.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
 *
 * Note: This creates a USDC collateral / USDC debt position.
 * The meme token swap happens SEPARATELY via Jupiter after the
 * position is opened (not fully atomic — see custom compose for that).
 */
export async function openKaminoLeveragePosition(
  params: KaminoLeverageRequest
): Promise<string> {
  const url = new URL(
    `${KAMINO_DIALECT_API}/v0/leverage/${params.marketAddress}/openPosition`
  );
  url.searchParams.set("collTokenMint", params.collTokenMint);
  url.searchParams.set("debtTokenMint", params.debtTokenMint);
  url.searchParams.set("leverage", String(params.leverage));
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("slippage", String(params.slippage));

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "transaction",
      account: params.account,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Kamino leverage API error ${r.status}: ${text}`);
  }

  const data = await r.json();
  return data.transaction; // base64-encoded VersionedTransaction
}

// ─── Jupiter Swap API (v2) ───────────────────────────────────────────────
// Used for swapping borrowed USDC → meme token.
// Meta-Aggregator (/order + /execute) for simple swaps.
// Router (/build) for composable instructions in flash loan txs.

const JUPITER_API_V2 = "https://api.jup.ag/swap/v2";
const JUPITER_LITE_API = "https://lite-api.jup.ag/swap/v1";

/** USDC has 6 decimals */
export function usdcToRaw(amount: number): number {
  return Math.round(amount * 1_000_000);
}

/**
 * Get a Jupiter swap quote (v2 Meta-Aggregator).
 * Requires API key: https://developers.jup.ag/portal
 */
export async function getJupiterQuote(
  params: JupiterQuoteParams,
  apiKey: string
): Promise<any> {
  const url = new URL(`${JUPITER_API_V2}/order`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("taker", params.outputMint); // placeholder — real wallet address needed

  const r = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey },
  });
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status}`);
  return r.json();
}

/**
 * Get Jupiter swap instructions for composable transactions.
 * Returns raw instructions that can be combined with lending ops.
 */
export async function getJupiterSwapInstructions(
  params: JupiterQuoteParams & { userPublicKey: string },
  apiKey: string
): Promise<any> {
  const url = new URL(`${JUPITER_API_V2}/build`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("taker", params.userPublicKey);

  const r = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey },
  });
  if (!r.ok) throw new Error(`Jupiter build failed: ${r.status}`);
  return r.json();
}

// ─── Composite: One-Click Leverage ───────────────────────────────────────
// The full flow for true one-click leveraged longs:
//   1. Flash loan start (borrow USDC)
//   2. Deposit user USDC + flash-borrowed USDC as collateral
//   3. Borrow USDC against collateral
//   4. Jupiter swap: borrowed USDC → meme token
//   5. Flash loan end (health check)
//
// This requires building a custom VersionedTransaction with:
//   - P0/MarginFi flash loan instructions
//   - Jupiter Router /build swap instructions
//   - Address lookup tables for transaction size efficiency
//
// Status: NOT YET IMPLEMENTED — requires:
//   - @0dotxyz/p0-ts-sdk for lending + flash loan
//   - Jupiter API key
//   - Wallet signing flow

export async function buildLeveragedLongTx(_params: {
  userPublicKey: PublicKey;
  collateralUsd: number;
  leverage: number;
  targetTokenMint: string;
  slippageBps?: number;
}): Promise<never> {
  throw new Error(
    "One-click leverage not yet wired. Kamino Blinks API + Jupiter swap integration in progress. 🔧"
  );
}

// ─── Search: Token lookup for spot mode ───────────────────────────────────

export interface TokenSearchResult {
  mint: string;
  symbol: string;
  name: string;
  logoUri?: string;
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
}

/**
 * Search for tokens by name/symbol using Jupiter token list or DexScreener.
 * Returns candidates for the spot leverage token picker.
 */
export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  // Use DexScreener search (already integrated in backend)
  const r = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`
  );
  if (!r.ok) return [];

  const data = await r.json();
  const pairs = data.pairs ?? [];

  // Deduplicate by baseToken address, sort by volume
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

  // Sort by volume (most traded first)
  results.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return results.slice(0, 20);
}