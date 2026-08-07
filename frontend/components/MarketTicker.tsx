"use client";

import { useEffect, useState } from "react";

const MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

export default function MarketTicker({ mids }: { mids: Record<string, string> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const items = MEMECOINS.filter((c) => mids[c]).map((c) => ({
    coin: c,
    price: parseFloat(mids[c]),
  }));

  if (items.length === 0) {
    return (
      <div className="border-b border-white/5 bg-black/40">
        <div className="mx-auto max-w-6xl px-6 py-1.5 text-xs text-muted">
          Loading market data…
        </div>
      </div>
    );
  }

  // Duplicate items enough times for seamless scroll
  const repeated = [...items, ...items, ...items, ...items, ...items, ...items];

  return (
    <div className="border-b border-white/5 bg-black/40 overflow-hidden">
      <div className="ticker-track">
        {repeated.map((t, i) => (
          <span key={`${t.coin}-${i}`} className="inline-flex items-center gap-1.5 shrink-0 px-3 text-xs font-mono">
            <span className="text-white/80 font-semibold">{t.coin}</span>
            <span className="text-bull">
              ${t.price >= 1 ? t.price.toFixed(2) : t.price.toPrecision(4)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}