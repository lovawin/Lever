"use client";

const MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

export default function MarketTicker({ mids }: { mids: Record<string, string> }) {
  const items = MEMECOINS.filter((c) => mids[c]).map((c) => ({
    coin: c,
    price: parseFloat(mids[c]),
  }));

  // Duplicate for seamless scroll
  const doubled = [...items, ...items];

  if (items.length === 0) {
    return (
      <div className="border-b border-white/5 bg-black/40">
        <div className="mx-auto max-w-6xl px-6 py-1.5 text-xs text-muted">
          Loading market data…
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-white/5 bg-black/40 overflow-hidden">
      <div className="mx-auto max-w-6xl px-6 py-1.5 flex items-center gap-6 overflow-x-auto whitespace-nowrap scrollbar-hide">
        {items.map((t, i) => (
          <span key={`${t.coin}-${i}`} className="text-xs font-mono flex items-center gap-1.5 shrink-0">
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