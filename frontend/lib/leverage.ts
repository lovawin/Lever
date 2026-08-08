/**
 * Leveraged spot longs on Solana — Lavarage + Kamino + Jupiter integration.
 *
 * Strategy:
 *   1. Lavarage API (primary) — supports any token, returns pre-built tx for signing
 *      Requires API key for position endpoints; offers are public.
 *   2. Kamino Dialect (fallback) — SOL collateral + USDC debt pairs only
 *      Setup + openPosition, then Jupiter swap USDC → target
 *   3. Pure spot (no leverage) — Jupiter swap SOL → target token, 1x only
 *
 * The flow:
 *   - Try Lavarage first (if API key available and pool exists)
 *   - Fall back to Kamino for SOL/USDC pairs
 *   - Fall back to pure Jupiter swap (1x, no leverage)
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

// Lavarage API — spot leverage for any token
const LAVARAGE_API = "https://api.lavarage.xyz";
export const LAVARAGE_API_KEY = process.env.NEXT_PUBLIC_LAVARAGE_API_KEY || "";

// Kamino Dialect (Blinks) API — CORS-enabled, returns signed transactions
const KAMINO_DIALECT_API = "https://kamino.dial.to/api";
// Kamino REST API — market metadata
const KAMINO_REST_API = "https://api.kamino.finance";

// Jupiter Swap API v1 (lite) — requires API key for production rate limits
// Get key at https://developers.jup.ag/portal
const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1";
const JUPITER_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

// Known Kamino markets — SOL collateral + USDC debt pairs
const KAMINO_MARKETS: Record<string, { address: string; name: string }> = {
  main:       { address: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF", name: "SOL/BTC Market" },
  altcoins:   { address: "ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5", name: "Altcoins Market" },
  pump:       { address: "J21qWrb66pvEYhk24P98JYNHamxGFDcGZB4pYuSuMCBr", name: "PUMP Market" },
  bitcoin:    { address: "GMqmFygF5iSm5nkckYU6tieggFcR42SyjkkhK5rswFRs", name: "Bitcoin Market" },
  fartcoin:   { address: "4UwtBqa8DDtcWV6nWFregeMVkGdfWfiYeFxoHaR2hm9c", name: "Fartcoin Market" },
  bonk:       { address: "7WQeTuLsFrZsgnHW7ddFdNfhfJAViqH4mvcFZPQ5zuQ9", name: "Bonk Market" },
};

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

export type LeverageProvider = "lavarage" | "kamino" | "spot";

export interface LavarageOffer {
  publicKey: string;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  baseToken: { symbol: string; name: string; address: string; decimals: number; price: string };
  quoteToken: { symbol: string; name: string; address: string; decimals: number; price: string };
  maxLeverage: string;
  availableForOpen: string;
  side: string;
  apr: string;
}

export interface LeverageResult {
  signatures: string[];
  steps: string[];
  provider: LeverageProvider;
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
    // Only include Solana pairs — this is a Solana feature
    if (p.chainId !== "solana") continue;

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

// ─── SOL Price Helper ──────────────────────────────────────────────────────

export async function getSolPrice(): Promise<number> {
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/search?q=SOL");
    if (r.ok) {
      const data = await r.json();
      const pairs = data.pairs ?? [];
      for (const p of pairs) {
        if (
          p.chainId === "solana" &&
          p.quoteToken?.address === USDC_MINT &&
          p.baseToken?.address === SOL_MINT &&
          parseFloat(p.priceUsd ?? "0") > 0
        ) {
          return parseFloat(p.priceUsd);
        }
      }
      for (const p of pairs) {
        if (p.baseToken?.symbol === "SOL" && parseFloat(p.priceUsd ?? "0") > 0) {
          return parseFloat(p.priceUsd);
        }
      }
    }
  } catch { /* ignore */ }
  return 175; // hardcoded fallback
}

// ─── Lavarage API ──────────────────────────────────────────────────────────

/**
 * Search Lavarage offers for a token.
 * Public endpoint — no API key required.
 */
