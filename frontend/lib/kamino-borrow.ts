/**
 * Kamino Borrow + Jupiter Swap — Leverage ANY Solana token.
 *
 * Flow:
 *   1. Deposit SOL as collateral into Kamino lending market
 *   2. Borrow USDC against the SOL collateral
 *   3. Jupiter swap borrowed USDC → any meme coin (any token, any pair)
 *
 * No Lavarage. No Dialect API. No API keys.
 * Uses Kamino REST API (api.kamino.finance) for deposit/borrow tx building.
 * Uses Jupiter for the swap.
 */

import {
  Connection,
  VersionedTransaction,
  Transaction,
  PublicKey,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

const KAMINO_API = "/api/kamino";
// Kamino Main Market (verified against Kamino docs / klend-sdk — this is the
// real "Main Market" address, NOT the Bonk isolated market).
const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
// SOL reserve on the Main Market (verified: kamino.com/borrow/reserve/<market>/<reserve>).
const KAMINO_SOL_RESERVE = "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q";

const JUPITER_SWAP_API = "https://lite-api.jup.ag/swap/v1";
const JUPITER_API_KEY = process.env.NEXT_PUBLIC_JUPITER_API_KEY || "";

const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

// ─── Abort Helper ─────────────────────────────────────────────────────────

function abortWithTimeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface BorrowLeverageParams {
  walletAddress: string;
  walletAdapter: any;
  connection: Connection;
  collateralSol: number;    // SOL amount to deposit (e.g. 0.5)
  leverage: number;          // 2x – 10x
  targetMint: string;        // Any SPL token mint (the memecoin to long)
  slippagePercent?: number;  // default 1%
  solPrice?: number;
}

export interface BorrowLeverageResult {
  signatures: string[];
  steps: string[];
  provider: string;
  borrowAmountUsdc: number;
  swapOutAmount: string;
}

// ─── Kamino REST API ──────────────────────────────────────────────────────

/**
 * Build a deposit transaction via Kamino REST API.
 * Returns base64-encoded transaction.
 */
export async function kaminoDepositTx(
  wallet: string,
  amountSol: number,
): Promise<string> {
  const res = await fetch(`${KAMINO_API}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet,
      market: KAMINO_MAIN_MARKET,
      reserve: KAMINO_SOL_RESERVE,
      amount: amountSol.toString(),
    }),
    signal: abortWithTimeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kamino deposit API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.transaction;
}

/**
 * Build a borrow transaction via Kamino REST API.
 * Returns base64-encoded transaction.
 */
export async function kaminoBorrowTx(
  wallet: string,
  amountUsdc: number,
): Promise<string> {
  // Find the USDC reserve in the main market
  const usdcReserve = await findUsdcReserve();

  const res = await fetch(`${KAMINO_API}/borrow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet,
      market: KAMINO_MAIN_MARKET,
      reserve: usdcReserve,
      amount: amountUsdc.toString(),
    }),
    signal: abortWithTimeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kamino borrow API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.transaction;
}

/**
 * Find the USDC reserve address in the Kamino main market.
 */
let cachedUsdcReserve: string | null = null;

