"use client";

import { useState, useEffect } from "react";
import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";

import ErrorBoundary from "@/components/ErrorBoundary";
import OrderBook from "@/components/OrderBook";
import PriceChart from "@/components/PriceChart";
import FundingRate from "@/components/FundingRate";
import PositionsPanel from "@/components/PositionsPanel";
import { getAllMids } from "@/lib/hyperliquid";
import {
  searchTokens,
  type TokenSearchResult,
} from "@/lib/leverage";

export default function Page() {
  const [tab, setTab] = useState<"perps" | "leverage" | "flash">("perps");
  const [selectedCoin, setSelectedCoin] = useState("PURR");
  const [mids, setMids] = useState<Record<string, string>>({});

  // ─── Spot leverage state ────────────────────────────────────────────────
  const [solQuery, setSolQuery] = useState("");
  const [solResults, setSolResults] = useState<TokenSearchResult[]>([]);
  const [solSearching, setSolSearching] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenSearchResult | null>(null);

  // Fetch HL mid prices
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

  // Spot leverage token search
  useEffect(() => {
    if (!solQuery.trim()) {
      setSolResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setSolSearching(true);
      try {
        const results = await searchTokens(solQuery);
        if (alive) setSolResults(results.slice(0, 20));
      } catch {
        if (alive) setSolResults([]);
      } finally {
        if (alive) setSolSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [solQuery]);

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
            onClick={() => setTab("leverage")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "leverage"
                ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            🌀 Spot Leverage
          </button>
          <button
            onClick={() => setTab("flash")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === "flash"
                ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                : "text-muted hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            💎 Flash Loans
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[1100px] w-full px-4 py-4 flex-1">
        {tab === "perps" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left column: Coin selector + Trade */}
            <div className="lg:col-span-4 space-y-4">
              <div className="glass rounded-2xl p-4">
                <CoinSelector selected={selectedCoin} onSelect={setSelectedCoin} mids={mids} />
              </div>
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
            {/* Right: Funding + Positions */}
            <div className="lg:col-span-3 space-y-4">
              <ErrorBoundary name="Funding">
                <FundingRate coin={selectedCoin} />
              </ErrorBoundary>
              <ErrorBoundary name="Positions">
                <PositionsPanel />
              </ErrorBoundary>
            </div>
          </div>
        ) : tab === "leverage" ? (
          <div className="mx-auto max-w-[680px]">
            <div className="glass rounded-2xl p-5">
              <SpotLeveragePanel
                query={solQuery}
                setQuery={setSolQuery}
                results={solResults}
                searching={solSearching}
                selectedToken={selectedToken}
                setSelectedToken={setSelectedToken}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[680px]">
            <div className="glass rounded-2xl p-5">
              <div className="text-center py-16">
                <div className="text-5xl mb-4">💎</div>
                <h2 className="text-xl font-black mb-2">Flash Loans</h2>
                <p className="text-sm text-muted max-w-sm mx-auto">
                  Atomic flash loan strategies on Arbitrum — arbitrage, self-liquidation, and leverage loops. Powered by Aave v3.
                </p>
                <div className="mt-4 inline-block px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-muted">
                  🔄 Coming Soon
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-[1100px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Perps · Spot Leverage · Flash Loans — memecoin-native leverage</span>
          <span>Lever Protocol</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Perps Coin Selector ────────────────────────────────────────────────────

const MEMECOIN_PERPS = [
  "PURR", "WIF", "BRETT", "SPX", "TRUMP", "DOGE", "TURBO", "MEME",
  "kPEPE", "kFLOKI", "kSHIB", "kBONK", "PURR/USDC",
];

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

  const allCoins = Object.keys(mids).filter(c => !c.startsWith("#") && !c.startsWith("@"));
  const memecoinList = allCoins.filter(isLikelyMemecoin).sort((a, b) => {
    const aKnown = MEMECOIN_PERPS.includes(a) ? 0 : 1;
    const bKnown = MEMECOIN_PERPS.includes(b) ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.localeCompare(b);
  });

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
        {filtered.length === 0 && <span className="text-xs text-muted py-2">No markets found</span>}
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

// ─── Spot Leverage Panel ────────────────────────────────────────────────────

function SpotLeveragePanel({
  query, setQuery, results, searching, selectedToken, setSelectedToken,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: TokenSearchResult[];
  searching: boolean;
  selectedToken: TokenSearchResult | null;
  setSelectedToken: (t: TokenSearchResult | null) => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-black mb-1">🌀 Spot Leverage</h2>
      <p className="text-xs text-muted mb-4">
        Long any memecoin with leverage on Solana. Search a token, pick your size, and go.
      </p>

      {/* Token Search */}
      {!selectedToken ? (
        <div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memecoin (e.g. BONK, WIF, MEME)..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono mb-3 focus:outline-none focus:border-purple-500/50 placeholder:text-muted/50"
            autoFocus
          />

          {searching && (
            <div className="text-xs text-muted text-center py-4">Searching...</div>
          )}

          {!searching && results.length > 0 && (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {results.map((token) => (
                <button
                  key={token.mint}
                  onClick={() => setSelectedToken(token)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:border-purple-500/30 hover:bg-purple-500/5 transition-all text-left"
                >
                  {token.logoUri ? (
                    <img src={token.logoUri} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                      {token.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{token.symbol}</div>
                    <div className="text-[10px] text-muted truncate">{token.name}</div>
                  </div>
                  <div className="text-xs text-muted font-mono">{token.mint.slice(0, 4)}…{token.mint.slice(-4)}</div>
                </button>
              ))}
            </div>
          )}

          {!searching && query && results.length === 0 && (
            <div className="text-xs text-muted text-center py-4">No tokens found. Try a different search.</div>
          )}

          {!query && (
            <div className="text-xs text-muted text-center py-8">
              Type a token name or symbol to search Solana memecoins
            </div>
          )}
        </div>
      ) : (
        <div>
          <button
            onClick={() => setSelectedToken(null)}
            className="text-xs text-muted hover:text-white mb-3 flex items-center gap-1"
          >
            ← Back to search
          </button>

          <div className="flex items-center gap-3 mb-4">
            {selectedToken.logoUri ? (
              <img src={selectedToken.logoUri} alt="" className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-400">
                {selectedToken.symbol.slice(0, 2)}
              </div>
            )}
            <div>
              <div className="font-black text-lg">{selectedToken.symbol}</div>
              <div className="text-xs text-muted">{selectedToken.name}</div>
            </div>
          </div>

          <div className="bg-white/[0.03] rounded-xl p-3 mb-3 text-xs text-muted space-y-1">
            <div>Mint: <span className="font-mono text-white">{selectedToken.mint}</span></div>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 mb-4">
            <div className="text-xs font-bold text-purple-400 mb-1">How Spot Leverage Works</div>
            <div className="text-xs text-muted space-y-1">
              <div>1. Connect your Solana wallet (Phantom / Solflare)</div>
              <div>2. Choose leverage size (2x–100x)</div>
              <div>3. Lavarage / Kamino opens a leveraged long position</div>
              <div>4. Your collateral is at risk — manage risk carefully</div>
            </div>
          </div>

          <div className="text-center text-xs text-muted py-4 border border-white/5 rounded-xl">
            🔄 Spot leverage execution coming soon — token search is live
          </div>
        </div>
      )}
    </div>
  );
}