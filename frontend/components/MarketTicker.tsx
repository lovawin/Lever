"use client";

import { useEffect, useState } from "react";
import { type TrendingToken, fetchDexScreenerTrending } from "@/lib/trending";

const HL_MEMECOINS = ["PURR", "HYPE", "WIF", "kPEPE", "kBONK"];

export default function MarketTicker({ mids }: { mids: Record<string, string> }) {
  const [trending, setTrending] = useState<TrendingToken[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await fetchDexScreenerTrending();
      if (alive && tokens.length > 0) setTrending(tokens);
    })();
    const iv = setInterval(async () => {
      const tokens = await fetchDexScreenerTrending();
      if (alive && tokens.length > 0) setTrending(tokens);
    }, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Format price for display
  const fmtPrice = (p: number) => {
    if (p >= 1) return `$${p.toFixed(2)}`;
    if (p >= 0.01) return `$${p.toFixed(4)}`;
    return `$${p.toPrecision(3)}`;
  };

  const fmtVol = (v: number) => {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  const chainLabel = (c: string) => {
    switch (c) {
      case "solana": return "SOL";
      case "arbitrum": return "ARB";
      case "base": return "BASE";
      case "bsc": return "BSC";
      default: return c.toUpperCase();
    }
  };

  const chainColor = (c: string) => {
    switch (c) {
      case "solana": return "text-purple-400";
      case "arbitrum": return "text-blue-400";
      case "base": return "text-blue-300";
      case "bsc": return "text-yellow-400";
      default: return "text-muted";
    }
  };

  // HL perp prices
  const hlItems = HL_MEMECOINS.filter((c) => mids[c]).map((c) => ({
    symbol: c,
    price: parseFloat(mids[c]),
    chain: "perps" as const,
  }));

  // Trending DexScreener tokens
  const dexItems = trending.map((t) => ({
    ...t,
    chain: t.chain,
  }));

  // Combined: HL first, then trending
  const allItems = [...hlItems, ...dexItems];

  // Deduplicate by symbol (prefer HL if overlap)
  const seen = new Set<string>();
  const unique = allItems.filter((item: any) => {
    const key = item.symbol;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Duplicate enough for seamless scroll
  const repeated = [...unique, ...unique, ...unique, ...unique, ...unique, ...unique];

  if (unique.length === 0) {
    return (
      <div className="border-b border-white/5 bg-black/40">
        <div className="mx-auto max-w-[1600px] px-4 py-1.5 text-xs text-muted flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
          Loading trending tokens…
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-white/5 bg-black/60 overflow-hidden">
      <div className="ticker-track py-1.5">
        {repeated.map((item: any, i: number) => {
          const isHL = item.chain === "perps";
          return (
            <span key={`t-${i}`} className="inline-flex items-center gap-1.5 shrink-0 px-3 text-xs font-mono">
              {item.logoUri && (
                <img src={item.logoUri} alt="" className="w-3.5 h-3.5 rounded-full" />
              )}
              <span className="text-white/80 font-semibold">{item.symbol}</span>
              {isHL ? (
                <span className="text-bull">{fmtPrice(item.price)}</span>
              ) : (
                <>
                  <span className={chainColor(item.chain)}>{chainLabel(item.chain)}</span>
                  <span className="text-white/60">{fmtPrice(item.price)}</span>
                  {item.change24h != null && (
                    <span className={item.change24h >= 0 ? "text-bull" : "text-bear"}>
                      {item.change24h >= 0 ? "+" : ""}{item.change24h.toFixed(1)}%
                    </span>
                  )}
                  {item.volume24h != null && (
                    <span className="text-muted/50">{fmtVol(item.volume24h)}</span>
                  )}
                </>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}