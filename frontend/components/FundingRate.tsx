"use client";

import { useEffect, useState } from "react";
import {
  getMetaAndAssetCtxs,
  getFundingHistory,
  type PerpMarket,
  type AssetCtx,
  type FundingRateEntry,
} from "@/lib/hyperliquid";

type FundingRateProps = {
  coin: string;
  testnet?: boolean;
};

/** Annualize an 8h funding rate: rate * 3 * 365 */
function annualize(rate: string): number {
  return parseFloat(rate) * 3 * 365 * 100; // as percentage
}

function fmtPct(rate: string): string {
  const r8h = parseFloat(rate) * 100; // 8h rate as %
  const annual = annualize(rate);
  if (Math.abs(r8h) < 0.0001) return "0.0000%";
  return `${r8h >= 0 ? "+" : ""}${r8h.toFixed(4)}%`;
}

function fmtAnnual(rate: string): string {
  const a = annualize(rate);
  if (Math.abs(a) < 0.1) return "~0%";
  return `${a >= 0 ? "+" : ""}${a.toFixed(1)}%`;
}

export default function FundingRate({ coin, testnet = false }: FundingRateProps) {
  const [currentRate, setCurrentRate] = useState<string | null>(null);
  const [premium, setPremium] = useState<string | null>(null);
  const [openInterest, setOpenInterest] = useState<string | null>(null);
  const [dayVolume, setDayVolume] = useState<string | null>(null);
  const [history, setHistory] = useState<FundingRateEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch current funding for this coin
  useEffect(() => {
    let alive = true;
    async function fetchCurrent() {
      try {
        const [meta, ctxs] = await getMetaAndAssetCtxs(testnet);
        const idx = meta.universe.findIndex((m) => m.name === coin);
        if (idx >= 0 && idx < ctxs.length) {
          const ctx = ctxs[idx];
          if (alive) {
            setCurrentRate(ctx.funding);
            setPremium(ctx.premium);
            setOpenInterest(ctx.openInterest);
            setDayVolume(ctx.dayNtlVlm);
          }
        }
      } catch {}
    }
    fetchCurrent();
    const iv = setInterval(fetchCurrent, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, [coin, testnet]);

  // Fetch funding history (last 7 days)
  useEffect(() => {
    let alive = true;
    const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    async function fetchHistory() {
      try {
        const data = await getFundingHistory(coin, startTime, undefined, testnet);
        if (alive) setHistory(data);
      } catch {}
    }
    fetchHistory();
    const iv = setInterval(fetchHistory, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [coin, testnet]);

  useEffect(() => {
    setLoading(!currentRate);
  }, [currentRate]);

  if (loading && !currentRate) {
    return (
      <div className="glass rounded-2xl p-4">
        <h2 className="text-sm font-bold mb-2">Funding Rate</h2>
        <div className="text-xs text-muted animate-pulse">Loading…</div>
      </div>
    );
  }

  const rate8h = currentRate ? parseFloat(currentRate) * 100 : 0;
  const isPositive = rate8h >= 0;
  const premVal = premium ? parseFloat(premium) * 100 : 0;

  // Simple sparkline from funding history
  const rates = history.map((h) => parseFloat(h.fundingRate) * 100);
  const minRate = Math.min(...rates, 0);
  const maxRate = Math.max(...rates, 0);
  const rateRange = maxRate - minRate || 0.001;

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Funding Rate</h2>
        <span className="text-[10px] text-muted">8h · {coin}</span>
      </div>

      {/* Current rate display */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className={`text-2xl font-black font-mono ${isPositive ? "text-bull" : "text-bear"}`}>
          {currentRate ? fmtPct(currentRate) : "—"}
        </span>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted">
            {currentRate ? `Annual: ${fmtAnnual(currentRate)}` : ""}
          </span>
          <span className="text-[10px] text-muted">
            {premium ? `Premium: ${premVal >= 0 ? "+" : ""}${(premVal).toFixed(4)}%` : ""}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      {rates.length > 1 && (
        <div className="mb-3">
          <svg viewBox={`0 0 ${rates.length} 30`} className="w-full h-8" preserveAspectRatio="none">
            {rates.map((r, i) => {
              const x = i;
              const y = 30 - ((r - minRate) / rateRange) * 28;
              const isNeg = r < 0;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={i === rates.length - 1 ? 1.5 : 0.8}
                  fill={isNeg ? "#ff3b5c" : "#00d68f"}
                  opacity={i === rates.length - 1 ? 1 : 0.5}
                />
              );
            })}
            {/* Zero line */}
            <line
              x1={0}
              y1={30 - ((0 - minRate) / rateRange) * 28}
              x2={rates.length}
              y2={30 - ((0 - minRate) / rateRange) * 28}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="0.5"
            />
          </svg>
          <div className="flex justify-between text-[9px] text-muted">
            <span>7d ago</span>
            <span>now</span>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted">Open Interest</div>
          <div className="font-mono font-bold">
            {openInterest ? `${parseFloat(openInterest).toLocaleString()} ${coin}` : "—"}
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-[9px] uppercase tracking-widest text-muted">24h Volume</div>
          <div className="font-mono font-bold">
            {dayVolume ? `$${(parseFloat(dayVolume) / 1e6).toFixed(2)}M` : "—"}
          </div>
        </div>
      </div>

      {/* Funding explanation */}
      <div className="mt-3 text-[10px] text-muted leading-relaxed">
        {isPositive ? (
          <>🟢 Longs pay shorts — demand to long {coin} exceeds shorts</>
        ) : rate8h === 0 ? (
          <>⚪ Neutral — no funding payment this period</>
        ) : (
          <>🔴 Shorts pay longs — demand to short {coin} exceeds longs</>
        )}
      </div>
    </div>
  );
}