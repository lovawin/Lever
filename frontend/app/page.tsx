"use client";

import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";
import PositionsPanel from "@/components/PositionsPanel";
import MarketTicker from "@/components/MarketTicker";
import OrderBook from "@/components/OrderBook";
import FundingRate from "@/components/FundingRate";
import MemeCoinSelector from "@/components/MemeCoinSelector";
import NFTBenefits from "@/components/NFTBenefits";
import { useEffect, useState } from "react";
import { getAllMids, getMeta, type PerpMarket } from "@/lib/hyperliquid";

export default function Page() {
  const [mids, setMids] = useState<Record<string, string>>({});
  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const [selectedCoin, setSelectedCoin] = useState("PURR");
  const [showNFT, setShowNFT] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getAllMids(false); // mainnet for real prices
        if (alive) setMids(m);
      } catch {}
    })();
    const iv = setInterval(async () => {
      try {
        const m = await getAllMids(false);
        if (alive) setMids(m);
      } catch {}
    }, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await getMeta(false); // mainnet for real markets
        if (alive) setMarkets(meta.universe);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen hero-gradient flex flex-col">
      {/* Live price ticker */}
      <MarketTicker mids={mids} />

      {/* Header */}
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              Lever<span className="text-bull">.</span>
            </h1>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              <span className="text-[10px] uppercase tracking-widest text-yellow-400">Live Data · Testnet Trading</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNFT(!showNFT)}
              className="text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
            >
              💎 NFT
            </button>
            <WalletBar />
          </div>
        </div>
      </header>

      {/* Tagline */}
      <div className="mx-auto max-w-7xl w-full px-6 pt-6 pb-2">
        <h2 className="text-xl md:text-2xl font-bold">long the runner · short the rug</h2>
        <p className="text-sm text-muted mt-1">Perps on any market. Spot leverage on any Solana token. Order books · Funding rates · Non-custodial.</p>
      </div>

      {/* Main content — 3 column layout */}
      <main className="mx-auto max-w-7xl w-full px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* Left: Meme coin selector */}
        <div className="lg:col-span-3">
          <MemeCoinSelector
            selected={selectedCoin}
            onSelect={setSelectedCoin}
            mids={mids}
          />
        </div>

        {/* Center: Trade + Positions */}
        <div className="lg:col-span-5 space-y-4">
          <TradePanel
            mids={mids}
            selectedCoin={selectedCoin}
            onCoinChange={setSelectedCoin}
          />
          <PositionsPanel />
        </div>

        {/* Right: Order book + Funding rate */}
        <div className="lg:col-span-4 space-y-4">
          <OrderBook
            coin={selectedCoin}
            midPrice={mids[selectedCoin]}
          />
          <FundingRate coin={selectedCoin} />

          {/* NFT Benefits panel (toggle) */}
          {showNFT && <NFTBenefits />}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-7xl px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Live data · Testnet trading · MVP · not financial advice</span>
          <span>Built with 🔥</span>
        </div>
      </footer>
    </div>
  );
}