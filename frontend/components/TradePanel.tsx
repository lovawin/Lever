"use client";

import { useState, useEffect } from "react";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { placeMarketOrder, getMeta, type PerpMarket } from "@/lib/hyperliquid";

const MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

export default function TradePanel({ mids }: { mids: Record<string, string> }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();

  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const [coin, setCoin] = useState("PURR");
  const [side, setSide] = useState<"long" | "short">("long");
  const [sizeUsd, setSizeUsd] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await getMeta(true);
        if (alive) setMarkets(meta.universe.filter((u) => MEMECOINS.includes(u.name)));
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  async function submit() {
    if (!isConnected || !address || !walletClient) {
      setErr("Connect an EVM wallet first");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await placeMarketOrder({
        coin,
        isLong: side === "long",
        sizeUsd,
        address,
        walletClient,
        testnet: true,
      });
      setResult(JSON.stringify(r, null, 2).slice(0, 400));
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const market = markets.find((m) => m.name === coin);
  const mid = mids[coin];
  const midNum = mid ? parseFloat(mid) : 0;
  const levCapped = market ? Math.min(leverage, market.maxLeverage) : leverage;
  const notional = sizeUsd * levCapped;
  const estLiquidation = midNum > 0 && levCapped > 0
    ? side === "long"
      ? midNum * (1 - 1 / levCapped)
      : midNum * (1 + 1 / levCapped)
    : 0;

  return (
    <div className="glass rounded-2xl p-5 glow-bull">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold">Trade</h2>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
          <span className="text-[10px] uppercase tracking-widest text-yellow-400">Testnet</span>
        </div>
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={() => setSide("long")}
          className={`py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            side === "long"
              ? "bg-bull text-black shadow-lg shadow-bull/25"
              : "bg-white/5 text-muted hover:text-white hover:bg-white/10"
          }`}
        >
          ▲ LONG
        </button>
        <button
          onClick={() => setSide("short")}
          className={`py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            side === "short"
              ? "bg-bear text-white shadow-lg shadow-bear/25"
              : "bg-white/5 text-muted hover:text-white hover:bg-white/10"
          }`}
        >
          ▼ SHORT
        </button>
      </div>

      {/* Coin selector */}
      <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Asset</label>
      <select
        value={coin}
        onChange={(e) => setCoin(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-1 font-mono text-sm focus:outline-none focus:border-bull/50"
      >
        {markets.length === 0 && <option value="">loading…</option>}
        {markets.map((m) => (
          <option key={m.name} value={m.name}>{m.name} · up to {m.maxLeverage}x</option>
        ))}
      </select>
      {mid && (
        <div className="text-xs text-bull font-mono mb-4 mt-1">
          ${midNum >= 1 ? midNum.toFixed(2) : midNum.toPrecision(4)}
        </div>
      )}

      {/* Size */}
      <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Size (USD)</label>
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
        max={market?.maxLeverage ?? 10}
        value={leverage}
        onChange={(e) => setLeverage(Number(e.target.value))}
        className="w-full mb-2"
      />
      <div className="flex justify-between text-[10px] text-muted mb-4">
        <span>1x</span>
        <span>{market?.maxLeverage ?? 10}x</span>
      </div>

      {/* Order summary */}
      <div className="bg-white/5 rounded-xl p-3 mb-4 text-xs font-mono space-y-1.5">
        <div className="flex justify-between">
          <span className="text-muted">Notional</span>
          <span>${notional.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Margin</span>
          <span>${sizeUsd.toFixed(2)}</span>
        </div>
        {estLiquidation > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Est. liq price</span>
            <span className="text-bear">${estLiquidation.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={busy || !isConnected}
        className={`w-full py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
          side === "long"
            ? "bg-bull text-black hover:bg-bull/90 shadow-lg shadow-bull/20"
            : "bg-bear text-white hover:bg-bear/90 shadow-lg shadow-bear/20"
        } disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
      >
        {busy ? "Signing…" : isConnected ? `${side.toUpperCase()} ${coin} ${levCapped}x · $${sizeUsd}` : "Connect Wallet to Trade"}
      </button>

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