async function findUsdcReserve(): Promise<string> {
  if (cachedUsdcReserve) return cachedUsdcReserve;

  const res = await fetch(`${KAMINO_API}/reserves?market=${KAMINO_MAIN_MARKET}`, {
    signal: abortWithTimeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to look up Kamino USDC reserve (${res.status}): ${err}`);
  }

  const data = await res.json();
  const reserves = data.reserves ?? data ?? [];

  // Find the USDC reserve with the most available liquidity
  let bestReserve: string | null = null;
  let bestAvailable = -1;
  for (const r of reserves) {
    const mint = r.liquidity?.mint ?? r.mint ?? r.liquidityTokenMint;
    if (mint && mint.toLowerCase() === USDC_MINT.toLowerCase()) {
      const address = r.address ?? r.pubkey ?? r.reserve;
      if (!address) continue;
      const supply = parseFloat(r.totalSupplyUsd ?? "0");
      const borrow = parseFloat(r.totalBorrowUsd ?? "0");
      const available = supply - borrow;
      if (available > bestAvailable) {
        bestAvailable = available;
        bestReserve = address;
      }
    }
  }
  if (bestReserve) {
    cachedUsdcReserve = bestReserve;
    return bestReserve;
  }

  throw new Error("Could not find a USDC reserve on the Kamino main market. Try again shortly.");
}

// ─── Jupiter Swap ──────────────────────────────────────────────────────────

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
}): Promise<any> {
  const url = new URL(`${JUPITER_SWAP_API}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amount));
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 100));

  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) headers["x-api-key"] = JUPITER_API_KEY;

  const r = await fetch(url.toString(), { headers, signal: abortWithTimeout(10000) });
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
    signal: abortWithTimeout(10000),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Jupiter swap failed (${r.status}): ${err}`);
  }

  const data = await r.json();
  return data.swapTransaction;
}

// ─── Sign & Send Helper ────────────────────────────────────────────────────

async function signAndSend(
  base64Tx: string,
  walletAdapter: any,
  connection: Connection,
): Promise<string> {
  const txBuf = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(txBuf);

  if (!walletAdapter.signTransaction) {
    throw new Error("Wallet does not support transaction signing. Use Phantom or Solflare.");
  }

  // Get fresh blockhash right before signing
  const latestBlockhash = await connection.getLatestBlockhash();
  // @ts-ignore
  tx.message.recentBlockhash = latestBlockhash.blockhash;

  const signedTx = await walletAdapter.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  return signature;
}

// ─── SOL Price Helper ──────────────────────────────────────────────────────

async function getSolPrice(): Promise<number> {
  try {
    const r = await fetch("https://lite-api.jup.ag/price/v2?tokens=So11111111111111111111111111111111111111112", {
      signal: abortWithTimeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      const price = data?.data?.[SOL_MINT]?.price;
      if (price && parseFloat(price) > 0) return parseFloat(price);
    }
  } catch { /* ignore */ }

  // Fallback to DexScreener
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/search?q=SOL", {
      signal: abortWithTimeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      const pairs = data.pairs ?? [];
      for (const p of pairs) {
        if (p.chainId === "solana" && p.baseToken?.symbol === "SOL" && parseFloat(p.priceUsd ?? "0") > 0) {
          return parseFloat(p.priceUsd);
        }
      }
    }
  } catch { /* ignore */ }

  return 175; // hardcoded fallback
}

// ─── Main Flow ─────────────────────────────────────────────────────────────

/**
 * Open a leveraged long position on ANY Solana token.
 *
 * Steps:
 *   1. Deposit SOL as collateral into Kamino
 *   2. Borrow USDC against the SOL
 *   3. Jupiter swap borrowed USDC → target memecoin
 *
 * No Lavarage. No Dialect API. No API keys.
 * Works on ANY token with Jupiter liquidity.
 */
export async function openBorrowLeveragePosition(
  params: BorrowLeverageParams,
): Promise<BorrowLeverageResult> {
  const {
    walletAddress,
    walletAdapter,
    connection,
    collateralSol,
    leverage,
    targetMint,
    slippagePercent = 1,
  } = params;

  if (!walletAddress) throw new Error("Solana wallet not connected.");
  if (!walletAdapter?.signTransaction) throw new Error("Wallet does not support signing. Use Phantom or Solflare.");
  if (collateralSol <= 0) throw new Error("Collateral must be greater than 0.");
  if (leverage < 1.1 || leverage > 10) throw new Error("Leverage must be between 1.1x and 10x.");
  if (targetMint === SOL_MINT) throw new Error("Target cannot be SOL. Just buy SOL directly.");

  const signatures: string[] = [];
  const steps: string[] = [];
  const slippageBps = Math.round(slippagePercent * 100);

  // Calculate borrow amount
  const solPrice = params.solPrice ?? (await getSolPrice());
  const collateralUsd = collateralSol * solPrice;
  const borrowUsd = collateralUsd * (leverage - 1);
  const borrowUsdcRaw = Math.round(borrowUsd * 10 ** USDC_DECIMALS);

  steps.push(`Collateral: ${collateralSol} SOL ($${collateralUsd.toFixed(2)})`);
  steps.push(`Borrowing: $${borrowUsd.toFixed(2)} USDC (${leverage}x leverage)`);

  // ── Step 1: Deposit SOL into Kamino ────────────────────────────────
  steps.push("Step 1/3: Depositing SOL collateral into Kamino…");
  try {
    const depositTx = await kaminoDepositTx(walletAddress, collateralSol);
    const depositSig = await signAndSend(depositTx, walletAdapter, connection);
    signatures.push(depositSig);
    steps.push(`✅ SOL deposited: ${depositSig.slice(0, 8)}…`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes("already") || msg.includes("0x1") || msg.includes("exists")) {
      steps.push("ℹ Obligation already exists, skipping deposit");
    } else {
      throw new Error(`Deposit failed: ${msg}`);
    }
  }

  // ── Step 2: Borrow USDC from Kamino ────────────────────────────────
  steps.push("Step 2/3: Borrowing USDC from Kamino…");
  try {
    const borrowTx = await kaminoBorrowTx(walletAddress, borrowUsd);
    const borrowSig = await signAndSend(borrowTx, walletAdapter, connection);
    signatures.push(borrowSig);
    steps.push(`✅ Borrowed $${borrowUsd.toFixed(2)} USDC: ${borrowSig.slice(0, 8)}…`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const err: any = new Error(`Borrow failed: ${msg}`);
    err.steps = steps;
    err.signatures = signatures;
    throw err;
  }

  // ── Step 3: Jupiter swap USDC → target memecoin ────────────────────
  steps.push("Step 3/3: Swapping borrowed USDC → target token via Jupiter…");
  let swapOutAmount = "0";
  try {
    const quote = await getJupiterQuote({
      inputMint: USDC_MINT,
      outputMint: targetMint,
      amount: borrowUsdcRaw,
      slippageBps,
    });

    swapOutAmount = quote.outAmount ?? "0";

    const swapTx = await getJupiterSwapTx(quote, walletAddress, slippageBps);
    const swapSig = await signAndSend(swapTx, walletAdapter, connection);
    signatures.push(swapSig);
    steps.push(`✅ Swap complete: ${swapSig.slice(0, 8)}…`);
    steps.push(`Position opened! Borrowed $${borrowUsd.toFixed(2)} USDC → swapped to target token.`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    steps.push(`⚠ Swap failed: ${msg.slice(0, 120)}`);
    steps.push(`Position is open with borrowed USDC. You can manually swap via Jupiter.`);
    return { signatures, steps, provider: "kamino-borrow", borrowAmountUsdc: borrowUsd, swapOutAmount };
  }

  return { signatures, steps, provider: "kamino-borrow", borrowAmountUsdc: borrowUsd, swapOutAmount };
}

// ─── Estimate ──────────────────────────────────────────────────────────────

export function estimateBorrowLeverage(
  collateralSol: number,
  leverage: number,
  solPrice: number,
  tokenPriceUsd?: number,
) {
  const collateralUsd = collateralSol * solPrice;
  const borrowUsd = collateralUsd * (leverage - 1);
  const positionSizeUsd = collateralUsd * leverage;
  const liquidationDropPct = (1 / leverage) * 100;
  const estimatedTokens = tokenPriceUsd && tokenPriceUsd > 0
    ? positionSizeUsd / tokenPriceUsd
    : 0;

  return {
    collateralUsd,
    borrowUsd,
    positionSizeUsd,
    leverage,
    liquidationDropPct,
    estimatedTokens,
    solPrice,
  };
}

// ─── Fetch User Obligations ────────────────────────────────────────────────

export interface KaminoObligation {
  obligationAddress: string;
  deposits: {
    depositReserve: string;
    depositedAmount: string;
    marketValueSf: string;
  }[];
  borrows: {
    borrowReserve: string;
    borrowedAmountSf: string;
    marketValueSf: string;
  }[];
  healthFactor: number;
  borrowedValueUsd: number;
  collateralValueUsd: number;
}

export async function getUserObligations(
  walletAddress: string,
): Promise<KaminoObligation[]> {
  const res = await fetch(
    `${KAMINO_API}/obligations?market=${KAMINO_MAIN_MARKET}&wallet=${walletAddress}`,
    { signal: abortWithTimeout(10000) },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch obligations (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((o: any) => {
    const stats = o.refreshedStats ?? {};
    const userTotalBorrow = parseFloat(stats.userTotalBorrow ?? "0");
    const borrowLiquidationLimit = parseFloat(stats.borrowLiquidationLimit ?? "0");
    return {
      obligationAddress: o.obligationAddress,
      deposits: (o.state?.deposits ?? []).filter((d: any) => d.depositedAmount !== "0"),
      borrows: (o.state?.borrows ?? []).filter((b: any) => b.borrowedAmountSf !== "0"),
      healthFactor: userTotalBorrow > 0 ? borrowLiquidationLimit / userTotalBorrow : 999,
      borrowedValueUsd: userTotalBorrow,
      collateralValueUsd: parseFloat(stats.userTotalCollateralDeposit ?? "0"),
    };
  });
}
