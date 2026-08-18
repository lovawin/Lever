/**
 * LeverVault contract hooks for deposit/withdraw/allowance.
 *
 * Users interact with the vault contract directly on Arbitrum:
 * 1. Approve USDC spending to vault
 * 2. Call deposit() on vault
 * 3. Call withdraw() or withdrawAll() or emergencyWithdraw()
 *
 * The backend reads balances from the contract — no backend call needed for deposits.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient, useChainId } from "wagmi";
import { arbitrum } from "wagmi/chains";
import { parseUnits, formatUnits, type Hash } from "viem";

// ─── Vault ABI (only what the frontend needs) ───────────────────────────────

const VAULT_ABI = [
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "emergencyWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "balances",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalDeposits",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isSolvent",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Withdrawn",
    type: "event",
  },
] as const;

// ─── USDC ABI (approve + balanceOf) ────────────────────────────────────────

const USDC_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Arbitrum USDC (native)
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`;
// Arbitrum USDC.e (bridged)
const USDC_BRIDGED = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8" as `0x${string}`;
const USDC_DECIMALS = 6;

// Vault address from env
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xe7ed6455fc473bba35ee573d20e8c3e80d7c6801") as `0x${string}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export type VaultStatus = {
  connected: boolean;
  vaultAddress: string;
  isArbitrum: boolean;
  wrongNetwork: boolean;
};

export type VaultBalances = {
  vaultBalance: number;   // USDC in vault
  walletBalance: number;  // USDC in wallet (native)
  bridgedBalance: number; // USDC.e in wallet (bridged)
  allowance: number;      // USDC approved for vault
  needsApproval: boolean; // true if allowance < deposit amount
  isSolvent: boolean;
  isPaused: boolean;
};

export type TxState = "idle" | "pending" | "confirming" | "success" | "error";

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useVault() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [balances, setBalances] = useState<VaultBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isArbitrum = chainId === arbitrum.id;
  const wrongNetwork = isConnected && !isArbitrum;
  const vaultReady = !!VAULT_ADDRESS && isArbitrum;

  // Read vault balances
  const refreshBalances = useCallback(async () => {
    if (!address || !publicClient || !vaultReady) return;

    setLoading(true);
    try {
      const [vaultBal, walletBal, bridgedBal, allowance, solvent, paused] = await Promise.all([
        publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "balances",
          args: [address],
        }),
        publicClient.readContract({
          address: USDC_ARB,
          abi: USDC_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: USDC_BRIDGED,
          abi: USDC_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.readContract({
          address: USDC_ARB,
          abi: USDC_ABI,
          functionName: "allowance",
          args: [address, VAULT_ADDRESS],
        }),
        publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "isSolvent",
        }),
        publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "paused",
        }),
      ]);

      const vaultBalance = Number(formatUnits(vaultBal as bigint, USDC_DECIMALS));
      const walletBalance = Number(formatUnits(walletBal as bigint, USDC_DECIMALS));
      const bridgedBalance = Number(formatUnits(bridgedBal as bigint, USDC_DECIMALS));
      const allowanceVal = Number(formatUnits(allowance as bigint, USDC_DECIMALS));

      setBalances({
        vaultBalance,
        walletBalance,
        bridgedBalance,
        allowance: allowanceVal,
        needsApproval: allowanceVal < walletBalance,
        isSolvent: solvent as boolean,
        isPaused: paused as boolean,
      });
    } catch (err: any) {
      console.error("Failed to read vault balances:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [address, publicClient, vaultReady]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!vaultReady || !address) return;
    refreshBalances();
    const iv = setInterval(refreshBalances, 15_000);
    return () => clearInterval(iv);
  }, [vaultReady, address, refreshBalances]);

  // Approve USDC for vault
  const approve = useCallback(async (amount?: number) => {
    if (!walletClient || !address || !vaultReady) return;

    setTxState("pending");
    setError(null);
    try {
      const approveAmount = amount
        ? parseUnits(amount.toString(), USDC_DECIMALS)
        : parseUnits("1000000", USDC_DECIMALS); // approve max for convenience

      const hash = await walletClient.writeContract({
        address: USDC_ARB,
        abi: USDC_ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, approveAmount],
      });

      setTxHash(hash);
      setTxState("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        setTxState("success");
        await refreshBalances();
      } else {
        setTxState("error");
        setError("Approval transaction reverted on-chain");
      }
    } catch (err: any) {
      setTxState("error");
      setError(err.shortMessage || err.message);
    }
  }, [walletClient, address, vaultReady, refreshBalances]);

  // Deposit USDC into vault
  const deposit = useCallback(async (amount: number) => {
    if (!walletClient || !address || !vaultReady) return;

    setTxState("pending");
    setError(null);
    try {
      const amountRaw = parseUnits(amount.toString(), USDC_DECIMALS);

      // Check allowance first
      const currentAllowance = await publicClient!.readContract({
        address: USDC_ARB,
        abi: USDC_ABI,
        functionName: "allowance",
        args: [address, VAULT_ADDRESS],
      }) as bigint;

      if (currentAllowance < amountRaw) {
        // Need to approve first
        const approveHash = await walletClient.writeContract({
          address: USDC_ARB,
          abi: USDC_ABI,
          functionName: "approve",
          args: [VAULT_ADDRESS, amountRaw],
        });
        setTxHash(approveHash);
        setTxState("confirming");
        const approveReceipt = await publicClient!.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") {
          setTxState("error");
          setError("Approval failed on-chain");
          return;
        }
      }

      // Now deposit
      const depositHash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "deposit",
        args: [amountRaw],
      });

      setTxHash(depositHash);
      setTxState("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({ hash: depositHash });
      if (receipt.status === "success") {
        setTxState("success");
        await refreshBalances();
      } else {
        setTxState("error");
        setError("Deposit transaction reverted on-chain");
      }
    } catch (err: any) {
      setTxState("error");
      setError(err.shortMessage || err.message);
    }
  }, [walletClient, address, vaultReady, refreshBalances]);

  // Withdraw USDC from vault
  const withdraw = useCallback(async (amount: number) => {
    if (!walletClient || !address || !vaultReady) return;

    setTxState("pending");
    setError(null);
    try {
      const amountRaw = parseUnits(amount.toString(), USDC_DECIMALS);

      const hash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "withdraw",
        args: [amountRaw],
      });

      setTxHash(hash);
      setTxState("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        setTxState("success");
        await refreshBalances();
      } else {
        setTxState("error");
        setError("Withdrawal transaction reverted on-chain");
      }
    } catch (err: any) {
      setTxState("error");
      setError(err.shortMessage || err.message);
    }
  }, [walletClient, address, vaultReady, refreshBalances]);

  // Withdraw all USDC from vault
  const withdrawAll = useCallback(async () => {
    if (!walletClient || !address || !vaultReady) return;

    setTxState("pending");
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "withdrawAll",
      });

      setTxHash(hash);
      setTxState("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        setTxState("success");
        await refreshBalances();
      } else {
        setTxState("error");
        setError("Withdrawal transaction reverted on-chain");
      }
    } catch (err: any) {
      setTxState("error");
      setError(err.shortMessage || err.message);
    }
  }, [walletClient, address, vaultReady, refreshBalances]);

  // Emergency withdraw (works even when paused)
  const emergencyWithdraw = useCallback(async () => {
    if (!walletClient || !address || !vaultReady) return;

    setTxState("pending");
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "emergencyWithdraw",
      });

      setTxHash(hash);
      setTxState("confirming");

      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        setTxState("success");
        await refreshBalances();
      } else {
        setTxState("error");
        setError("Emergency withdrawal reverted on-chain");
      }
    } catch (err: any) {
      setTxState("error");
      setError(err.shortMessage || err.message);
    }
  }, [walletClient, address, vaultReady, refreshBalances]);

  const resetTx = useCallback(() => {
    setTxState("idle");
    setTxHash(null);
    setError(null);
  }, []);

  // ─── Swap bridged USDC.e to native USDC ─────────────────────────────────
  const swapBridgedToNative = useCallback(async (amount?: number) => {
    if (!walletClient || !address || !publicClient) return;
    const swapAmount = amount ?? (balances?.bridgedBalance ?? 0);
    if (swapAmount <= 0) return;
    const amountIn = parseUnits(swapAmount.toString(), USDC_DECIMALS);

    setTxState("pending");
    setTxHash(null);
    setError(null);

    try {
      // 1. Approve router to spend bridged USDC
      const ROUTER = "0x68b3465833Fb72a70EC138488f5723cE294c6D30" as `0x${string}`;
      const { request: approveReq } = await publicClient.simulateContract({
        address: USDC_BRIDGED,
        abi: USDC_ABI,
        functionName: "approve",
        args: [ROUTER, amountIn],
        account: address,
      });
      const approveHash = await walletClient.writeContract(approveReq);
      setTxHash(approveHash);
      setTxState("confirming");
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // 2. Swap via Uniswap V3 (0.01% fee pool)
      const SWAP_ABI = [
        {
          inputs: [{ name: "params", type: "tuple", components: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "recipient", type: "address" },
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMinimum", type: "uint256" },
            { name: "sqrtPriceLimitX96", type: "uint160" },
          ]}],
          name: "exactInputSingle",
          outputs: [{ name: "amountOut", type: "uint256" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ] as const;

      // 0.5% slippage tolerance
      const minOut = amountIn * 995n / 1000n;

      const { request: swapReq } = await publicClient.simulateContract({
        address: ROUTER,
        abi: SWAP_ABI,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: USDC_BRIDGED,
          tokenOut: USDC_ARB,
          fee: 100,
          recipient: address,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        }],
        account: address,
      });
      const swapHash = await walletClient.writeContract(swapReq);
      setTxHash(swapHash);
      setTxState("confirming");
      await publicClient.waitForTransactionReceipt({ hash: swapHash });

      setTxState("success");
      refreshBalances();
    } catch (err: any) {
      console.error("Swap failed:", err);
      setError(err?.shortMessage || err?.message || "Swap failed");
      setTxState("error");
    }
  }, [walletClient, address, publicClient, balances?.bridgedBalance]);

  return {
    // State
    address,
    isConnected,
    isArbitrum,
    wrongNetwork,
    vaultReady,
    vaultAddress: VAULT_ADDRESS,
    balances,
    loading,
    txState,
    txHash,
    error,

    // Actions
    refreshBalances,
    approve,
    deposit,
    withdraw,
    withdrawAll,
    emergencyWithdraw,
    resetTx,
    swapBridgedToNative,
  };
}