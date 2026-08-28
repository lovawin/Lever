"use client";

import { useEffect, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { getPumpFunGainers, type TrendingToken } from "@/lib/trending";
import type { TokenSearchResult } from "@/lib/leverage";

function fmtCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PumpGainers({ onSelect }: { onSelect: (t: TokenSearchResult) => void }) {
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      getPumpFunGainers(8)
        .then((t) => { if (alive) { setTokens(t); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    };
    refresh();
    const iv = setInterval(refresh, 45_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text uppercase tracking-wider">
          <TrendingUp size={13} className="text-bull" />
          Top Gainers · pump.fun
        </div>
        {loading && <RefreshCw size={12} className="text-muted animate-spin" />}
      </div>

      {!loading && tokens.length === 0 && (
        <div className="text-xs text-muted text-center py-6">
          No trending pump.fun data right now — try again shortly.
        </div>
      )}

      <div className="space-y-1">
        {tokens.map((t) => (
          <button
            key={t.poolAddress}
            onClick={() => onSelect({
              mint: t.mint,
              symbol: t.symbol,
              name: t.name,
              priceUsd: t.priceUsd,
              volume24h: t.volume24h,
            })}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded hover:bg-white/5 transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-sm font-medium text-text truncate">{t.symbol}</span>
              <span className="text-[10px] text-muted truncate hidden sm:inline">{fmtCompact(t.marketCap)} mcap</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-muted font-mono hidden sm:inline">{fmtCompact(t.volume24h)} vol</span>
              <span className={`text-xs font-mono font-semibold ${t.priceChange24h >= 0 ? "text-bull" : "text-bear"}`}>
                {t.priceChange24h >= 0 ? "+" : ""}{t.priceChange24h.toFixed(1)}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
