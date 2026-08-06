"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { arbitrum } from "wagmi/chains";
import { useSwitchChain } from "wagmi";
import { useVault, type TxState } from "@/lib/useVault";
import {
  getBalance,
  requestWithdrawal,
  getAuthToken,
  type BalanceInfo,
} from "@/lib/api";

type Tab = "balance" | "deposit" | "withdraw";

export default function WalletPanel() {
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const vault = useVault();
  const token = getAuthToken();

  const [tab, setTab] = useState<Tab>("balance");
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [fallbackBalance, setFallbackBalance] = useState<BalanceInfo | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  // Use vault balance if vault is ready, otherwise fallback to API
  const isVaultMode = vault.vaultReady;
  const balance = isVaultMode
    ? {
        address: address || "",
        asset: "USDC",
        available: vault.balances?.vaultBalance ?? 0,
        locked: 0,
        total: vault.balances?.vaultBalance ?? 0,
        fee_tier: "free" as const,
      }
    : fallbackBalance;

  // Fetch API balance for non-vault mode
  const [apiLoading, setApiLoading] = useState(false);

  // Simple API balance fetch for non-vault mode
  const fetchApiBalance = async () => {
    if (!token || isVaultMode) return;
    try {
      setApiLoading(true);
      const b = await getBalance();
      setFallbackBalance(b);
    } catch {
      // ignore
    } finally {
      setApiLoading(false);
    }
  };

  // Auto-refresh API balance
  useState(() => {
    if (!token || isVaultMode) return;
    fetchApiBalance();
    const iv = setInterval(fetchApiBalance, 15_000);
    return () => clearInterval(iv);
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;
    vault.resetTx();
    await vault.deposit(amount);
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;

    if (isVaultMode) {
      // On-chain withdrawal
      vault.resetTx();
      await vault.withdraw(amount);
    } else {
      // API withdrawal (fallback)
      setWithdrawError(null);
      try {
        const result = await requestWithdrawal(
          amount,
          address || ""
        );
        setWithdrawSuccess(`Withdrawal of $${result.amount.toFixed(2)} submitted. Fee: $${result.fee.toFixed(2)}`);
        setWithdrawAmount("");
        fetchApiBalance();
      } catch (e: any) {
        setWithdrawError(e.message);
      }
    }
  };

  const handleWithdrawAll = async () => {
    if (isVaultMode) {
      vault.resetTx();
      await vault.withdrawAll();
    }
  };

  const handleEmergencyWithdraw = async () => {
    if (isVaultMode) {
      vault.resetTx();
      await vault.emergencyWithdraw();
    }
  };

  const handleApprove = async () => {
    // Approve max for convenience
    vault.resetTx();
    await vault.approve();
  };

  // ─── Render helpers ──────────────────────────────────────────────────────

  const txStatusMessage = (action: string) => {
    if (!vault.txHash && vault.txState === "idle") return null;

    const labels: Record<TxState, string> = {
      idle: "",
      pending: `${action} — waiting for wallet confirmation...`,
      confirming: `${action} — confirming on Arbitrum...`,
      success: `${action} — successful!`,
      error: `${action} — failed`,
    };
    return labels[vault.txState];
  };

  // ─── Not connected ────────────────────────────────────────────────────────

  if (!isConnected || !address) {
    return (
      <div className="glass rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-3">Wallet</h2>
        <p className="text-xs text-muted">Connect your wallet to view balance and trade.</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="glass rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-3">Wallet</h2>
        <p className="text-xs text-muted">Sign in to Lever to view your balance.</p>
        <button className="mt-3 w-full py-2 rounded-xl bg-bull text-black font-bold text-xs">
          Sign In with Wallet
        </button>
      </div>
    );
  }

  // ─── Wrong network ────────────────────────────────────────────────────────

  if (vault.wrongNetwork) {
    return (
      <div className="glass rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-3">Wallet</h2>
        <div className="bg-bear/10 border border-bear/30 rounded-lg p-3 text-xs text-bear">
          You're on the wrong network. Lever vault runs on Arbitrum.
        </div>
        <button
          onClick={() => switchChain?.({ chainId: arbitrum.id })}
          className="mt-3 w-full py-2.5 rounded-xl bg-[#213147] text-white font-bold text-xs hover:bg-[#213147]/90"
        >
          Switch to Arbitrum
        </button>
      </div>
    );
  }

  // ─── Main panel ───────────────────────────────────────────────────────────

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Wallet</h2>
        <div className="flex items-center gap-2">
          {isVaultMode && (
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-bull/10 text-bull border border-bull/20">
              On-chain
            </span>
          )}
          {balance && (
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 text-muted">
              {balance.fee_tier}
            </span>
          )}
        </div>
      </div>

      {/* Vault status indicators */}
      {isVaultMode && vault.balances && (
        <div className="flex items-center gap-3 text-[10px] text-muted mb-2">
          <span className={vault.balances.isSolvent ? "text-bull" : "text-bear"}>
            {vault.balances.isSolvent ? "Solvent" : "Insolvent"}
          </span>
          {vault.balances.isPaused && (
            <span className="text-yellow-400">Paused</span>
          )}
        </div>
      )}

      {/* Balance display */}
      {balance && (
        <div className="bg-white/5 rounded-xl p-4 mb-3">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-1">
            {isVaultMode ? "Vault Balance (Arbitrum)" : "Available Balance"}
          </div>
          <div className="text-2xl font-black font-mono">
            ${balance.available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {isVaultMode && vault.balances && (
            <div className="text-xs text-muted mt-1 space-y-0.5">
              <div>Wallet: ${vault.balances.walletBalance.toFixed(2)} USDC</div>
              <div>Approved: ${vault.balances.allowance.toFixed(2)}</div>
            </div>
          )}
          {balance.locked > 0 && (
            <div className="text-xs text-muted mt-1">
              ${balance.locked.toFixed(2)} in positions
            </div>
          )}
          <div className="text-[10px] text-bull mt-1">
            Withdrawals: FREE (non-custodial)
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {(["balance", "deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); vault.resetTx(); setWithdrawError(null); setWithdrawSuccess(null); }}
            className={`py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all ${
              tab === t
                ? "bg-white/10 border border-white/20 text-white"
                : "bg-white/[0.03] border border-transparent text-muted hover:text-white"
            }`}
          >
            {t === "balance" ? "Balance" : t === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>

      {/* ─── Balance tab ──────────────────────────────────────────────────── */}
      {tab === "balance" && balance && (
        <div className="text-xs space-y-1.5 font-mono">
          <div className="flex justify-between">
            <span className="text-muted">Available</span>
            <span>${balance.available.toFixed(2)}</span>
          </div>
          {isVaultMode && vault.balances && (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Wallet USDC</span>
                <span>${vault.balances.walletBalance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Approval</span>
                <span className={vault.balances.needsApproval ? "text-yellow-400" : "text-bull"}>
                  {vault.balances.needsApproval ? "Needs approval" : "Approved"}
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-muted">In positions</span>
            <span>${balance.locked.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold border-t border-white/5 pt-1.5">
            <span>Total</span>
            <span>${balance.total.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-bull">
            <span>Withdrawal fee</span>
            <span>FREE</span>
          </div>
        </div>
      )}

      {/* ─── Deposit tab ────────────────────────────────────────────────────── */}
      {tab === "deposit" && (
        <div className="space-y-3">
          {isVaultMode ? (
            <>
              {/* On-chain deposit flow */}
              <div className="bg-white/[0.03] rounded-lg p-3 text-[10px] text-muted space-y-1">
                <div className="font-bold text-white text-xs">Deposit to Vault (Arbitrum)</div>
                <div>1. Approve USDC for the vault</div>
                <div>2. Deposit USDC into the vault contract</div>
                <div className="text-bull">Funds are held in the smart contract — you can withdraw anytime.</div>
              </div>

              {vault.balances?.needsApproval && (
                <button
                  onClick={handleApprove}
                  disabled={vault.txState === "pending" || vault.txState === "confirming"}
                  className="w-full py-2.5 rounded-xl bg-yellow-500/90 text-black font-bold text-xs hover:bg-yellow-500 disabled:opacity-40"
                >
                  {vault.txState === "pending" ? "Confirm in wallet..." :
                   vault.txState === "confirming" ? "Approving..." :
                   "Approve USDC"}
                </button>
              )}

              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount (USDC)"
                min="1"
                step="0.01"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
              />

              {vault.balances && (
                <div className="text-[10px] text-muted">
                  Wallet: ${vault.balances.walletBalance.toFixed(2)} USDC available
                  {vault.balances.walletBalance > 0 && (
                    <button
                      onClick={() => setDepositAmount(vault.balances!.walletBalance.toFixed(2))}
                      className="ml-1 text-bull hover:underline"
                    >
                      Max
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={handleDeposit}
                disabled={vault.txState === "pending" || vault.txState === "confirming" || !depositAmount || parseFloat(depositAmount) <= 0}
                className="w-full py-2.5 rounded-xl bg-bull text-black font-bold text-xs hover:bg-bull/90 disabled:opacity-40"
              >
                {vault.txState === "pending" ? "Confirm in wallet..." :
                 vault.txState === "confirming" ? "Depositing..." :
                 "Deposit USDC"}
              </button>
            </>
          ) : (
            <>
              {/* Fallback: API deposit (non-vault) */}
              <div className="bg-white/[0.03] rounded-lg p-3 text-[10px] text-muted">
                <div className="font-bold text-white text-xs">Deposit USDC</div>
                <div>Send USDC on Arbitrum to the deposit address, then confirm below.</div>
              </div>
              <p className="text-xs text-muted">Vault contract not configured. Using API deposit mode.</p>
            </>
          )}
        </div>
      )}

      {/* ─── Withdraw tab ──────────────────────────────────────────────────── */}
      {tab === "withdraw" && (
        <div className="space-y-3">
          {isVaultMode ? (
            <>
              <div className="bg-white/[0.03] rounded-lg p-3 text-[10px] text-muted space-y-1">
                <div className="font-bold text-white text-xs">Withdraw from Vault</div>
                <div>Withdraw USDC directly from the smart contract.</div>
                <div className="text-bull font-bold">Withdrawals are always free — that's the non-custodial promise.</div>
              </div>

              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount (USDC)"
                min="1"
                step="0.01"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
              />

              {balance && (
                <div className="text-[10px] text-muted">
                  Vault: ${balance.available.toFixed(2)} USDC available
                  {balance.available > 0 && (
                    <button
                      onClick={() => setWithdrawAmount(balance!.available.toFixed(2))}
                      className="ml-1 text-bull hover:underline"
                    >
                      Max
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={handleWithdraw}
                disabled={vault.txState === "pending" || vault.txState === "confirming" || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                className="w-full py-2.5 rounded-xl bg-bear text-white font-bold text-xs hover:bg-bear/90 disabled:opacity-40"
              >
                {vault.txState === "pending" ? "Confirm in wallet..." :
                 vault.txState === "confirming" ? "Withdrawing..." :
                 "Withdraw USDC"}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={handleWithdrawAll}
                  disabled={vault.txState === "pending" || vault.txState === "confirming"}
                  className="flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-muted hover:text-white hover:border-white/20 disabled:opacity-40"
                >
                  Withdraw All
                </button>
                <button
                  onClick={handleEmergencyWithdraw}
                  disabled={vault.txState === "pending" || vault.txState === "confirming"}
                  className="flex-1 py-2 rounded-lg bg-bear/10 border border-bear/20 text-xs font-bold text-bear hover:bg-bear/20 disabled:opacity-40"
                >
                  Emergency
                </button>
              </div>

              <div className="text-[10px] text-muted">
                Emergency withdraw works even if the contract is paused — your permanent escape hatch.
              </div>
            </>
          ) : (
            <>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount (USD)"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
              />
              <button
                onClick={handleWithdraw}
                disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
                className="w-full py-2.5 rounded-xl bg-bear text-white font-bold text-xs hover:bg-bear/90 disabled:opacity-40"
              >
                Withdraw
              </button>
            </>
          )}
        </div>
      )}

      {/* Transaction status */}
      {vault.txState !== "idle" && (
        <div className={`mt-3 p-2 rounded-lg text-xs font-mono ${
          vault.txState === "success" ? "bg-bull/10 border border-bull/30 text-bull" :
          vault.txState === "error" ? "bg-bear/10 border border-bear/30 text-bear" :
          "bg-white/5 border border-white/10 text-muted"
        }`}>
          {vault.txState === "pending" && "Waiting for wallet confirmation..."}
          {vault.txState === "confirming" && "Confirming on Arbitrum..."}
          {vault.txState === "success" && "Transaction confirmed!"}
          {vault.txState === "error" && `Error: ${vault.error}`}
          {vault.txHash && (
            <a
              href={`https://arbiscan.io/tx/${vault.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 text-bull underline"
            >
              View on Arbiscan
            </a>
          )}
        </div>
      )}

      {/* API fallback status */}
      {withdrawError && (
        <div className="mt-3 p-2 bg-bear/10 border border-bear/30 rounded-lg text-xs text-bear font-mono">
          {withdrawError}
        </div>
      )}
      {withdrawSuccess && (
        <div className="mt-3 p-2 bg-bull/10 border border-bull/30 rounded-lg text-xs text-bull font-mono">
          {withdrawSuccess}
        </div>
      )}
    </div>
  );
}