"use client";

import { useState, useEffect } from "react";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { placeMarketOrder, getAllMids, getMeta, type PerpMarket } from "@/lib/hyperliquid";

const MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

export default function TradePanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();

  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const [mids, setMids] = useState<Record<string, string>>({});
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
        const [meta, m] = await Promise.all([getMeta(true), getAllMids(true)]);
        if (!alive) return;
        setMarkets(meta.universe.filter((u) => MEMECOINS.includes(u.name)));
        setMids(m);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
    const iv = setInterval(async () => {
      try {
        const m = await getAllMids(true);
        if (alive) setMids(m);
      } catch {}
    }, 10_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
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
  const levCapped = market ? Math.min(leverage, market.maxLeverage) : leverage;

  return (
    <div className="border border-border rounded-lg p-5 bg-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Trade</h2>
        <span className="text-xs text-yellow-400">testnet</span>
      </div>

      <div className="text-xs text-muted mb-4 font-mono">
        {address ? `EVM ${address.slice(0, 6)}…${address.slice(-4)}` : "no EVM wallet"} · chainId {chainId}
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("long")}
          className={`py-3 rounded-md font-bold transition-colors ${
            side === "long" ? "bg-bull text-black" : "bg-bg border border-border text-muted hover:text-white"
          }`}
        >
          LONG
        </button>
        <button
          onClick={() => setSide("short")}
          className={`py-3 rounded-md font-bold transition-colors ${
            side === "short" ? "bg-bear text-white" : "bg-bg border border-border text-muted hover:text-white"
          }`}
        >
          SHORT
        </button>
      </div>

      {/* Coin */}
      <label className="block text-xs uppercase tracking-widest text-muted mb-1">Coin</label>
      <select
        value={coin}
        onChange={(e) => setCoin(e.target.value)}
        className="w-full bg-bg border border-border rounded-md px-3 py-2 mb-1 font-mono"
      >
        {markets.length === 0 && <option value="">loading markets…</option>}
        {markets.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} (max {m.maxLeverage}x)
          </option>
        ))}
      </select>
      {mid && (
        <div className="text-xs text-muted mb-4 font-mono">
          mid: ${parseFloat(mid).toPrecision(6)}
        </div>
      )}

      {/* Size */}
      <label className="block text-xs uppercase tracking-widest text-muted mb-1">
        Size (USD)
      </label>
      <input
        type="number"
        min={10}
        step={5}
        value={sizeUsd}
        onChange={(e) => setSizeUsd(Math.max(10, Number(e.target.value) || 0))}
        className="w-full bg-bg border border-border rounded-md px-3 py-2 mb-4 font-mono"
      />

      {/* Leverage slider */}
      <label className="block text-xs uppercase tracking-widest text-muted mb-1">
        Leverage: {levCapped}x
      </label>
      <input
        type="range"
        min={1}
        max={market?.maxLeverage ?? 10}
        value={leverage}
        onChange={(e) => setLeverage(Number(e.target.value))}
        className="w-full mb-4"
      />

      {/* Submit */}
      <button
        onClick={submit}
        disabled={busy || !isConnected}
        className={`w-full py-3 rounded-md font-bold transition-colors ${
          side === "long" ? "bg-bull text-black hover:bg-bull/90" : "bg-bear text-white hover:bg-bear/90"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {busy ? "Placing…" : `${side.toUpperCase()} ${coin} ${levCapped}x · $${sizeUsd}`}
      </button>

      {err && <div className="mt-4 p-3 bg-bear/10 border border-bear/40 rounded text-xs text-bear font-mono whitespace-pre-wrap">{err}</div>}
      {result && <div className="mt-4 p-3 bg-bull/10 border border-bull/40 rounded text-xs text-bull font-mono whitespace-pre-wrap">{result}</div>}
    </div>
  );
}
