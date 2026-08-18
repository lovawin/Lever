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

// Arbitrum USDC
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`;
const USDC_DECIMALS = 6;

// Vault address from env
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xd3c9babcedf20f954ad1c2f1e16e82839c1941aa") as `0x${string}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export type VaultStatus = {
  connected: boolean;
  vaultAddress: string;
  isArbitrum: boolean;
  wrongNetwork: boolean;
};

export type VaultBalances = {
  vaultBalance: number;   // USDC in vault
  walletBalance: number;  // USDC in wallet
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
      const [vaultBal, walletBal, allowance, solvent, paused] = await Promise.all([
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
      const allowanceVal = Number(formatUnits(allowance as bigint, USDC_DECIMALS));

      setBalances({
        vaultBalance,
        walletBalance,
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
  };
}