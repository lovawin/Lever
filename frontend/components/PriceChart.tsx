"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, ColorType, type IChartApi, type ISeriesApi, type Time, type CandlestickData } from "lightweight-charts";

type PriceChartProps = {
  coin: string;
  height?: number;
};

// Fetch candles from HL API
async function fetchCandles(coin: string, interval: string = "1h", startTime?: number): Promise<CandlestickData<Time>[]> {
  const now = Date.now();
  const start = startTime || now - 7 * 24 * 60 * 60 * 1000;

  const r = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime: start,
        endTime: now,
      },
    }),
  });

  if (!r.ok) return [];

  const data = await r.json();
  if (!Array.isArray(data)) return [];

  return data
    .map((c: any) => ({
      time: (c.t / 1000) as Time,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
    }))
    .sort((a: CandlestickData<Time>, b: CandlestickData<Time>) => (a.time as number) - (b.time as number));
}

const INTERVALS = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
];

export default function PriceChart({ coin, height = 320 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const [interval, setInterval_] = useState<string>("1h");
  const [loading, setLoading] = useState(true);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
        fontFamily: "monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,0.1)", labelBackgroundColor: "#1f2937" },
        horzLine: { color: "rgba(255,255,255,0.1)", labelBackgroundColor: "#1f2937" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.05)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.05)",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // Fetch data when coin or interval changes
  useEffect(() => {
    let alive = true;
    setLoading(true);

    async function load() {
      try {
        const candles = await fetchCandles(coin, interval);
        if (alive && seriesRef.current && candles.length > 0) {
          seriesRef.current.setData(candles);
          chartRef.current?.timeScale().fitContent();
        }
      } catch (e) {
        console.error("Chart data error:", e);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, [coin, interval]);

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold">{coin} / USD</h2>
        <div className="flex items-center gap-1">
          {INTERVALS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setInterval_(key)}
              className={`text-[10px] px-2 py-1 rounded transition-all ${
                interval === key
                  ? "bg-white/10 border border-white/20 text-white"
                  : "text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <span className="text-xs text-muted animate-pulse">Loading chart...</span>
          </div>
        )}
        <div ref={containerRef} className="rounded-lg overflow-hidden" />
      </div>
    </div>
  );
}