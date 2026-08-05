"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getL2Book, type L2BookLevel } from "@/lib/hyperliquid";

type OrderBookProps = {
  coin: string;
  midPrice?: string;
};

const BOOK_DEPTH = 15;
const REFRESH_MS = 2000;

export default function OrderBook({ coin, midPrice }: OrderBookProps) {
  const [bids, setBids] = useState<L2BookLevel[]>([]);
  const [asks, setAsks] = useState<L2BookLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const book = await getL2Book(coin, true);
        if (!alive) return;
        setBids(book.levels[0].slice(0, BOOK_DEPTH));
        setAsks(book.levels[1].slice(0, BOOK_DEPTH));
        setErr(null);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    refresh();
    const iv = setInterval(refresh, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [coin]);

  // Compute max size for bar visualization
  const maxSize = Math.max(
    ...bids.map((l) => parseFloat(l.sz)),
    ...asks.map((l) => parseFloat(l.sz)),
    0,
  );

  const mid = midPrice ? parseFloat(midPrice) : 0;

  // Format price — adjust decimals based on price magnitude
  function fmtPx(px: string) {
    const n = parseFloat(px);
    if (n >= 1000) return n.toFixed(2);
    if (n >= 1) return n.toFixed(4);
    if (n >= 0.01) return n.toFixed(6);
    return n.toPrecision(4);
  }

  function fmtSz(sz: string) {
    const n = parseFloat(sz);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toFixed(2);
  }

  function fmtUsd(sz: string, px: string) {
    const v = parseFloat(sz) * parseFloat(px);
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }

  // Spread calculation
  const bestBid = bids[0] ? parseFloat(bids[0].px) : 0;
  const bestAsk = asks[0] ? parseFloat(asks[0].px) : 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const spreadBps = bestBid ? (spread / bestBid * 10000).toFixed(1) : "—";

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Order Book</h2>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[10px] text-muted animate-pulse">syncing…</span>}
        </div>
      </div>

      {err && <div className="text-xs text-bear font-mono mb-2">{err}</div>}

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-1 text-[9px] uppercase tracking-widest text-muted mb-1 px-1">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (reversed so lowest ask is at bottom near spread) */}
      <div className="space-y-0">
        {[...asks].reverse().map((a, i) => {
          const barW = maxSize > 0 ? (parseFloat(a.sz) / maxSize) * 100 : 0;
          return (
            <div key={`a-${i}`} className="relative grid grid-cols-3 gap-1 text-xs font-mono py-px px-1">
              <div
                className="absolute inset-0 bg-bear/10"
                style={{ width: `${barW}%`, right: 0, left: "auto" }}
              />
              <span className="relative text-bear">{fmtPx(a.px)}</span>
              <span className="relative text-right text-white/80">{fmtSz(a.sz)}</span>
              <span className="relative text-right text-muted">{fmtUsd(a.sz, a.px)}</span>
            </div>
          );
        })}
      </div>

      {/* Spread / Mid */}
      <div className="flex items-center justify-between py-2 border-y border-white/5 my-1">
        <span className="text-sm font-bold font-mono text-white">
          {mid ? `$${mid >= 1 ? mid.toFixed(2) : mid.toPrecision(4)}` : "—"}
        </span>
        <span className="text-[10px] text-muted font-mono">
          {spread > 0 ? `Spread: ${fmtPx(String(spread))} (${spreadBps}bps)` : ""}
        </span>
      </div>

      {/* Bids */}
      <div className="space-y-0">
        {bids.map((b, i) => {
          const barW = maxSize > 0 ? (parseFloat(b.sz) / maxSize) * 100 : 0;
          return (
            <div key={`b-${i}`} className="relative grid grid-cols-3 gap-1 text-xs font-mono py-px px-1">
              <div
                className="absolute inset-0 bg-bull/10"
                style={{ width: `${barW}%`, right: 0, left: "auto" }}
              />
              <span className="relative text-bull">{fmtPx(b.px)}</span>
              <span className="relative text-right text-white/80">{fmtSz(b.sz)}</span>
              <span className="relative text-right text-muted">{fmtUsd(b.sz, b.px)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}