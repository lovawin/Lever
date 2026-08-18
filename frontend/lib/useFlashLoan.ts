"use client";

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId } from "wagmi";
import { arbitrum } from "wagmi/chains";

// ─── Aave v3 Pool ABI (flashLoanSimple only) ──────────────────────────

const AAVE_POOL_ABI = [
  {
    inputs: [
      { internalType: "address", name: "receiverAddress", type: "address" },
      { internalType: "address", name: "asset", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "bytes", name: "params", type: "bytes" },
      { internalType: "uint16", name: "referralCode", type: "uint16" },
    ],
    name: "flashLoanSimple",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Aave v3 Pool address on Arbitrum
const AAVE_V3_POOL_ARBITRUM = "0x794a61358D6845594F94dc1DB02A252b5b4814aD" as `0x${string}`;

// USDC on Arbitrum
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`;

// FlashLoanReceiver on Arbitrum
const FLASH_LOAN_RECEIVER = "0x9bb98Fd8f3Dc52D09190c18243a8D7E650B0bCc3" as `0x${string}`;

// ─── Strategy IDs ────────────────────────────────────────────────────────

export type FlashLoanStrategy = "arbitrage" | "self_liquidation" | "leverage_loop";

const STRATEGY_IDS: Record<FlashLoanStrategy, number> = {
  arbitrage: 1,
  self_liquidation: 2,
  leverage_loop: 3,
};

// ─── Hook ─────────────────────────────────────────────────────────────────

export type FlashLoanTxState = "idle" | "pending" | "confirming" | "success" | "error";

export interface UseFlashLoanReturn {
  execute: () => void;
  txState: FlashLoanTxState;
  txHash: `0x${string}` | undefined;
  error: string | null;
  reset: () => void;
}

export function useFlashLoan(
  strategy: FlashLoanStrategy,
  amountUsd: number,
  leverage: number = 5
): UseFlashLoanReturn {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();

  // Safe numeric values
  const safeAmount = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 10;
  const safeLeverage = Number.isFinite(leverage) && leverage >= 2 ? leverage : 2;
  const borrowAmount = strategy === "leverage_loop"
    ? BigInt(Math.floor(safeAmount * (safeLeverage - 1) * 1e6))
    : BigInt(Math.floor(safeAmount * 1e6));

  const [manualError, setManualError] = useState<string | null>(null);

  const {
    writeContract,
    data: txHash,
    error: writeError,
    reset: resetWrite,
    isPending: isWritePending,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const execute = useCallback(() => {
    try {
      if (!isConnected || !address) {
        setManualError("Connect your EVM wallet first");
        return;
      }

      if (chainId !== arbitrum.id) {
        setManualError("Switch to Arbitrum network");
        return;
      }

      if (safeAmount < 10) {
        setManualError("Minimum amount is $10");
        return;
      }

      setManualError(null);

      // Encode params
      const strategyId = STRATEGY_IDS[strategy];
      const userAddr = (address || "0x0000000000000000000000000000000000000000") as `0x${string}`;

      let params: `0x${string}`;
      if (strategy === "arbitrage") {
        const WETH_ARB = "0x82aF49447D8a07e3bd95BD0d56f35241523fB251" as `0x${string}`;
        const inner = abiEncodeArbitrage(WETH_ARB, 500, 0n);
        params = `0x${strategyId.toString(16).padStart(2, "0")}${inner.slice(2)}` as `0x${string}`;
      } else if (strategy === "self_liquidation") {
        const closeFee = BigInt(Math.floor(safeAmount * 0.01 * 1e6));
        const profitFee = BigInt(Math.floor(safeAmount * 0.005 * 1e6));
        const marginReturn = BigInt(Math.floor(safeAmount * 1e6));
        const inner = abiEncodeSelfLiquidation(0n, closeFee, profitFee, 0n, marginReturn);
        params = `0x${strategyId.toString(16).padStart(2, "0")}${inner.slice(2)}` as `0x${string}`;
      } else {
        const depositAmount = BigInt(Math.floor(safeAmount * 1e6));
        const leverageBps = BigInt(safeLeverage * 100);
        const inner = abiEncodeLeverageLoop(userAddr, depositAmount, leverageBps);
        params = `0x${strategyId.toString(16).padStart(2, "0")}${inner.slice(2)}` as `0x${string}`;
      }

      writeContract({
        address: AAVE_V3_POOL_ARBITRUM,
        abi: AAVE_POOL_ABI,
        functionName: "flashLoanSimple",
        args: [
          FLASH_LOAN_RECEIVER,    // receiverAddress (our FlashLoanReceiver contract)
          USDC_ARBITRUM,          // asset (USDC)
          borrowAmount,           // amount
          params,                 // params (encoded strategy)
          0,                      // referralCode
        ],
      });
    } catch (err: any) {
      setManualError(err?.message || "Unknown error executing flash loan");
    }
  }, [isConnected, address, chainId, strategy, safeAmount, safeLeverage, borrowAmount, writeContract]);

  const reset = useCallback(() => {
    resetWrite();
    setManualError(null);
  }, [resetWrite]);

  // Derive state
  let txState: FlashLoanTxState = "idle";
  let error: string | null = manualError;

  if (isWritePending) {
    txState = "pending";
  } else if (isConfirming) {
    txState = "confirming";
  } else if (isSuccess) {
    txState = "success";
  }

  if (writeError) {
    txState = "error";
    error = writeError.message || "Transaction failed";
  } else if (confirmError) {
    txState = "error";
    error = confirmError.message || "Confirmation failed";
  }

  return { execute, txState, txHash, error, reset };
}

// ─── ABI encoding helpers ─────────────────────────────────────────────────

function abiEncodeArbitrage(buyToken: `0x${string}`, poolFee: number, minProfit: bigint): `0x${string}` {
  const padded = (val: bigint, bytes: number) => val.toString(16).padStart(bytes * 2, "0");
  const addr = buyToken.toLowerCase().slice(2).padStart(64, "0");
  const fee = padded(BigInt(poolFee), 4).padStart(64, "0");
  const profit = padded(minProfit, 32);
  return `0x${addr}${fee}${profit}` as `0x${string}`;
}

function abiEncodeSelfLiquidation(
  positionId: bigint, closeFee: bigint, profitFee: bigint, pnl: bigint, marginReturn: bigint
): `0x${string}` {
  const padded = (val: bigint, bytes: number) => val.toString(16).padStart(bytes * 2, "0");
  const posId = padded(positionId, 32);
  const cf = padded(closeFee, 32);
  const pf = padded(profitFee, 32);
  const p = padded(pnl < 0n ? (BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") + 1n + pnl) : pnl, 32);
  const mr = padded(marginReturn, 32);
  return `0x${posId}${cf}${pf}${p}${mr}` as `0x${string}`;
}

function abiEncodeLeverageLoop(userAddress: `0x${string}`, depositAmount: bigint, leverageBps: bigint): `0x${string}` {
  const padded = (val: bigint, bytes: number) => val.toString(16).padStart(bytes * 2, "0");
  const addr = userAddress.toLowerCase().slice(2).padStart(64, "0");
  const da = padded(depositAmount, 32);
  const lb = padded(leverageBps, 32);
  return `0x${addr}${da}${lb}` as `0x${string}`;
}