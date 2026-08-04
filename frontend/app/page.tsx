"use client";

import WalletBar from "@/components/WalletBar";
import TradePanel from "@/components/TradePanel";
import PositionsPanel from "@/components/PositionsPanel";
import MarketTicker from "@/components/MarketTicker";
import { useEffect, useState } from "react";
import { getAllMids } from "@/lib/hyperliquid";

export default function Page() {
  const [mids, setMids] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getAllMids(true);
        if (alive) setMids(m);
      } catch {}
    })();
    const iv = setInterval(async () => {
      try {
        const m = await getAllMids(true);
        if (alive) setMids(m);
      } catch {}
    }, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <div className="min-h-screen hero-gradient flex flex-col">
      {/* Live price ticker */}
      <MarketTicker mids={mids} />

      {/* Header */}
      <header className="border-b border-white/5">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              Lever<span className="text-bull">.</span>
            </h1>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              <span className="text-[10px] uppercase tracking-widest text-muted">Live</span>
            </div>
          </div>
          <WalletBar />
        </div>
      </header>

      {/* Tagline */}
      <div className="mx-auto max-w-6xl w-full px-6 pt-8 pb-2">
        <h2 className="text-xl md:text-2xl font-bold">long the runner · short the rug</h2>
        <p className="text-sm text-muted mt-1">Perps on Hyperliquid · Spot leverage on Solana via Kamino + Jupiter. Non-custodial.</p>
      </div>

      {/* Main content — trade on left, positions on right */}
      <main className="mx-auto max-w-6xl w-full px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        <div className="lg:col-span-5">
          <TradePanel mids={mids} />
        </div>
        <div className="lg:col-span-7">
          <PositionsPanel />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Hyperliquid testnet · MVP · not financial advice</span>
          <span>Built with 🔥</span>
        </div>
      </footer>
    </div>
  );
}