export async function searchLavarageOffers(
  baseTokenMint: string,
  side: "LONG" | "SHORT" = "LONG"
): Promise<LavarageOffer[]> {
  const url = new URL(`${LAVARAGE_API}/api/v1/offers/match`);
  url.searchParams.set("baseTokenMint", baseTokenMint);
  url.searchParams.set("side", side);

  const headers: Record<string, string> = {};
  if (LAVARAGE_API_KEY) headers["x-api-key"] = LAVARAGE_API_KEY;

  const r = await fetch(url.toString(), { headers });
  if (!r.ok) {
    // No matching offers — token not supported on Lavarage
    return [];
  }

  const data = await r.json();
  // match endpoint returns { best, alternatives }
  const offers: LavarageOffer[] = [];
  if (data.best) offers.push(data.best);
  if (data.alternatives?.length) offers.push(...data.alternatives);
  return offers;
}

/**
 * Get all Lavarage offers (for browsing).
 * Public endpoint — no API key required.
 */
export async function getLavarageOffers(params?: {
  search?: string;
  side?: string;
  limit?: number;
}): Promise<LavarageOffer[]> {
  const url = new URL(`${LAVARAGE_API}/api/v1/offers`);
  if (params?.search) url.searchParams.set("search", params.search);
  if (params?.side) url.searchParams.set("side", params.side);
  if (params?.limit) url.searchParams.set("limit", String(params.limit));

  const r = await fetch(url.toString());
  if (!r.ok) return [];
  return r.json();
}

/**
 * Open a leveraged position via Lavarage.
 * Requires API key. Returns base58-encoded VersionedTransaction.
 */
export async function lavarageOpenPosition(params: {
  baseTokenMint: string;
  quoteTokenMint?: string;  // defaults to SOL for LONG
  userPublicKey: string;
  collateralAmount: string;  // raw units (lamports for SOL, 1e6 for USDC)
  leverage: number;
  side: "LONG" | "SHORT";
  slippageBps?: number;
}): Promise<{ transaction: string; positionAddress: string; quote: any }> {
  if (!LAVARAGE_API_KEY) {
    throw new Error("Lavarage API key required — set NEXT_PUBLIC_LAVARAGE_API_KEY");
  }

  const r = await fetch(`${LAVARAGE_API}/api/v1/positions/open-by-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": LAVARAGE_API_KEY,
    },
    body: JSON.stringify({
      baseTokenMint: params.baseTokenMint,
      quoteTokenMint: params.quoteTokenMint ?? SOL_MINT,
      userPublicKey: params.userPublicKey,
      collateralAmount: params.collateralAmount,
      leverage: params.leverage,
      side: params.side,
      slippageBps: params.slippageBps ?? 100,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Lavarage open failed (${r.status}): ${err}`);
  }

  return r.json();
}

/**
 * Quote a Lavarage position without building a transaction.
 */
