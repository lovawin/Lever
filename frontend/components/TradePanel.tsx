"use client";

import { useState, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { placeMarketOrder, getMeta, type PerpMarket } from "@/lib/hyperliquid";

/** HL perp coins — these support real longs AND shorts */
const HL_PERP_MEMECOINS = ["PURR", "HYPE", "WIF", "TRUMP", "kPEPE", "kBONK", "DOGE"];

type TradeMode = "perps" | "spot";

export default function TradePanel({ mids }: { mids: Record<string, string> }) {
  const { address, isConnected: evmConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { publicKey, connected: solConnected } = useWallet();

  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  const [mode, setMode] = useState<TradeMode>("perps");
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
        if (alive) setMarkets(meta.universe.filter((u) => HL_PERP_MEMECOINS.includes(u.name)));
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  const market = markets.find((m) => m.name === coin);
  const mid = mids[coin];
  const midNum = mid ? parseFloat(mid) : 0;
  const levCapped = mode === "perps" && market ? Math.min(leverage, market.maxLeverage) : leverage;
  const notional = sizeUsd * levCapped;
  const estLiquidation = midNum > 0 && levCapped > 0
    ? side === "long"
      ? midNum * (1 - 1 / levCapped)
      : midNum * (1 + 1 / levCapped)
    : 0;

  // Spot mode: no shorts, limited leverage
  const canShort = mode === "perps";
  const maxLev = mode === "perps" ? (market?.maxLeverage ?? 20) : 5;

  async function submit() {
    setBusy(true);
    setErr(null);
    setResult(null);

    if (mode === "perps") {
      if (!evmConnected || !address || !walletClient) {
        setErr("Connect an EVM wallet (MetaMask/Rabby) for HL perps");
        setBusy(false);
        return;
      }
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
      }
    } else {
      // Spot leverage mode
      if (!solConnected || !publicKey) {
        setErr("Connect a Solana wallet (Phantom/Solflare) for spot leverage");
        setBusy(false);
        return;
      }
      setErr("Spot leverage coming soon — Kamino + Jupiter integration in progress 🔧");
    }
    setBusy(false);
  }

  return (
    <div className="glass rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Trade</h2>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
          <span className="text-[10px] uppercase tracking-widest text-yellow-400">Testnet</span>
        </div>
      </div>

      {/* Mode toggle: Perps vs Spot */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={() => { setMode("perps"); setCoin("PURR"); }}
          className={`py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all duration-200 border ${
            mode === "perps"
              ? "bg-white/10 border-white/20 text-white"
              : "bg-white/[0.03] border-white/5 text-muted hover:text-white hover:bg-white/5"
          }`}
        >
          ⚡ HL Perps
        </button>
        <button
          onClick={() => { setMode("spot"); setSide("long"); }}
          className={`py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all duration-200 border ${
            mode === "spot"
              ? "bg-white/10 border-white/20 text-white"
              : "bg-white/[0.03] border-white/5 text-muted hover:text-white hover:bg-white/5"
          }`}
        >
          🌀 Spot Leverage
        </button>
      </div>

      {/* Mode description */}
      <div className="text-[10px] text-muted mb-5 px-1 leading-relaxed">
        {mode === "perps" ? (
          <>Perpetual contracts on Hyperliquid. Long &amp; short with up to {market?.maxLeverage ?? 20}x leverage. Requires EVM wallet.</>
        ) : (
          <>Leveraged spot buys on any Solana token via Kamino lending + Jupiter swap. Long only, up to 5x. Requires Solana wallet.</>
        )}
      </div>

      {/* Side toggle (long/short) — short disabled in spot mode */}
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
          onClick={() => canShort && setSide("short")}
          disabled={!canShort}
          className={`py-3 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            !canShort
              ? "bg-white/5 text-muted/40 cursor-not-allowed"
              : side === "short"
                ? "bg-bear text-white shadow-lg shadow-bear/25"
                : "bg-white/5 text-muted hover:text-white hover:bg-white/10"
          }`}
        >
          ▼ SHORT {!canShort && <span className="text-[10px]">(perps only)</span>}
        </button>
      </div>

      {/* Coin selector */}
      {mode === "perps" ? (
        <>
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
        </>
      ) : (
        <>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Token</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Paste mint address or search…"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
            />
            <button className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-muted hover:text-white hover:bg-white/10 transition-colors">
              🔍
            </button>
          </div>
          <div className="text-xs text-muted mt-1 mb-4 font-mono">
            Any Solana token — powered by DexScreener + Jupiter
          </div>
        </>
      )}

      {/* Size */}
      <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">
        {mode === "perps" ? "Margin (USD)" : "Collateral (USD)"}
      </label>
      <input
        type="number"
        min={10}
        step={5}
        value={sizeUsd}
        onChange={(e) => setSizeUsd(Math.max(10, Number(e.target.value) || 0))}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-5 font-mono text-sm focus:outline-none focus:border-bull/50"
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
      <div className="bg-white/5 rounded-xl p-4 mb-5 text-xs font-mono space-y-2">
        <div className="flex justify-between">
          <span className="text-muted">{mode === "perps" ? "Notional" : "Position size"}</span>
          <span>${notional.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">{mode === "perps" ? "Margin" : "Collateral"}</span>
          <span>${sizeUsd.toFixed(2)}</span>
        </div>
        {estLiquidation > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Est. liq price</span>
            <span className="text-bear">${estLiquidation.toFixed(2)}</span>
          </div>
        )}
        {mode === "spot" && (
          <div className="flex justify-between text-bull">
            <span>Borrow</span>
            <span>${(notional - sizeUsd).toFixed(2)} via Kamino</span>
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
        {busy ? "Processing…" : mode === "perps"
          ? `${side.toUpperCase()} ${coin} ${levCapped}x · $${sizeUsd}`
          : `LONG $${notional.toFixed(0)} · $${sizeUsd} collateral`
        }
      </button>

      {/* Wallet hint */}
      <div className="mt-3 text-[10px] text-muted text-center">
        {mode === "perps" ? "⚡ EVM wallet required (MetaMask / Rabby)" : "🌀 Solana wallet required (Phantom / Solflare)"}
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