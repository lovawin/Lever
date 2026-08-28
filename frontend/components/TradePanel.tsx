"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { placeMarketOrder, getMeta, type PerpMarket } from "@/lib/hyperliquid";
import { calculateTradeFees, formatUsd, type FeeTier } from "@/lib/fees";

type TradePanelProps = {
  mids: Record<string, string>;
  selectedCoin?: string;
  onCoinChange?: (coin: string) => void;
};

export default function TradePanel({ mids, selectedCoin: selectedCoinProp, onCoinChange }: TradePanelProps) {
  const { address, isConnected: evmConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const coin = selectedCoinProp ?? "PURR";
  const setCoin = (c: string) => { if (onCoinChange) onCoinChange(c); };
  const [side, setSide] = useState<"long" | "short">("long");
  const [sizeUsd, setSizeUsd] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feeTier] = useState<FeeTier>("iron");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await getMeta(false);
        if (alive) setMarkets(meta.universe);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  const market = markets.find((m) => m.name === coin);
  const mid = mids[coin];
  const midNum = mid ? parseFloat(mid) : 0;
  const maxLev = market?.maxLeverage ?? 20;
  const levCapped = Math.min(leverage, maxLev);
  const notional = sizeUsd * levCapped;
  const estLiquidation = midNum > 0 && levCapped > 0
    ? side === "long"
      ? midNum * (1 - 1 / levCapped)
      : midNum * (1 + 1 / levCapped)
    : 0;

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      if (!evmConnected || !address || !walletClient) {
        throw new Error("Connect an EVM wallet (MetaMask/Rabby)");
      }

      const r = await placeMarketOrder({
        coin,
        isLong: side === "long",
        sizeUsd,
        address,
        walletClient,
        testnet: false,
        leverage: levCapped,
      });

      const status = r.response?.data?.statuses?.[0];
      if (status?.error) throw new Error(status.error);

      const filled = status?.filled;
      const resting = status?.resting;
      if (filled) {
        setResult(`Filled: ${filled.totalSz} @ $${filled.avgPx}`);
      } else if (resting) {
        setResult(`Order placed (oid: ${resting.oid})`);
      } else {
        setResult(`Order sent`);
      }
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [coin, side, sizeUsd, levCapped, address, walletClient, evmConnected]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Memecoin Perps</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
          <span className="text-[10px] uppercase tracking-widest text-bull">Live</span>
        </div>
      </div>

      <p className="text-[11px] text-white/50 mb-4 leading-relaxed">
        Long &amp; short memecoin perpetuals with leverage. Powered by Hyperliquid.
      </p>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={() => setSide("long")}
          className={`py-3 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            side === "long"
              ? "bg-bull text-black shadow-lg shadow-bull/25"
              : "bg-white/5 text-muted hover:text-white hover:bg-white/10"
          }`}
        >
          ▲ LONG
        </button>
        <button
          onClick={() => setSide("short")}
          className={`py-3 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            side === "short"
              ? "bg-bear text-white shadow-lg shadow-bear/25"
              : "bg-white/5 text-muted hover:text-white hover:bg-white/10"
          }`}
        >
          ▼ SHORT
        </button>
      </div>

      {/* Coin selected via parent CoinSelector */}

      {/* Price */}
      {mid && (
        <div className="text-sm text-bull font-mono mb-3">
          ${midNum >= 1 ? midNum.toFixed(2) : midNum < 0.001 ? midNum.toExponential(2) : midNum.toPrecision(4)}
        </div>
      )}

      {/* Size */}
      <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Margin (USD)</label>
      <input
        type="number"
        min={10}
        step={5}
        value={sizeUsd}
        onChange={(e) => setSizeUsd(Math.max(10, Number(e.target.value) || 0))}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4 font-mono text-sm focus:outline-none focus:border-bull/50"
      />

      {/* Leverage */}
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-widest text-muted">Leverage</label>
        <span className="text-sm font-bold font-mono text-white">{levCapped}x</span>
      </div>
      <input
        type="range"
        min={1}
        max={maxLev}
        value={leverage}
        onChange={(e) => setLeverage(Number(e.target.value))}
        className="w-full mb-2"
      />
      <div className="flex justify-between text-[10px] text-muted mb-5">
        <span>1x</span>
        <span>{maxLev}x</span>
      </div>

      {/* Order summary */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5 text-xs font-mono space-y-2">
        <div className="flex justify-between">
          <span className="text-muted">Notional</span>
          <span>${notional.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Margin</span>
          <span>${sizeUsd.toFixed(2)}</span>
        </div>
        {(() => {
          const fees = calculateTradeFees(notional, sizeUsd, feeTier, 0, false, 0);
          return (
            <>
              <div className="border-t border-white/5 pt-2" />
              {fees.breakdown.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-muted text-[11px]">
                    {item.label}
                    {item.label === "Profit fee" && <span className="text-white/30"> (wins only)</span>}
                  </span>
                  <span className="text-[11px]">
                    {item.rate === "FREE"
                      ? <span className="text-bull">FREE</span>
                      : <>{item.rate} · {formatUsd(item.amount)}</>
                    }
                  </span>
                </div>
              ))}
            </>
          );
        })()}
        {estLiquidation > 0 && (
          <div className="flex justify-between border-t border-white/5 pt-2">
            <span className="text-muted">Est. liq price</span>
            <span className="text-bear">${estLiquidation.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={busy}
        className={`w-full py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
          side === "long"
            ? "bg-bull text-black hover:bg-bull/90 shadow-lg shadow-bull/20"
            : "bg-bear text-white hover:bg-bear/90 shadow-lg shadow-bear/20"
        } disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
      >
        {busy ? "Processing…" : `${side.toUpperCase()} ${coin} ${levCapped}x · $${sizeUsd}`}
      </button>

      <div className="mt-3 text-[10px] text-muted text-center">
        EVM wallet (MetaMask/Rabby) · Hyperliquid perps
      </div>

      {err && (
        <div className="mt-4 p-3 bg-bear/10 border border-bear/30 rounded-xl text-xs text-bear font-mono whitespace-pre-wrap">
          {err}
        </div>
      )}
      {result && (
        <div className="mt-4 p-3 bg-bull/10 border border-bull/30 rounded-xl text-xs text-bull font-mono whitespace-pre-wrap">
          {result}
        </div>
      )}
    </div>
  );
}