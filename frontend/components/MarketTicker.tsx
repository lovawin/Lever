"use client";

const MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

export default function MarketTicker({ mids }: { mids: Record<string, string> }) {
  const items = MEMECOINS.filter((c) => mids[c]).map((c) => ({
    coin: c,
    price: parseFloat(mids[c]),
  }));

  // Duplicate for seamless scroll
  const doubled = [...items, ...items];

  return (
    <div className="border-b border-white/5 bg-black/40 overflow-hidden">
      <div className="ticker-track flex items-center gap-8 py-1.5 px-4 whitespace-nowrap">
        {doubled.map((t, i) => (
          <span key={`${t.coin}-${i}`} className="text-xs font-mono flex items-center gap-1.5">
            <span className="text-white/80 font-semibold">{t.coin}</span>
            <span className="text-bull">
              ${t.price >= 1 ? t.price.toFixed(2) : t.price.toPrecision(4)}
            </span>
          </span>
        ))}
        {items.length === 0 && (
          <span className="text-xs text-muted">Loading market data…</span>
        )}
      </div>
    </div>
  );
}