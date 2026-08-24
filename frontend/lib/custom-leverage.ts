/**
 * Custom Leverage Engine — Kamino + Jupiter swap for ANY Solana memecoin.
 *
 * Strategy:
 *   1. Kamino setup — create obligation account (SOL collateral, USDC debt)
 *   2. Kamino openPosition — borrow USDC against SOL with leverage
 *   3. Jupiter swap — swap borrowed USDC → target memecoin token
 *
 * This bypasses Lavarage entirely. Works on any token with a Jupiter liquidity pool.
 * The user gets a leveraged long on any memecoin using SOL as collateral.
 *
 * Flow:
 *   User provides SOL collateral + leverage multiplier + target token mint
 *   → Kamino borrows USDC against the SOL (leverage - 1) × collateral
 *   → Jupiter swaps the borrowed USDC into the target token
 *   → User now holds the target token with leverage on their SOL
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  kaminoSetup,
  kaminoOpenPosition,
  getJupiterQuote,
  getJupiterSwapTx,
  signAndSendTransaction,
  getSolPrice,
  usdcToRaw,
  solToRaw,
  USDC_MINT,
  SOL_MINT,
  KAMINO_MARKETS,
  type LeverageResult,
} from "./leverage";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CustomLeverageParams {
  walletAddress: string;
  walletAdapter: any;
  connection: Connection;
  collateralSol: number;   // SOL amount to deposit (e.g. 0.5)
  leverage: number;         // 2x – 10x
  targetMint: string;       // Any SPL token mint (the memecoin to long)
  slippagePercent?: number; // default 1%
  solPrice?: number;
}

export interface CustomLeverageEstimate {
  collateralUsd: number;
  borrowUsd: number;
  positionSizeUsd: number;
  leverage: number;
  liquidationDropPct: number;
  estimatedTokens: number;   // estimated target tokens to receive
  solPrice: number;
}

// ─── Estimate ──────────────────────────────────────────────────────────────

/**
 * Calculate estimated position metrics for the custom leverage flow.
 * borrowUsd = collateralUsd × (leverage - 1)
 * positionSizeUsd = collateralUsd × leverage (total exposure)
 * liquidationDropPct = (1 / leverage) × 100 — if SOL drops this %, liquidation
 */
export function estimateCustomLeverage(
  collateralSol: number,
  leverage: number,
  solPrice: number,
  tokenPriceUsd?: number,
): CustomLeverageEstimate {
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

// ─── Main Flow ─────────────────────────────────────────────────────────────

/**
 * Open a custom leveraged long position on ANY Solana token.
 *
 * Steps:
 *   1. Kamino setup — create obligation (SOL collateral, USDC debt)
 *   2. Kamino openPosition — borrow USDC against SOL with leverage
 *   3. Jupiter swap — swap borrowed USDC → target memecoin
 *
 * Each step produces a transaction that the user signs with their wallet.
 * Returns signatures array + human-readable steps array.
 */
export async function openCustomLeveragePosition(
  params: CustomLeverageParams,
): Promise<LeverageResult> {
  const {
    walletAddress,
    walletAdapter,
    connection,
    collateralSol,
    leverage,
    targetMint,
    slippagePercent = 1,
  } = params;

  if (!walletAddress) {
    throw new Error("Solana wallet not connected. Connect Phantom or Solflare first.");
  }
  if (!walletAdapter?.signTransaction) {
    throw new Error("Wallet does not support transaction signing. Use Phantom or Solflare.");
  }
  if (collateralSol <= 0) {
    throw new Error("Collateral amount must be greater than 0.");
  }
  if (leverage < 1.1 || leverage > 10) {
    throw new Error("Leverage must be between 1.1x and 10x.");
  }
  if (targetMint === SOL_MINT) {
    throw new Error("Target token cannot be SOL. Use the Kamino leverage flow for SOL.");
  }

  const signatures: string[] = [];
  const steps: string[] = [];
  const market = KAMINO_MARKETS.main; // SOL/BTC market — supports SOL collateral + USDC debt

  // ── Step 1: Kamino Setup (create obligation) ────────────────────────
  steps.push("Step 1/3: Creating Kamino obligation (SOL collateral / USDC debt)…");
  try {
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
    if (
      msg.includes("already") ||
      msg.includes("0x1") ||
      msg.includes("already exists") ||
      msg.includes("AccountNotFound") ||
      msg.includes("custom program error: 0x1")
    ) {
      steps.push("ℹ Obligation already exists, skipping setup");
    } else if (
      msg.includes("403") ||
      msg.includes("rate") ||
      msg.includes("429") ||
      msg.includes("Forbidden")
    ) {
      throw new Error(
        `RPC rate-limited during Kamino setup. Use a private RPC (Helius/QuickNode) or retry.\n\nDetails: ${msg}`,
      );
    } else {
      // Setup failed for unknown reason — throw instead of continuing
      throw new Error(`Kamino setup failed: ${msg}`);
    }
  }

  // ── Step 2: Kamino Open Position (borrow USDC against SOL) ─────────
  steps.push("Step 2/3: Opening Kamino leveraged position (borrowing USDC)…");
  let positionSig: string;
  try {
    const positionTx = await kaminoOpenPosition({
      wallet: walletAddress,
      market: market.address,
      collTokenMint: SOL_MINT,
      debtTokenMint: USDC_MINT,
      leverage,
      amount: collateralSol,
      slippage: slippagePercent,
    });
    positionSig = await signAndSendTransaction(positionTx, walletAdapter, connection);
    signatures.push(positionSig);
    steps.push(`✅ Leveraged position opened: ${positionSig.slice(0, 8)}…`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const error: any = new Error(`Kamino position failed: ${msg}`);
    error.steps = steps;
    error.signatures = signatures;
    throw error;
  }

  // ── Step 3: Jupiter Swap (borrowed USDC → target memecoin) ─────────
  steps.push("Step 3/3: Swapping borrowed USDC → target token via Jupiter…");

  // Calculate how much USDC was borrowed
  const solPrice = params.solPrice ?? (await getSolPrice());
  const collateralUsd = collateralSol * solPrice;
  const borrowUsd = collateralUsd * (leverage - 1);
  const borrowUsdcRaw = usdcToRaw(borrowUsd);

  try {
    const quote = await getJupiterQuote({
      inputMint: USDC_MINT,
      outputMint: targetMint,
      amount: borrowUsdcRaw,
      slippageBps: Math.round(slippagePercent * 100),
    });

    const swapTx = await getJupiterSwapTx(quote, walletAddress, Math.round(slippagePercent * 100));
    const swapSig = await signAndSendTransaction(swapTx, walletAdapter, connection);
    signatures.push(swapSig);
    steps.push(`✅ Swap complete: ${swapSig.slice(0, 8)}…`);
    steps.push(`Position opened! Borrowed ${borrowUsd.toFixed(2)} USDC → swapped to target token.`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // The leverage position is already open — the swap is the last step
    steps.push(`⚠ Swap failed: ${msg.slice(0, 120)}`);
    steps.push(
      `Position is open but USDC was NOT swapped to target token. ` +
      `You can manually swap the borrowed USDC via Jupiter.`,
    );
    // Return partial success — position is open, swap failed
    return { signatures, steps, provider: "kamino" };
  }

  return { signatures, steps, provider: "kamino" };
}