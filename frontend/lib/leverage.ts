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
 * Two-step flow:
 *   Step 1: /kamino/setup — create obligation account (one-time, user signs)
 *   Step 2: /kamino/open-position — open leveraged position (user signs)
 *   Step 3: /jupiter/quote — get swap quote for USDC → meme token
 *   Step 4: Sign and send swap transaction via wallet
 *
 * For MVP, steps 1+2 use Kamino Blinks API (one REST call returns assembled tx).
 * Step 3+4 uses Jupiter v6 API.
 */

import { PublicKey } from "@solana/web3.js";

// ─── Constants ───────────────────────────────────────────────────────────

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

// Backend API base URL — same origin in prod (Vercel rewrites)
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// ─── Types ───────────────────────────────────────────────────────────────

export type LeverageMode = "perps" | "spot";

export interface LeverageQuote {
  collateralUsd: number;
  leverage: number;
  notionalUsd: number;
  borrowUsd: number;
  targetMint: string;
  estimatedSlippage: number;
  estimatedLiquidationPrice: number;
  implementation: "kamino-blinks" | "custom-compose";
}

export interface TokenSearchResult {
  mint: string;
  symbol: string;
  name: string;
  logoUri?: string;
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
}

export interface JupiterQuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{ swapInfo: Record<string, string>; percent: number }>;
  otherAmountThreshold: string;
  slippageBps: number;
}

// ─── Token Search (DexScreener) ──────────────────────────────────────────

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

  // Sort by volume (most traded first)
  results.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return results.slice(0, 20);
}

// ─── Kamino Leverage API ─────────────────────────────────────────────────

export interface KaminoSetupParams {
  wallet: string;             // base58 Solana pubkey
  market?: string;            // Kamino market address
  collTokenMint?: string;     // Collateral token (default: SOL)
  debtTokenMint?: string;     // Debt token (default: USDC)
}

export interface KaminoLeverageParams {
  wallet: string;             // base58 Solana pubkey
  market?: string;            // Kamino market address
  collTokenMint?: string;     // Collateral token
  debtTokenMint?: string;     // Debt token
  leverage: number;           // 1.1 - 10
  amount: number;             // Human-readable deposit amount
  slippage?: number;          // 0.1 - 10% (default 1%)
}

/**
 * Step 1: Create a Kamino obligation account.
 * Must be called once before opening a leveraged position.
 * Returns a base64-encoded transaction for wallet signing.
 */
export async function kaminoSetup(params: KaminoSetupParams): Promise<string> {
  const r = await fetch(`${API_BASE}/api/kamino/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: params.wallet,
      market: params.market ?? KAMINO_MAIN_MARKET,
      collTokenMint: params.collTokenMint ?? SOL_MINT,
      debtTokenMint: params.debtTokenMint ?? USDC_MINT,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Kamino setup failed: ${err}`);
  }

  const data = await r.json();
  return data.transaction; // base64-encoded VersionedTransaction
}

/**
 * Step 2: Open a leveraged position.
 * Returns a base64-encoded transaction for wallet signing.
 * NOTE: User must have completed setup first.
 */
export async function kaminoOpenPosition(params: KaminoLeverageParams): Promise<string> {
  const r = await fetch(`${API_BASE}/api/kamino/open-position`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: params.wallet,
      market: params.market ?? KAMINO_MAIN_MARKET,
      collTokenMint: params.collTokenMint ?? SOL_MINT,
      debtTokenMint: params.debtTokenMint ?? USDC_MINT,
      leverage: params.leverage,
      amount: params.amount,
      slippage: params.slippage ?? 1.0,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Kamino leverage failed: ${err}`);
  }

  const data = await r.json();
  return data.transaction; // base64-encoded VersionedTransaction
}

/**
 * Get available Kamino markets (for future UI).
 */
export async function getKaminoMarkets(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/api/kamino/markets`);
  if (!r.ok) throw new Error(`Kamino markets failed: ${r.status}`);
  return r.json();
}

// ─── Jupiter Swap ─────────────────────────────────────────────────────────

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;      // In smallest unit (6 decimals for USDC)
  slippageBps?: number; // Default 100 = 1%
}

/**
 * Get a Jupiter swap quote for USDC → meme token.
 * Proxied through our backend to avoid CORS issues.
 */
export async function getJupiterQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
  const params_str = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps ?? 100),
  });

  const r = await fetch(`${API_BASE}/api/jupiter/quote?${params_str}`);
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Jupiter quote failed: ${err}`);
  }
  return r.json();
}

// ─── Utility ─────────────────────────────────────────────────────────────

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