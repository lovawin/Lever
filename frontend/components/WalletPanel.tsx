"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import {
  getBalance,
  getDepositAddress,
  confirmDeposit,
  requestWithdrawal,
  getAuthToken,
  type BalanceInfo,
  type DepositAddress,
} from "@/lib/api";

type Tab = "balance" | "deposit" | "withdraw";

export default function WalletPanel() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("balance");
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [depositAddr, setDepositAddr] = useState<DepositAddress | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDest, setWithdrawDest] = useState("");
  const [depositTxHash, setDepositTxHash] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const token = getAuthToken();

  // Fetch balance when connected and authenticated
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const fetchBalance = async () => {
      try {
        const b = await getBalance();
        if (alive) setBalance(b);
      } catch {}
    };
    fetchBalance();
    const iv = setInterval(fetchBalance, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, [token]);

  const handleGetDepositAddress = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const addr = await getDepositAddress();
      setDepositAddr(addr);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirmDeposit = useCallback(async () => {
    if (!depositTxHash || !depositAmount) return;
    setLoading(true);
    setError(null);
    try {
      const result = await confirmDeposit(depositTxHash, parseFloat(depositAmount));
      setSuccess(`Deposited $${result.amount.toFixed(2)}. New balance: $${result.new_balance.toFixed(2)}`);
      setDepositTxHash("");
      setDepositAmount("");
      // Refresh balance
      const b = await getBalance();
      setBalance(b);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [depositTxHash, depositAmount]);

  const handleWithdraw = useCallback(async () => {
    if (!withdrawAmount || !withdrawDest) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestWithdrawal(
        parseFloat(withdrawAmount),
        withdrawDest
      );
      setSuccess(`Withdrawal of $${result.amount.toFixed(2)} to ${result.destination.slice(0, 8)}... submitted. Fee: $${result.fee.toFixed(2)}`);
      setWithdrawAmount("");
      setWithdrawDest("");
      // Refresh balance
      const b = await getBalance();
      setBalance(b);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [withdrawAmount, withdrawDest]);

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

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Wallet</h2>
        {balance && (
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-white/5 text-muted">
            {balance.fee_tier}
          </span>
        )}
      </div>

      {/* Balance display */}
      {balance && (
        <div className="bg-white/5 rounded-xl p-4 mb-3">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-1">Available Balance</div>
          <div className="text-2xl font-black font-mono">
            ${balance.available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
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
            onClick={() => { setTab(t); setError(null); setSuccess(null); }}
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

      {/* Tab content */}
      {tab === "balance" && balance && (
        <div className="text-xs space-y-1.5 font-mono">
          <div className="flex justify-between">
            <span className="text-muted">Available</span>
            <span>${balance.available.toFixed(2)}</span>
          </div>
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

      {tab === "deposit" && (
        <div className="space-y-3">
          {!depositAddr ? (
            <button
              onClick={handleGetDepositAddress}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-bull text-black font-bold text-xs hover:bg-bull/90 disabled:opacity-40"
            >
              {loading ? "Loading..." : "Get Deposit Address"}
            </button>
          ) : (
            <>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted mb-1">Send USDC to</div>
                <div className="text-xs font-mono break-all text-bull">{depositAddr.address}</div>
                {depositAddr.memo && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted mb-1">Memo (required)</div>
                    <div className="text-xs font-mono">{depositAddr.memo}</div>
                  </div>
                )}
                <div className="text-[10px] text-muted mt-2">Network: {depositAddr.network}</div>
              </div>
              <div className="text-[10px] text-muted">Deposits typically confirm in 1-5 minutes.</div>
              
              {/* Manual confirmation for MVP */}
              <div className="border-t border-white/5 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-muted mb-1.5">Confirm deposit (MVP)</div>
                <input
                  type="text"
                  value={depositTxHash}
                  onChange={(e) => setDepositTxHash(e.target.value)}
                  placeholder="Transaction hash"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
                />
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Amount (USD)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
                />
                <button
                  onClick={handleConfirmDeposit}
                  disabled={loading || !depositTxHash || !depositAmount}
                  className="w-full py-2 rounded-lg bg-bull text-black font-bold text-xs disabled:opacity-40"
                >
                  Confirm Deposit
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "withdraw" && (
        <div className="space-y-3">
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Amount (USD)"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
          />
          <input
            type="text"
            value={withdrawDest}
            onChange={(e) => setWithdrawDest(e.target.value)}
            placeholder="Destination wallet address"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
          />
          <div className="text-[10px] text-muted bg-white/[0.03] rounded-lg p-2">
            Withdrawals are <span className="text-bull font-bold">always free</span>. Your funds are never held hostage — that's the non-custodial promise.
          </div>
          <button
            onClick={handleWithdraw}
            disabled={loading || !withdrawAmount || !withdrawDest}
            className="w-full py-2.5 rounded-xl bg-bear text-white font-bold text-xs hover:bg-bear/90 disabled:opacity-40"
          >
            {loading ? "Processing..." : "Withdraw"}
          </button>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="mt-3 p-2 bg-bear/10 border border-bear/30 rounded-lg text-xs text-bear font-mono">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 p-2 bg-bull/10 border border-bull/30 rounded-lg text-xs text-bull font-mono">
          {success}
        </div>
      )}
    </div>
  );
}