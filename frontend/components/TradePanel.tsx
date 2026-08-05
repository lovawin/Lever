"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { placeMarketOrder, getMeta, type PerpMarket } from "@/lib/hyperliquid";
import {
  searchTokens,
  type TokenSearchResult,
  calculateLeverageMetrics,
  openLeveragePosition,
} from "@/lib/leverage";
import { calculateTotalFees, formatUsd, type FeeTier } from "@/lib/fees";

/** All perp coins are loaded dynamically from the API */

type TradeMode = "perps" | "spot";

type TradePanelProps = {
  mids: Record<string, string>;
  selectedCoin?: string;
  onCoinChange?: (coin: string) => void;
};

export default function TradePanel({ mids, selectedCoin: selectedCoinProp, onCoinChange }: TradePanelProps) {
  const { address, isConnected: evmConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { publicKey, connected: solConnected, signTransaction, sendTransaction } = useWallet();

  const [markets, setMarkets] = useState<PerpMarket[]>([]);
  // Auto-detect mode based on coin — if it's in HL_PERP_MEMECOINS, use perps
  const [mode, setMode] = useState<TradeMode>("perps");
  const [internalCoin, setInternalCoin] = useState("PURR");
  const coin = selectedCoinProp ?? internalCoin;
  const setCoin = onCoinChange ?? setInternalCoin;
  const [side, setSide] = useState<"long" | "short">("long");
  const [sizeUsd, setSizeUsd] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feeTier] = useState<FeeTier>('free'); // TODO: detect from NFT holdings
  const [tokenQuery, setTokenQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TokenSearchResult[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const meta = await getMeta(false); // mainnet for real market data
        if (alive) setMarkets(meta.universe);
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
  const metrics = mode === "spot" ? calculateLeverageMetrics(sizeUsd, levCapped) : null;

  // Token search for spot mode
  useEffect(() => {
    if (mode !== "spot" || tokenQuery.length < 2) { setSearchResults([]); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchTokens(tokenQuery);
        if (alive) setSearchResults(results);
      } catch { /* ignore */ }
      finally { if (alive) setSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [mode, tokenQuery]);

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      if (mode === "perps") {
        // ─── Perps ────────────────────────────────────────────────────
        if (!evmConnected || !address || !walletClient) {
          throw new Error("Connect an EVM wallet (MetaMask/Rabby) for perps");
        }

        const r = await placeMarketOrder({
          coin,
          isLong: side === "long",
          sizeUsd,
          address,
          walletClient,
          testnet: true,
          leverage: levCapped,
        });

        // Format result for display
        const status = r.response?.data?.statuses?.[0];
        if (status?.error) {
          throw new Error(status.error);
        }
        const filled = status?.filled;
        const resting = status?.resting;
        if (filled) {
          setResult(`✅ Filled: ${filled.totalSz} @ $${filled.avgPx} (oid: ${filled.oid})`);
        } else if (resting) {
          setResult(`📋 Resting order placed (oid: ${resting.oid})`);
        } else {
          setResult(`✅ Order sent: ${JSON.stringify(r).slice(0, 300)}`);
        }
      } else {
        // ─── Spot Leverage ────────────────────────────────────────────────
        if (!solConnected || !publicKey) {
          throw new Error("Connect a Solana wallet (Phantom/Solflare) for spot leverage");
        }
        if (!selectedToken) {
          throw new Error("Select a token to long");
        }

        const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

        // Get a wallet adapter that supports signTransaction
        const walletAdapter = (window as any).solana;
        if (!walletAdapter?.signTransaction) {
          throw new Error("Wallet does not support transaction signing. Use Phantom or Solflare.");
        }

        const { signatures, steps } = await openLeveragePosition({
          walletAddress: publicKey.toBase58(),
          walletAdapter,
          connection,
          collateralUsd: sizeUsd,
          leverage: levCapped,
          targetMint: selectedToken.mint,
          slippagePercent: 1,
        });

        setResult(
          `✅ Spot leverage opened!\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nTX: ${signatures.join(", ")}`
        );
      }
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? String(e);
      // Include partial progress if available
      const steps = e?.steps;
      if (steps?.length) {
        setErr(`${msg}\n\nProgress:\n${steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`);
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [mode, coin, side, sizeUsd, levCapped, address, walletClient, evmConnected, solConnected, publicKey, selectedToken]);

  return (
    <div className="glass rounded-2xl p-4">
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
          ⚡ Perps
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
          <>Perpetual contracts. Long &amp; short with up to {market?.maxLeverage ?? 20}x leverage. Requires EVM wallet.</>
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

      {/* Coin display */}
      {mode === "perps" ? (
        <>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Asset</label>
          <div className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-1 font-mono text-sm flex items-center justify-between">
            <span className="font-bold">{coin}</span>
            {market && <span className="text-muted text-xs">up to {market.maxLeverage}x</span>}
          </div>
          {mid && (
            <div className="text-xs text-bull font-mono mb-4 mt-1">
              ${midNum >= 1 ? midNum.toFixed(2) : midNum.toPrecision(4)}
            </div>
          )}
        </>
      ) : (
        <>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Token</label>
          <div className="relative">
            <input
              type="text"
              value={tokenQuery}
              onChange={(e) => { setTokenQuery(e.target.value); setSelectedToken(null); }}
              placeholder="Search by name or paste mint address…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 font-mono text-sm focus:outline-none focus:border-bull/50 placeholder:text-muted/50"
            />
            {searching && (
              <div className="absolute right-3 top-3.5 text-xs text-muted animate-pulse">Searching…</div>
            )}
          </div>
          {/* Search results dropdown */}
          {searchResults.length > 0 && !selectedToken && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-panel shadow-xl">
              {searchResults.map((t) => (
                <button
                  key={t.mint}
                  onClick={() => { setSelectedToken(t); setTokenQuery(`${t.symbol} — ${t.name}`); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-center gap-3 border-b border-white/5 last:border-0"
                >
                  {t.logoUri && <img src={t.logoUri} alt="" className="w-5 h-5 rounded-full" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{t.symbol}</div>
                    <div className="text-[10px] text-muted truncate">{t.name}</div>
                  </div>
                  <div className="text-right text-[10px]">
                    {t.priceUsd != null && <div className="text-bull font-mono">${t.priceUsd < 0.01 ? t.priceUsd.toPrecision(3) : t.priceUsd.toFixed(2)}</div>}
                    {t.volume24h != null && <div className="text-muted">Vol: ${(t.volume24h / 1e6).toFixed(1)}M</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {/* Selected token badge */}
          {selectedToken && (
            <div className="mt-2 flex items-center gap-2 bg-bull/10 border border-bull/20 rounded-lg px-3 py-2">
              {selectedToken.logoUri && <img src={selectedToken.logoUri} alt="" className="w-4 h-4 rounded-full" />}
              <span className="text-sm font-bold">{selectedToken.symbol}</span>
              <span className="text-[10px] text-muted">{selectedToken.name}</span>
              {selectedToken.priceUsd != null && (
                <span className="text-[10px] text-bull font-mono ml-auto">${selectedToken.priceUsd < 0.01 ? selectedToken.priceUsd.toPrecision(3) : selectedToken.priceUsd.toFixed(2)}</span>
              )}
              <button onClick={() => { setSelectedToken(null); setTokenQuery(""); }} className="text-muted hover:text-white ml-1">✕</button>
            </div>
          )}
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
        {/* Fee breakdown */}
        {(() => {
          const fees = calculateTotalFees(notional, feeTier, false, 0);
          return (
            <>
              <div className="border-t border-white/5 pt-2 mt-1" />
              <div className="flex justify-between text-muted">
                <span>Platform fee ({fees.leverBps === 0 ? '0' : (fees.leverBps / 100).toFixed(fees.leverBps % 1 === 0 ? 2 : 3)}%)</span>
                <span>{fees.leverBps === 0 ? <span className="text-bull">FREE</span> : formatUsd(fees.leverFee)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Venue fee ({(fees.venueBps / 100).toFixed(fees.venueBps % 1 === 0 ? 2 : 3)}%)</span>
                <span>{formatUsd(fees.venueFee)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-white/5 pt-2">
                <span>Total fees</span>
                <span>{formatUsd(fees.totalFee)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Withdrawal</span>
                <span className="text-bull">FREE</span>
              </div>
            </>
          );
        })()}
        {estLiquidation > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Est. liq price</span>
            <span className="text-bear">${estLiquidation.toFixed(2)}</span>
          </div>
        )}
        {mode === "spot" && metrics && (
          <div className="flex justify-between text-bull">
            <span>Borrow</span>
            <span>${metrics.borrowUsd.toFixed(2)} from Kamino</span>
          </div>
        )}
        {mode === "spot" && metrics && (
          <div className="flex justify-between text-bear">
            <span>Liquidation</span>
            <span>−{metrics.liquidationDropPct.toFixed(1)}% drop</span>
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
          : selectedToken
            ? `LONG ${selectedToken.symbol} ${levCapped}x · $${notional.toFixed(0)}`
            : "Select a token to long"
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