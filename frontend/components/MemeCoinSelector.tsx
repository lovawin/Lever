"use client";

import { useEffect, useState } from "react";
import { getMetaAndAssetCtxs, type PerpMarket, type AssetCtx } from "@/lib/hyperliquid";

// Meme coin categories on Hyperliquid
const MEME_CATEGORIES: Record<string, string[]> = {
  "🐕 Doge Fam": ["DOGE", "WIF", "kBONK", "BONK", "FLOKI", "SHIB"],
  "🐱 Cat Coins": ["PURR", "POPCAT", "CASHCAT", "MEW"],
  "🐸 Pepes": ["kPEPE", "PEPE"],
  "🤡 PolitiFi": ["TRUMP", "FRED"],
  "🚀 Hype Ecosystem": ["HYPE", "PURR"],
  "💎 DeFi Memes": ["MEME", "MOG", "SPX", "GIGA"],
  "🔥 Hot": [], // dynamically filled by volume
};

const ALL_MEME_COINS = new Set(Object.values(MEME_CATEGORIES).flat());

type MemeCoin = {
  name: string;
  maxLeverage: number;
  szDecimals: number;
  dayVolume: number;
  funding: string;
  premium: string;
  markPx: string;
  openInterest: string;
};

type MemeCoinSelectorProps = {
  selected: string;
  onSelect: (coin: string) => void;
  mids: Record<string, string>;
};

export default function MemeCoinSelector({ selected, onSelect, mids }: MemeCoinSelectorProps) {
  const [coins, setCoins] = useState<MemeCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    async function fetch() {
      try {
        const [meta, ctxs] = await getMetaAndAssetCtxs(true);
        if (!alive) return;
        const memeCoins: MemeCoin[] = [];
        for (let i = 0; i < meta.universe.length; i++) {
          const m = meta.universe[i];
          const ctx = ctxs[i];
          // Include meme coins + anything with leverage <= 10 (smaller caps = meme territory)
          if (ALL_MEME_COINS.has(m.name) || (m.maxLeverage <= 10 && m.name !== "BTC" && m.name !== "ETH" && m.name !== "SOL")) {
            memeCoins.push({
              name: m.name,
              maxLeverage: m.maxLeverage,
              szDecimals: m.szDecimals,
              dayVolume: parseFloat(ctx.dayNtlVlm),
              funding: ctx.funding,
              premium: ctx.premium,
              markPx: ctx.markPx,
              openInterest: ctx.openInterest,
            });
          }
        }
        // Sort by volume
        memeCoins.sort((a, b) => b.dayVolume - a.dayVolume);
        setCoins(memeCoins);
      } catch {}
      finally { if (alive) setLoading(false); }
    }
    fetch();
    const iv = setInterval(fetch, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const filtered = coins.filter((c) => {
    // Search filter
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    // Category filter
    if (filter === "all") return true;
    if (filter === "hot") return c.dayVolume > 5_000_000;
    if (filter === "short-friendly") return parseFloat(c.funding) > 0; // positive funding = shorts get paid
    if (filter === "long-friendly") return parseFloat(c.funding) < 0; // negative funding = longs get paid
    const categoryCoins = MEME_CATEGORIES[filter];
    return categoryCoins ? categoryCoins.includes(c.name) : true;
  });

  function fmtVol(v: number) {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }

  function fmtFunding(rate: string) {
    const r = parseFloat(rate) * 100;
    if (Math.abs(r) < 0.0001) return "0.00%";
    return `${r >= 0 ? "+" : ""}${r.toFixed(2)}%`;
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">🎲 Meme Coins</h2>
        {loading && <span className="text-[10px] text-muted animate-pulse">loading…</span>}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search coins…"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
      />

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[
          { key: "all", label: "All" },
          { key: "hot", label: "🔥 Hot" },
          { key: "short-friendly", label: "🔴 Short-Friendly" },
          { key: "long-friendly", label: "🟢 Long-Friendly" },
          ...Object.keys(MEME_CATEGORIES).map((k) => ({ key: k, label: k })),
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-[10px] px-2 py-1 rounded-md transition-all ${
              filter === key
                ? "bg-white/10 border border-white/20 text-white"
                : "bg-white/[0.03] border border-white/5 text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Coin list */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {filtered.length === 0 && (
          <div className="text-xs text-muted text-center py-4">No coins match</div>
        )}
        {filtered.map((c) => {
          const isSelected = c.name === selected;
          const fundRate = parseFloat(c.funding);
          const midPrice = mids[c.name];
          const mid = midPrice ? parseFloat(midPrice) : parseFloat(c.markPx);

          return (
            <button
              key={c.name}
              onClick={() => onSelect(c.name)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between gap-2 ${
                isSelected
                  ? "bg-bull/10 border border-bull/30"
                  : "bg-white/[0.02] border border-transparent hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm font-mono">{c.name}</span>
                <span className="text-[10px] text-muted">{c.maxLeverage}x</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-white/70">{mid >= 1 ? `$${mid.toFixed(2)}` : `$${mid.toPrecision(4)}`}</span>
                <span className={`text-[10px] ${fundRate > 0 ? "text-bear" : fundRate < 0 ? "text-bull" : "text-muted"}`}>
                  {fmtFunding(c.funding)}
                </span>
                <span className="text-muted text-[10px]">{fmtVol(c.dayVolume)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-3 text-[9px] text-muted">
        <span>Funding: <span className="text-bear">+longs pay</span> <span className="text-bull">+shorts pay</span></span>
      </div>
    </div>
  );
}