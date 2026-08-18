"use client";

import { useState, useEffect } from "react";
import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";
import FlashLoanPanel from "@/components/FlashLoanPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import OrderBook from "@/components/OrderBook";
import PriceChart from "@/components/PriceChart";
import FundingRate from "@/components/FundingRate";
import PositionsPanel from "@/components/PositionsPanel";
import { getAllMids } from "@/lib/hyperliquid";

export default function Page() {
  const [tab, setTab] = useState<"perps" | "flash">("perps");
  const [selectedCoin, setSelectedCoin] = useState("PURR");
  const [mids, setMids] = useState<Record<string, string>>({});

  // Fetch mid prices
  useEffect(() => {
    let alive = true;
    async function fetchMids() {
      try {
        const data = await getAllMids(false);
        if (alive) setMids(data);
      } catch {}
    }
    fetchMids();
    const iv = setInterval(fetchMids, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className="min-h-screen hero-gradient flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-[1100px] flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">
              Lever<span className="text-bull">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              <span className="text-[10px] uppercase tracking-widest text-bull">Live</span>
            </div>
            <WalletBar />
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="mx-auto max-w-[1100px] w-full px-4 pt-4">
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <button
            onClick={() => setTab("perps")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "perps"
                ? "bg-bull/15 text-bull border border-bull/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            ⚡ Perps
          </button>
          <button
            onClick={() => setTab("flash")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "flash"
                ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            🔄 Flash Loans
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[1100px] w-full px-4 py-4 flex-1">
        {tab === "perps" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left column: Coin selector + Trade + Order Book */}
            <div className="lg:col-span-4 space-y-4">
              {/* Coin Selector */}
              <div className="glass rounded-2xl p-4">
                <CoinSelector selected={selectedCoin} onSelect={setSelectedCoin} mids={mids} />
              </div>

              {/* Trade Panel */}
              <div className="glass rounded-2xl p-5">
                <ErrorBoundary name="Trade">
                  <TradePanel mids={mids} selectedCoin={selectedCoin} onCoinChange={setSelectedCoin} />
                </ErrorBoundary>
              </div>
            </div>

            {/* Center: Chart + Order Book */}
            <div className="lg:col-span-5 space-y-4">
              <ErrorBoundary name="Chart">
                <PriceChart coin={selectedCoin} />
              </ErrorBoundary>
              <ErrorBoundary name="OrderBook">
                <OrderBook coin={selectedCoin} midPrice={mids[selectedCoin]} />
              </ErrorBoundary>
            </div>

            {/* Right column: Funding + Positions */}
            <div className="lg:col-span-3 space-y-4">
              <ErrorBoundary name="Funding">
                <FundingRate coin={selectedCoin} />
              </ErrorBoundary>
              <ErrorBoundary name="Positions">
                <PositionsPanel />
              </ErrorBoundary>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[680px]">
            <div className="glass rounded-2xl p-5">
              <ErrorBoundary name="Flash Loan">
                <FlashLoanPanel />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Perps: 0.10% open+close · Profit: 10% of gains · Flash loans: 0.55% total</span>
          <span>Lever Protocol</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Dynamic Coin Selector ────────────────────────────────────────────────

// Memecoin tickers known on HL mainnet (top memecoins by volume)
const MEMECOIN_PERPS = [
  "PURR", "WIF", "BRETT", "SPX", "TRUMP", "DOGE", "TURBO", "MEME",
  "kPEPE", "kFLOKI", "kSHIB", "kBONK", "PURR/USDC",
];

// Keywords to auto-detect memecoins from the full mid list
const MEME_KEYWORDS = [
  "PEPE", "DOGE", "SHIB", "FLOKI", "BONK", "WIF", "BRETT", "PURR",
  "TRUMP", "MOG", "TURBO", "MEME", "SPX", "MAGA", "FIGHT", "KENDU",
  "BODEN", "TREMP", "JEFF", "RAGE", "BALD", "POPE", "GIGA",
];

function isLikelyMemecoin(name: string): boolean {
  if (MEMECOIN_PERPS.includes(name)) return true;
  const upper = name.toUpperCase();
  return MEME_KEYWORDS.some(kw => upper.includes(kw));
}

function CoinSelector({ selected, onSelect, mids }: { selected: string; onSelect: (c: string) => void; mids: Record<string, string> }) {
  const [search, setSearch] = useState("");

  // Build coin list: prioritize known memecoins, then search results
  const allCoins = Object.keys(mids).filter(c => !c.startsWith("#") && !c.startsWith("@"));
  const memecoinList = allCoins.filter(isLikelyMemecoin).sort((a, b) => {
    // Sort known memecoins first, then alphabetical
    const aKnown = MEMECOIN_PERPS.includes(a) ? 0 : 1;
    const bKnown = MEMECOIN_PERPS.includes(b) ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.localeCompare(b);
  });

  // If searching, filter all coins (not just memecoins)
  const filtered = search.trim()
    ? allCoins.filter(c => c.toLowerCase().includes(search.toLowerCase())).slice(0, 50)
    : memecoinList.slice(0, 40);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold">Asset</h2>
        <span className="text-[10px] text-muted">{filtered.length} markets</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search any perp market..."
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono mb-2 focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
      />

      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {filtered.length === 0 && (
          <span className="text-xs text-muted py-2">No markets found</span>
        )}
        {filtered.map(name => {
          const mid = mids[name];
          const midNum = mid ? parseFloat(mid) : 0;
          return (
            <button
              key={name}
              onClick={() => { onSelect(name); setSearch(""); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
                selected === name
                  ? "bg-bull/15 text-bull border border-bull/30"
                  : "bg-white/[0.03] text-muted border border-white/5 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="font-bold">{name}</span>
              {midNum > 0 && (
                <span className="ml-1 text-[10px] opacity-60">
                  ${midNum >= 1 ? midNum.toFixed(2) : midNum < 0.001 ? midNum.toExponential(1) : midNum.toPrecision(3)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}