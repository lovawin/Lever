"use client";

import { useEffect, useState } from "react";
import { getMetaAndAssetCtxs, type PerpMarket, type AssetCtx } from "@/lib/hyperliquid";
import { hasDriftPerp, getDriftMarket, DRIFT_PERP_MARKETS, getDriftMarketMeta } from "@/lib/drift";

// Meme coin categories for filtering
const MEME_CATEGORIES: Record<string, string[]> = {
  "Doge": ["DOGE", "WIF", "kBONK", "kPEPE", "kSHIB", "kFLOKI", "BONK", "FLOKI", "SHIB", "BOME"],
  "Cat": ["PURR", "POPCAT", "CASHCAT", "MEW", "MOODENG"],
  "Pepe": ["kPEPE", "PEPE"],
  "PolitiFi": ["TRUMP", "MELANIA", "FRED", "JEFF", "PUMP"],
  "Hot": ["BRETT", "TURBO", "MEME", "GOAT", "PNUT", "FARTCOIN"],
};

type Venue = "hl" | "drift" | "spot";

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
  venue: Venue;
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
        const [meta, ctxs] = await getMetaAndAssetCtxs(false);
        if (!alive) return;
        const allCoins: CoinInfo[] = [];
        const memeSet = new Set(Object.values(MEME_CATEGORIES).flat());

        const majors = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOT", "AVAX", "MATIC",
          "LINK", "UNI", "AAVE", "NEAR", "ATOM", "LTC", "BCH", "ETC", "ICP", "FIL", "APT",
          "OP", "ARB", "TRX", "HBAR", "SUI", "SEI", "INJ", "TIA", "RUNE", "NEO",
          "ZEC", "DASH", "XMR", "XLM", "ALGO", "VET", "FTM", "MKR", "COMP", "CRV"]);

        for (let i = 0; i < meta.universe.length; i++) {
          const m = meta.universe[i];
          const ctx = ctxs[i] || {};
          const vol = parseFloat(ctx.dayNtlVlm || "0");

          if (vol === 0 && !search) continue;

          // Determine venue — check if Drift also has this
          const onDrift = hasDriftPerp(m.name);
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
            venue: "hl",
          });
        }

        // Add Drift-only meme markets (not on HL)
        const hlNames = new Set(allCoins.map(c => c.name));
        for (const dm of DRIFT_PERP_MARKETS) {
          if (!hlNames.has(dm.baseAssetSymbol)) {
            allCoins.push({
              name: dm.baseAssetSymbol,
              maxLeverage: getDriftMarketMeta(dm.symbol).maxLeverage,
              szDecimals: 0,
              dayVolume: 0,
              funding: "0",
              premium: "0",
              markPx: "0",
              openInterest: "0",
              isMeme: dm.isMeme,
              venue: "drift",
            });
          }
        }

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
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "memes") return c.isMeme;
    if (filter === "hot") return c.dayVolume > 5_000_000;
    if (filter === "short-friendly") return parseFloat(c.funding) > 0;
    if (filter === "long-friendly") return parseFloat(c.funding) < 0;
    if (filter === "high-lev") return c.maxLeverage >= 10;
    if (filter === "hl") return c.venue === "hl";
    if (filter === "drift") return c.venue === "drift";
    const categoryCoins = MEME_CATEGORIES[filter];
    return categoryCoins ? categoryCoins.includes(c.name) : true;
  }).slice(0, 80);

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

  function venueLabel(v: Venue) {
    if (v === "hl") return "HL";
    if (v === "drift") return "DRIFT";
    return "SPOT";
  }

  function venueColor(v: Venue) {
    if (v === "hl") return "text-blue-400";
    if (v === "drift") return "text-purple-400";
    return "text-yellow-400";
  }

  const filterTabs = [
    { key: "all", label: "All" },
    { key: "memes", label: "Memes" },
    { key: "hot", label: "Hot" },
    { key: "short-friendly", label: "Short" },
    { key: "long-friendly", label: "Long" },
    { key: "high-lev", label: "10x+" },
    { key: "hl", label: "HL" },
    { key: "drift", label: "Drift" },
    ...Object.keys(MEME_CATEGORIES).map((k) => ({ key: k, label: k })),
  ];

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Markets</h2>
        {loading ? (
          <span className="text-[10px] text-muted animate-pulse">loading</span>
        ) : (
          <span className="text-[10px] text-muted">{filtered.length} markets</span>
        )}
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search..."
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
      />

      <div className="flex gap-1 overflow-x-auto pb-2 mb-2" style={{ scrollbarWidth: 'thin' }}>
        {filterTabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-[10px] px-2 py-1 rounded-md whitespace-nowrap shrink-0 transition-all ${
              filter === key
                ? "bg-white/10 border border-white/20 text-white"
                : "bg-white/[0.03] border border-white/5 text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 && (
          <div className="text-xs text-muted text-center py-4">No markets found</div>
        )}
        {filtered.map((c) => {
          const isSelected = c.name === selected;
          const fundRate = parseFloat(c.funding);
          const midPrice = mids[c.name];
          const mid = midPrice ? parseFloat(midPrice) : parseFloat(c.markPx);

          return (
            <button
              key={`${c.name}-${c.venue}`}
              onClick={() => onSelect(c.name)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                isSelected
                  ? "bg-bull/10 border border-bull/30"
                  : "border border-transparent hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm font-mono">{c.name}</span>
                {c.isMeme && <span className="text-[8px] px-1 py-px rounded bg-bull/20 text-bull leading-none">MEME</span>}
                <span className={`text-[8px] px-1 py-px rounded bg-white/5 ${venueColor(c.venue)} leading-none`}>{venueLabel(c.venue)}</span>
                <span className="text-[10px] text-muted">{c.maxLeverage}x</span>
                <span className="ml-auto text-xs font-mono text-white/80">
                  {mid >= 1 ? `$${mid.toFixed(2)}` : mid > 0 ? `$${mid.toPrecision(4)}` : "--"}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[10px] font-mono ${fundRate > 0 ? "text-bear" : fundRate < 0 ? "text-bull" : "text-muted"}`}>
                  {fmtFunding(c.funding)}
                </span>
                <span className="text-[10px] text-muted font-mono">
                  {fmtVol(c.dayVolume)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2 text-[9px] text-muted">
        <span className="text-blue-400">HL</span> = Hyperliquid &nbsp;
        <span className="text-purple-400">DRIFT</span> = Drift (Solana) &nbsp;
        Funding: <span className="text-bear">+longs pay</span> / <span className="text-bull">+shorts pay</span>
      </div>
    </div>
  );
}