export async function lavarageQuote(params: {
  baseTokenMint: string;
  quoteTokenMint?: string;
  userPublicKey: string;
  collateralAmount: string;
  leverage: number;
  side: "LONG" | "SHORT";
  slippageBps?: number;
}): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (LAVARAGE_API_KEY) headers["x-api-key"] = LAVARAGE_API_KEY;

  const r = await fetch(`${LAVARAGE_API}/api/v1/positions/quote-by-token`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      baseTokenMint: params.baseTokenMint,
      quoteTokenMint: params.quoteTokenMint ?? SOL_MINT,
      userPublicKey: params.userPublicKey,
      collateralAmount: params.collateralAmount,
      leverage: params.leverage,
      side: params.side,
      slippageBps: params.slippageBps ?? 100,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Lavarage quote failed (${r.status}): ${err}`);
  }

  return r.json();
}

// ─── Kamino Leverage API (Dialect/Blinks) ──────────────────────────────────

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
 * Step 2: Open a leveraged position on Kamino.
 * Returns a base64-encoded VersionedTransaction for wallet signing.
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
 * Get available Kamino markets from the REST API.
 */
export async function getKaminoMarkets(): Promise<Array<{ name: string; lendingMarket: string }>> {
  const r = await fetch(`${KAMINO_REST_API}/v2/kamino-market`);
  if (!r.ok) throw new Error(`Kamino markets failed: ${r.status}`);
  return r.json();
}

// ─── Jupiter Swap ──────────────────────────────────────────────────────────

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number;  // in lamports/raw units
  slippageBps?: number;
}

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
}

export async function getJupiterQuote(params: JupiterQuoteParams): Promise<JupiterQuote> {
  const url = new URL(`${JUPITER_SWAP_API}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));

  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) headers["x-api-key"] = JUPITER_API_KEY;

  const r = await fetch(url.toString(), { headers });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Jupiter quote failed (${r.status}): ${err}`);
  }
  return r.json();
}

export async function getJupiterSwapTx(
  quoteResponse: JupiterQuote,
  wallet: string,
  slippageBps = 100,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (JUPITER_API_KEY) headers["x-api-key"] = JUPITER_API_KEY;

  const r = await fetch(`${JUPITER_SWAP_API}/swap`, {
    method: "POST",
    headers,
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
    throw new Error("Wallet does not support transaction signing. Use Phantom or Solflare.");
  }

  const signedTx = await walletAdapter.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  return signature;
}

/**
 * Sign and send a base58-encoded transaction (Lavarage format).
 */
export async function signAndSendBase58Tx(
  base58Tx: string,
  walletAdapter: any,
  connection: Connection,
): Promise<string> {
  // Decode base58 to bytes
  const decoded = bs58Decode(base58Tx);
  const tx = VersionedTransaction.deserialize(decoded);

  if (!walletAdapter.signTransaction) {
    throw new Error("Wallet does not support transaction signing. Use Phantom or Solflare.");
  }

  const signedTx = await walletAdapter.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  return signature;
}

// Simple base58 decoder (no dependency needed)
function bs58Decode(str: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = ALPHABET.indexOf(str[i]);
    if (c < 0) throw new Error(`Invalid base58 character: ${str[i]}`);
    for (let j = 0; j < bytes.length; j++) {
      c += bytes[j] * 58;
      bytes[j] = c & 0xff;
      c >>= 8;
    }
    while (c > 0) {
      bytes.push(c & 0xff);
      c >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === "1"; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ─── Utility ──────────────────────────────────────────────────────────────

export function usdcToRaw(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

export function solToRaw(amount: number): number {
  return Math.round(amount * 10 ** SOL_DECIMALS);
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
  leverage: number;          // 1.1 - 100 (Lavarage) or 1.1 - 5 (Kamino)
  targetMint: string;        // Token to long (any SPL token mint)
  slippagePercent?: number;
  solPrice?: number;
}

/**
 * Open a leveraged long position — tries Lavarage → Kamino → Spot swap.
 *
 * Strategy:
 *   1. Lavarage (if API key + pool available) — any token, true leverage
 *   2. Kamino + Jupiter swap — SOL collateral, USDC debt, swap to target
 *   3. Pure Jupiter spot swap — 1x only, no leverage
 */
export async function openLeveragePosition(params: OpenLeveragePositionParams): Promise<LeverageResult> {
  const {
    walletAddress,
    walletAdapter,
    connection,
    collateralSol,
    leverage,
    targetMint,
    slippagePercent = 1,
  } = params;

  const signatures: string[] = [];
  const steps: string[] = [];

  // ── Strategy 1: Lavarage (best — any token, true leverage) ──────────
  if (LAVARAGE_API_KEY) {
    try {
      steps.push("Trying Lavarage leveraged position…");

      // Convert SOL collateral to lamports for Lavarage
      const collateralLamports = solToRaw(collateralSol);

      // For SOL LONG with USDC quote, need to pass quoteTokenMint=USDC
      const quoteMint = targetMint === SOL_MINT ? USDC_MINT : SOL_MINT;

      const result = await lavarageOpenPosition({
        baseTokenMint: targetMint,
        quoteTokenMint: quoteMint,
        userPublicKey: walletAddress,
        collateralAmount: String(collateralLamports),
        leverage,
        side: "LONG",
        slippageBps: Math.round(slippagePercent * 100),
      });

      // Lavarage returns base58-encoded transaction
      const sig = await signAndSendBase58Tx(result.transaction, walletAdapter, connection);
      signatures.push(sig);
      steps.push(`✅ Lavarage position opened: ${sig.slice(0, 8)}…`);

      return { signatures, steps, provider: "lavarage" };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("NO_OFFER_FOR_TOKEN") || msg.includes("NO_MATCH")) {
        steps.push("No Lavarage pool for this token, trying Kamino…");
      } else if (msg.includes("API key")) {
        steps.push("Lavarage API key not configured, trying Kamino…");
      } else {
        steps.push(`Lavarage failed: ${msg.slice(0, 100)}, trying Kamino…`);
      }
    }
  } else {
    steps.push("Lavarage not configured (no API key), trying Kamino…");
  }

  // ── Strategy 2: Kamino (SOL-collateral leverage) ──
  // Kamino borrows USDC internally — the borrowed USDC stays in Kamino's reserves,
  // NOT in the user's wallet. So we can only long SOL here (not arbitrary tokens).
  // For arbitrary tokens, use Lavarage (Strategy 1) or spot swap (Strategy 3).
  //
  // Note: Kamino's openPosition tx already includes a Jupiter swap internally
  // when the target token differs from the debt token. We don't need a separate swap.
  // The `debtTokenMint` param tells Kamino what to borrow; if we pass the target
  // token as debtTokenMint, Kamino handles the swap within the position tx.
  //
  // However, Kamino only supports specific debt tokens per market (mostly USDC).
  // So for now, Kamino = long SOL with leverage (borrow USDC against SOL).
  if (targetMint === SOL_MINT && leverage > 1) {
    // Long SOL with leverage via Kamino — SOL collateral, USDC debt
    try {
      const market = KAMINO_MARKETS.main;

      // Step 2a: Try Kamino setup
      try {
        steps.push("Creating Kamino obligation…");
        const setupTx = await kaminoSetup({
          wallet: walletAddress,
          market: market.address,
          collTokenMint: SOL_MINT,
          debtTokenMint: USDC_MINT,
        });
        const setupSig = await signAndSendTransaction(setupTx, walletAdapter, connection);
        signatures.push(setupSig);
        steps.push(`✅ Obligation created: ${setupSig.slice(0, 8)}…`);
      } catch (e: any) {
        const msg = e?.message ?? "";
        if (msg.includes("already") || msg.includes("0x1") || msg.includes("already exists")) {
          steps.push("Obligation already exists, skipping setup");
        } else if (msg.includes("403") || msg.includes("rate") || msg.includes("429") || msg.includes("Forbidden")) {
          throw new Error(`RPC error during Kamino setup. Your Solana RPC may be rate-limited. Try using a private RPC (Helius, QuickNode) or retry later.\n\nDetails: ${msg}`);
        } else {
          steps.push(`Setup skipped: ${msg.slice(0, 100)}`);
        }
      }

      // Step 2b: Open Kamino leveraged SOL position
      steps.push("Opening Kamino leveraged SOL position…");
      const positionTx = await kaminoOpenPosition({
        wallet: walletAddress,
        market: market.address,
        collTokenMint: SOL_MINT,
        debtTokenMint: USDC_MINT,
        leverage,
        amount: collateralSol,
        slippage: slippagePercent,
      });
      const positionSig = await signAndSendTransaction(positionTx, walletAdapter, connection);
      signatures.push(positionSig);
      steps.push(`✅ Leveraged SOL position opened: ${positionSig.slice(0, 8)}…`);

      return { signatures, steps, provider: "kamino" };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      steps.push(`Kamino failed: ${msg.slice(0, 100)}`);
      // Fall through to spot swap
    }
  } else if (targetMint !== SOL_MINT) {
    // Can't leverage arbitrary tokens on Kamino — Lavarage needed for true leverage on memecoins
    steps.push("Kamino only supports SOL leverage. For memecoins, use Lavarage (needs API key).");
  }

  // ── Strategy 3: Pure Jupiter spot swap (1x, no leverage) ─────────
  try {
    const effectiveLeverage = leverage > 1 ? leverage : 1;
    const isLeveraged = effectiveLeverage > 1;

    if (isLeveraged) {
      steps.push(`⚠ Leverage not available for this token. Buying spot instead.`);
    }

    steps.push(`Swapping SOL → target token via Jupiter (1x spot)…`);

    const solPrice = params.solPrice ?? await getSolPrice();
    const totalUsd = collateralSol * solPrice * effectiveLeverage;
    // For spot, just swap the SOL we have
    const solLamports = solToRaw(collateralSol);

    const quote = await getJupiterQuote({
      inputMint: SOL_MINT,
      outputMint: targetMint,
      amount: solLamports,
      slippageBps: Math.round(slippagePercent * 100),
    });

    const swapTx = await getJupiterSwapTx(quote, walletAddress, Math.round(slippagePercent * 100));
    const sig = await signAndSendTransaction(swapTx, walletAdapter, connection);
    signatures.push(sig);
    steps.push(`✅ Spot swap complete: ${sig.slice(0, 8)}…`);

    if (isLeveraged) {
      steps.push(`Note: This is a 1x spot buy, not leveraged. Leverage pools not available for this token.`);
    }

    return { signatures, steps, provider: "spot" };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const error: any = new Error(`All strategies failed. Last error: ${msg}`);
    error.steps = steps;
    error.signatures = signatures;
    throw error;
  }
}