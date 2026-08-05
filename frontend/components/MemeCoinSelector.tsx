"use client";

import { useEffect, useState } from "react";
import { getMetaAndAssetCtxs, type PerpMarket, type AssetCtx } from "@/lib/hyperliquid";

// Known meme coin categories for filtering
const MEME_CATEGORIES: Record<string, string[]> = {
  "🐕 Doge Fam": ["DOGE", "WIF", "kBONK", "kPEPE", "kSHIB", "kFLOKI", "BONK", "FLOKI", "SHIB", "BOME"],
  "🐱 Cat Coins": ["PURR", "POPCAT", "CASHCAT", "MEW", "MOODENG"],
  "🐸 Pepes": ["kPEPE", "PEPE"],
  "🤡 PolitiFi": ["TRUMP", "MELANIA", "FRED", "JEFF", "PUMP"],
  "🎮 GameFi": ["AXS", "GALA", "SAND", "GMT", "NOT", "XAI"],
  "🔥 Hot Memes": ["BRETT", "TURBO", "MEME", "GOAT", "PNUT", "MELANIA", "FARTCOIN"],
  "🐋 DeFi": ["UNI", "AAVE", "CRV", "JUP", "LINK", "PENDLE", "DYDX", "ENA", "SUSHI"],
};

type CoinInfo = {
  name: string;
  maxLeverage: number;
  szDecimals: number;
  dayVolume: number;
  funding: string;
  premium: string;
  markPx: string;
  openInterest: string;
  isMeme: boolean;
};

type MemeCoinSelectorProps = {
  selected: string;
  onSelect: (coin: string) => void;
  mids: Record<string, string>;
};

export default function MemeCoinSelector({ selected, onSelect, mids }: MemeCoinSelectorProps) {
  const [coins, setCoins] = useState<CoinInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    async function fetch() {
      try {
        const [meta, ctxs] = await getMetaAndAssetCtxs(false); // mainnet
        if (!alive) return;
        const allCoins: CoinInfo[] = [];
        const memeSet = new Set(Object.values(MEME_CATEGORIES).flat());

        // Known non-meme majors
        const majors = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOT", "AVAX", "MATIC",
          "LINK", "UNI", "AAVE", "NEAR", "ATOM", "LTC", "BCH", "ETC", "ICP", "FIL", "APT",
          "OP", "ARB", "TRX", "HBAR", "SUI", "SEI", "INJ", "TIA", "RUNE", "NEO",
          "ZEC", "DASH", "XMR", "XLM", "ALGO", "VET", "FTM", "MKR", "COMP", "CRV"]);

        for (let i = 0; i < meta.universe.length; i++) {
          const m = meta.universe[i];
          const ctx = ctxs[i] || {};
          const vol = parseFloat(ctx.dayNtlVlm || "0");

          // Skip delisted/zero-volume unless explicitly searching
          if (vol === 0 && !search) continue;

          allCoins.push({
            name: m.name,
            maxLeverage: m.maxLeverage,
            szDecimals: m.szDecimals,
            dayVolume: vol,
            funding: ctx.funding || "0",
            premium: ctx.premium || "0",
            markPx: ctx.markPx || "0",
            openInterest: ctx.openInterest || "0",
            isMeme: memeSet.has(m.name) || (!majors.has(m.name) && m.maxLeverage <= 5),
          });
        }
        // Sort by volume descending
        allCoins.sort((a, b) => b.dayVolume - a.dayVolume);
        setCoins(allCoins);
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
    if (filter === "short-friendly") return parseFloat(c.funding) > 0;
    if (filter === "long-friendly") return parseFloat(c.funding) < 0;
    if (filter === "memes") return c.isMeme;
    if (filter === "high-lev") return c.maxLeverage >= 10;
    const categoryCoins = MEME_CATEGORIES[filter];
    return categoryCoins ? categoryCoins.includes(c.name) : true;
  }).slice(0, 50); // Show max 50 at a time

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
        <h2 className="text-sm font-bold">🎭 Markets</h2>
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
          { key: "memes", label: "🃏 Memes" },
          { key: "hot", label: "🔥 Hot" },
          { key: "short-friendly", label: "🔴 Shorts Paid" },
          { key: "long-friendly", label: "🟢 Longs Paid" },
          { key: "high-lev", label: "⚡ 10x+" },
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
      <div className="max-h-80 overflow-y-auto space-y-0.5">
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
              className={`w-full text-left px-3 py-1.5 rounded-lg transition-all flex items-center justify-between gap-2 ${
                isSelected
                  ? "bg-bull/10 border border-bull/30"
                  : "border border-transparent hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm font-mono truncate">{c.name}</span>
                {c.isMeme && <span className="text-[8px] px-1 py-0.5 rounded bg-bull/20 text-bull">MEME</span>}
                <span className="text-[10px] text-muted">{c.maxLeverage}x</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                <span className="text-white/70">{mid >= 1 ? `$${mid.toFixed(2)}` : mid > 0 ? `$${mid.toPrecision(4)}` : "—"}</span>
                <span className={`text-[10px] min-w-[50px] text-right ${fundRate > 0 ? "text-bear" : fundRate < 0 ? "text-bull" : "text-muted"}`}>
                  {fmtFunding(c.funding)}
                </span>
                <span className="text-muted text-[10px] min-w-[45px] text-right">{fmtVol(c.dayVolume)}</span>
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