"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  getClearinghouseState,
  getUserFills,
  type ClearinghouseState,
  type Fill,
} from "@/lib/positions";

function fmtUsd(n: string | number | undefined) {
  if (n === undefined || n === null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPct(n: string | number | undefined) {
  if (n === undefined || n === null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function PositionsPanel() {
  const { address, isConnected } = useAccount();
  const [state, setState] = useState<ClearinghouseState | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setState(null);
      setFills([]);
      return;
    }
    let alive = true;
    async function refresh() {
      setLoading(true);
      try {
        const [s, f] = await Promise.all([
          getClearinghouseState(address!, true),
          getUserFills(address!, true, 20),
        ]);
        if (!alive) return;
        setState(s);
        setFills(f);
        setErr(null);
      } catch (e: any) {
        if (alive) setErr(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, [address, isConnected]);

  if (!isConnected) {
    return (
      <div className="glass rounded-2xl p-8 flex flex-col items-center justify-center text-center min-h-[300px]">
        <div className="text-5xl mb-4">🔑</div>
        <h3 className="text-lg font-bold mb-2">Connect Your Wallet</h3>
        <p className="text-sm text-muted max-w-sm">
          Connect an EVM wallet (MetaMask, Rabby) to see your testnet positions and trade history.
        </p>
      </div>
    );
  }

  const positions = state?.assetPositions ?? [];
  const accountValue = parseFloat(state?.marginSummary.accountValue ?? "0");
  const totalMarginUsed = parseFloat(state?.marginSummary.totalMarginUsed ?? "0");
  const withdrawable = parseFloat(state?.withdrawable ?? "0");

  return (
    <div className="glass rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold">Account</h2>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
          <span className="text-[10px] uppercase tracking-widest text-yellow-400">Testnet</span>
        </div>
      </div>

      {err && (
        <div className="text-xs text-bear font-mono mb-4 p-3 bg-bear/10 rounded-xl">{err}</div>
      )}

      {/* Account summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted">Account value</div>
          <div className="text-xl font-bold font-mono mt-1">{fmtUsd(accountValue)}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted">Margin used</div>
          <div className="text-xl font-bold font-mono mt-1">{fmtUsd(totalMarginUsed)}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted">Withdrawable</div>
          <div className="text-xl font-bold font-mono mt-1">{fmtUsd(withdrawable)}</div>
        </div>
      </div>

      {/* Open positions */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
          Open positions ({positions.length})
        </h3>
        {positions.length === 0 ? (
          <div className="text-sm text-muted p-8 text-center border border-dashed border-white/10 rounded-xl">
            {loading ? "Loading…" : "No open positions — place your first trade"}
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((ap) => {
              const p = ap.position;
              const szi = parseFloat(p.szi);
              const isLong = szi > 0;
              const upnl = parseFloat(p.unrealizedPnl);
              const notional = Math.abs(szi) * parseFloat(p.entryPx);
              return (
                <div key={p.coin} className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        isLong ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
                      }`}>
                        {isLong ? "LONG" : "SHORT"}
                      </span>
                      <span className="font-bold font-mono">{p.coin}</span>
                      <span className="text-xs text-muted">{p.leverage.value}x</span>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-bold ${upnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {upnl >= 0 ? "+" : ""}{fmtUsd(upnl)}
                      </div>
                      <div className="text-xs text-muted">{fmtPct(p.returnOnEquity)} ROE</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
                    <div>
                      <span className="text-muted">size </span>
                      <span className="font-mono">{parseFloat(p.szi).toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-muted">entry </span>
                      <span className="font-mono">${parseFloat(p.entryPx).toPrecision(6)}</span>
                    </div>
                    <div>
                      <span className="text-muted">value </span>
                      <span className="font-mono">{fmtUsd(notional)}</span>
                    </div>
                  </div>
                  {p.liquidationPx && (
                    <div className="text-[10px] text-bear/70 mt-2 font-mono">
                      liq: ${parseFloat(p.liquidationPx).toPrecision(6)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent fills */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
          Recent fills ({fills.length})
        </h3>
        {fills.length === 0 ? (
          <div className="text-sm text-muted p-6 text-center border border-dashed border-white/10 rounded-xl">
            No fills yet — place a trade above
          </div>
        ) : (
          <div className="space-y-1">
            {fills.slice(0, 10).map((f, i) => {
              const isBuy = f.side === "B";
              return (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isBuy ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
                    }`}>
                      {isBuy ? "BUY" : "SELL"}
                    </span>
                    <span className="font-semibold">{f.coin}</span>
                    <span className="text-muted">{parseFloat(f.sz).toFixed(4)}</span>
                    <span className="text-muted">@ ${parseFloat(f.px).toPrecision(6)}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-muted">{timeAgo(f.time)}</div>
                    {parseFloat(f.closedPnl) !== 0 && (
                      <div className={parseFloat(f.closedPnl) >= 0 ? "text-bull" : "text-bear"}>
                        {parseFloat(f.closedPnl) >= 0 ? "+" : ""}{fmtUsd(f.closedPnl)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}