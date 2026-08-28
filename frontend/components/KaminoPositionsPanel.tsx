"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LayoutList } from "lucide-react";
import { closeKaminoPosition } from "@/lib/custom-leverage";
import { getUserObligations, type KaminoObligation } from "@/lib/kamino-borrow";

export default function KaminoPositionsPanel() {
  const { publicKey, connected, wallet } = useWallet();
  const { connection } = useConnection();
  const [obligations, setObligations] = useState<KaminoObligation[]>([]);
  const [closingIndex, setClosingIndex] = useState<number | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setObligations([]);
      return;
    }
    let alive = true;
    const refresh = () => {
      getUserObligations(publicKey.toBase58())
        .then((obs) => { if (alive) setObligations(obs); })
        .catch(() => { if (alive) setObligations([]); });
    };
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, [connected, publicKey]);

  const handleClosePosition = useCallback(async (obs: KaminoObligation, index: number) => {
    if (!connected || !publicKey || !wallet) {
      setCloseError("Connect your Solana wallet first.");
      return;
    }
    const borrow = obs.borrows[0];
    const deposit = obs.deposits[0];
    if (!deposit) {
      setCloseError("No collateral found on this obligation.");
      return;
    }
    setClosingIndex(index);
    setCloseError(null);
    try {
      await closeKaminoPosition({
        walletAddress: publicKey.toBase58(),
        walletAdapter: wallet.adapter,
        connection,
        debtReserve: borrow?.borrowReserve ?? "",
        collateralReserve: deposit.depositReserve,
        amountUsdcOwed: borrow ? obs.borrowedValueUsd : 0,
        amountSolDeposited: Number(deposit.depositedAmount) / 1e9,
      });
      if (publicKey) {
        getUserObligations(publicKey.toBase58()).then(setObligations).catch(() => {});
      }
    } catch (e: any) {
      setCloseError(e?.message ?? String(e));
    } finally {
      setClosingIndex(null);
    }
  }, [connected, publicKey, wallet, connection]);

  if (!connected) {
    return (
      <div className="glass rounded-xl p-8 flex flex-col items-center justify-center text-center min-h-[200px]">
        <LayoutList size={36} className="mb-3 text-muted" strokeWidth={1.5} />
        <h3 className="text-sm font-semibold mb-1">Connect Your Solana Wallet</h3>
        <p className="text-xs text-muted max-w-xs">
          Connect Phantom or Solflare to see your spot leverage positions.
        </p>
      </div>
    );
  }

  if (obligations.length === 0) {
    return (
      <div className="glass rounded-xl p-6 text-center text-xs text-muted border border-dashed border-border">
        No open spot leverage positions.
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 space-y-2">
      <div className="text-xs font-semibold text-text flex items-center gap-2">
        Spot Leverage Positions
        <span className="text-[10px] text-muted font-normal">({obligations.length})</span>
      </div>
      {obligations.map((obs, i) => (
        <div key={i} className="bg-panel border border-border rounded-lg p-3 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">Collateral</span>
            <span className="font-mono text-bull">
              ${obs.collateralValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">Borrowed</span>
            <span className="font-mono text-bear">
              ${obs.borrowedValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">Health Factor</span>
            <span className={`font-mono ${obs.healthFactor > 2 ? "text-bull" : obs.healthFactor > 1.2 ? "text-yellow-400" : "text-bear"}`}>
              {obs.healthFactor.toFixed(2)}
            </span>
          </div>
          {obs.deposits.map((d, j) => (
            <div key={j} className="flex justify-between text-[10px] text-muted">
              <span>Deposit #{j + 1}</span>
              <span className="font-mono truncate max-w-[200px]">{d.depositReserve.slice(0, 8)}…</span>
            </div>
          ))}
          <a
            href={`https://kamino.com/borrow/obligation/${obs.obligationAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[10px] text-accent hover:text-accent/80 pt-1"
          >
            View on Kamino ↗
          </a>
          <button
            onClick={() => handleClosePosition(obs, i)}
            disabled={closingIndex !== null}
            className="w-full text-center text-[11px] font-medium py-1.5 rounded bg-bear/10 text-bear hover:bg-bear/20 disabled:opacity-50 transition-colors"
          >
            {closingIndex === i ? "Closing…" : "Close Position (Repay + Withdraw)"}
          </button>
        </div>
      ))}
      {closeError && (
        <div className="text-[11px] text-bear bg-bear/10 rounded p-2">{closeError}</div>
      )}
    </div>
  );
}
