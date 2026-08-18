"use client";

import { useState, useMemo, Component, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useFlashLoan, type FlashLoanStrategy } from "@/lib/useFlashLoan";

// ─── Error Boundary ────────────────────────────────────────────────────────

class FlashLoanErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: string}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error: error?.message || String(error) };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-bear/10 border border-bear/30 rounded-xl">
          <h3 className="text-sm font-bold text-bear mb-2">⚡ Flash Loan Error</h3>
          <p className="text-xs text-muted mb-3">{this.state.error}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: "" })}
            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-muted hover:text-white"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface FlashLoanQuote {
  aave_fee_usd: number;
  aave_fee_bps: number;
  lever_fee_usd: number;
  lever_fee_bps: number;
  total_fee_usd: number;
  gas_estimate_usd: number;
  min_profit_usd: number;
  max_borrow_usd: number;
  enabled: boolean;
  ready: boolean;
  fee_tier: string;
  treasury_fee_usd: number;
  referrer_fee_usd: number;
}

const STRATEGY_META: Record<
  FlashLoanStrategy,
  {
    label: string;
    emoji: string;
    description: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  arbitrage: {
    label: "Arbitrage",
    emoji: "⚡",
    description:
      "Borrow USDC from Aave, buy low on one DEX, sell high on another, repay. Profit from price differences across exchanges.",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
  },
  self_liquidation: {
    label: "Self-Liquidation",
    emoji: "🛡️",
    description:
      "Borrow USDC to close your position before forced liquidation. Cheaper than the penalty — pay only 0.55% total (Aave + Lever fee).",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  leverage_loop: {
    label: "Leverage Loop",
    emoji: "🔄",
    description:
      "Deposit $100, borrow $400 from Aave, trade with $500. Get 5x leverage with only $100 of your own capital.",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
  },
};

// ─── Pure fee calculation (no API calls, no pop-ups) ────────────────────────

function calcQuote(strategy: FlashLoanStrategy, amountUsd: number, leverage: number): FlashLoanQuote {
  const borrowAmount = strategy === "leverage_loop" ? amountUsd * (leverage - 1) : amountUsd;
  const aaveFee = borrowAmount * 0.0005; // 0.05%
  const leverFee = Math.max(borrowAmount * 0.05, 1); // 5% min $1
  const gasEst = 0.1; // ~$0.10 on Arbitrum
  const total = aaveFee + leverFee + gasEst;
  return {
    aave_fee_usd: aaveFee,
    aave_fee_bps: 5,
    lever_fee_usd: leverFee,
    lever_fee_bps: 500,
    total_fee_usd: total,
    gas_estimate_usd: gasEst,
    min_profit_usd: 5,
    max_borrow_usd: 50000,
    enabled: true,
    ready: true,
    fee_tier: "iron",
    treasury_fee_usd: leverFee * 0.7,
    referrer_fee_usd: leverFee * 0.3,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

function FlashLoanPanelInner() {
  const { isConnected } = useAccount();

  const [strategy, setStrategy] = useState<FlashLoanStrategy>("leverage_loop");
  const [amountUsd, setAmountUsd] = useState(1000);
  const [leverage, setLeverage] = useState(5);

  const { execute, txState, txHash, error, reset } = useFlashLoan(strategy, amountUsd, leverage);

  const meta = STRATEGY_META[strategy];

  // Pure local calculation — no API calls, no re-render loops
  const quote = useMemo(
    () => calcQuote(strategy, amountUsd, leverage),
    [strategy, amountUsd, leverage]
  );

  const borrowAmount =
    strategy === "leverage_loop" ? amountUsd * (leverage - 1) : amountUsd;
  const positionSize =
    strategy === "leverage_loop" ? amountUsd * leverage : amountUsd;
  const hlPenalty = amountUsd * 0.05;
  const totalCost = quote.total_fee_usd;
  const savings = strategy === "self_liquidation" ? hlPenalty - totalCost : 0;

  return (
    <div className="relative">
      {/* Subtle animated gradient overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none rounded-2xl"
        style={{
          background:
            strategy === "arbitrage"
              ? "linear-gradient(135deg, #eab308 0%, transparent 60%)"
              : strategy === "self_liquidation"
                ? "linear-gradient(135deg, #3b82f6 0%, transparent 60%)"
                : "linear-gradient(135deg, #a855f7 0%, transparent 60%)",
        }}
      />

      {/* Strategy Selector */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {(
          Object.entries(STRATEGY_META) as [
            FlashLoanStrategy,
            (typeof STRATEGY_META)[FlashLoanStrategy],
          ][]
        ).map(([key, m]) => (
          <button
            key={key}
            onClick={() => setStrategy(key)}
            className={`py-2.5 px-2 rounded-xl font-bold text-[10px] tracking-wide transition-all duration-200 border text-center ${
              strategy === key
                ? `${m.bgColor} ${m.borderColor} ${m.color} border`
                : "bg-white/[0.03] border-white/5 text-muted hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="block text-base mb-0.5">{m.emoji}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Strategy description */}
      <div
        className={`${meta.bgColor} ${meta.borderColor} border rounded-xl p-3 mb-5`}
      >
        <p className="text-[11px] leading-relaxed text-white/70">
          {meta.description}
        </p>
      </div>

      {/* Amount Input */}
      {strategy === "leverage_loop" ? (
        <>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">
            Deposit (USD)
          </label>
          <div className="relative mb-4">
            <span className="absolute left-4 top-3 text-muted text-sm">$</span>
            <input
              type="number"
              min={10}
              step={100}
              value={amountUsd}
              onChange={(e) =>
                setAmountUsd(Math.max(10, Number(e.target.value) || 0))
              }
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-16 py-3 font-mono text-sm focus:outline-none focus:border-bull/50"
            />
            <span className="absolute right-4 top-3 text-[10px] text-muted uppercase">
              USDC
            </span>
          </div>

          {/* Leverage Slider */}
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-widest text-muted">
              Leverage
            </label>
            <span className="text-sm font-bold font-mono text-white">
              {leverage}x
            </span>
          </div>
          <input
            type="range"
            min={2}
            max={50}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full mb-2"
          />
          <div className="flex justify-between text-[10px] text-muted mb-5">
            <span>2x</span>
            <span>10x</span>
            <span>25x</span>
            <span>50x</span>
          </div>
        </>
      ) : (
        <>
          <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">
            {strategy === "self_liquidation"
              ? "Position Size (USD)"
              : "Borrow Amount (USD)"}
          </label>
          <div className="relative mb-5">
            <span className="absolute left-4 top-3 text-muted text-sm">$</span>
            <input
              type="number"
              min={10}
              step={100}
              value={amountUsd}
              onChange={(e) =>
                setAmountUsd(Math.max(10, Number(e.target.value) || 0))
              }
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-16 py-3 font-mono text-sm focus:outline-none focus:border-bull/50"
            />
            <span className="absolute right-4 top-3 text-[10px] text-muted uppercase">
              USDC
            </span>
          </div>
        </>
      )}

      {/* Quick amount buttons */}
      <div className="flex gap-2 mb-5">
        {[500, 1000, 5000, 10000].map((v) => (
          <button
            key={v}
            onClick={() => setAmountUsd(v)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-mono transition-all ${
              amountUsd === v
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white/[0.03] text-muted border border-white/5 hover:text-white hover:bg-white/5"
            }`}
          >
            ${v >= 1000 ? `${v / 1000}K` : v}
          </button>
        ))}
      </div>

      {/* Fee Breakdown */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4 space-y-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Cost Breakdown
          </span>
        </div>

        {strategy === "leverage_loop" && (
          <>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">You deposit</span>
              <span className="font-mono">${amountUsd.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">Borrow from Aave</span>
              <span className="font-mono text-yellow-400">
                ${borrowAmount.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">Total position</span>
              <span className="font-mono text-white font-bold">
                ${positionSize.toLocaleString()}
              </span>
            </div>
            <div className="border-t border-white/5 pt-2" />
          </>
        )}

        <div className="flex justify-between text-[11px]">
          <span className="text-muted">Aave fee (0.05%)</span>
          <span className="font-mono">${quote.aave_fee_usd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted">Lever fee (5%)</span>
          <span className="font-mono">${quote.lever_fee_usd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted">Gas (Arbitrum)</span>
          <span className="font-mono">~${quote.gas_estimate_usd.toFixed(2)}</span>
        </div>
        <div className="border-t border-white/5 pt-2" />
        <div className="flex justify-between text-[11px] font-bold">
          <span className="text-white">Total cost</span>
          <span className="font-mono text-white">${quote.total_fee_usd.toFixed(2)}</span>
        </div>

        {strategy === "leverage_loop" && (
          <div className="flex justify-between text-[10px] text-muted">
            <span>Cost as % of your deposit</span>
            <span className="font-mono">
              {((quote.total_fee_usd / amountUsd) * 100).toFixed(2)}%
            </span>
          </div>
        )}

        {strategy === "self_liquidation" && (
          <>
            <div className="border-t border-white/5 pt-2" />
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">HL liquidation penalty (5%)</span>
              <span className="font-mono text-bear">${hlPenalty.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-bold">
              <span className="text-bull">You save</span>
              <span className="font-mono text-bull">${savings.toFixed(2)}</span>
            </div>
          </>
        )}

        <div className="border-t border-white/5 pt-1.5">
          <div className="text-[9px] text-white/30 flex justify-between">
            <span>Treasury</span>
            <span className="font-mono">${quote.treasury_fee_usd.toFixed(2)}</span>
          </div>
          <div className="text-[9px] text-white/30 flex justify-between">
            <span>Referrer</span>
            <span className="font-mono">${quote.referrer_fee_usd.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3 mb-5">
        <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
          How it works
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/50">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] flex items-center justify-center font-bold">
              1
            </span>
            <span>Borrow</span>
          </div>
          <span className="text-white/20">→</span>
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-bull/20 text-bull text-[10px] flex items-center justify-center font-bold">
              2
            </span>
            <span>Execute</span>
          </div>
          <span className="text-white/20">→</span>
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] flex items-center justify-center font-bold">
              3
            </span>
            <span>Repay</span>
          </div>
          <span className="text-white/20 ml-1">·</span>
          <span className="text-white/30 ml-1">All in one block</span>
        </div>
        <div className="text-[10px] text-white/25 mt-2">
          Atomic execution — if repayment fails, the entire transaction reverts.
          Zero risk to your capital.
        </div>
      </div>

      {/* Submit */}
      {!isConnected ? (
        <div className="[&_button]:!w-full [&_button]:!py-3.5 [&_button]:!rounded-xl [&_button]:!text-sm [&_button]:!font-bold [&_button]:!bg-purple-500 [&_button]:!text-white [&_button]:!shadow-lg [&_button]:!shadow-purple-500/20">
          <ConnectButton label="Connect EVM Wallet (MetaMask/Rabby)" />
        </div>
      ) : (
        <button
          onClick={execute}
          disabled={txState === "pending" || txState === "confirming"}
          className={`w-full py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all duration-200 ${
            txState === "success"
              ? "bg-bull text-black"
              : txState === "error"
                ? "bg-bear text-white"
                : strategy === "arbitrage"
                  ? "bg-yellow-500 text-black hover:bg-yellow-400 shadow-lg shadow-yellow-500/20"
                  : strategy === "self_liquidation"
                    ? "bg-blue-500 text-white hover:bg-blue-400 shadow-lg shadow-blue-500/20"
                    : "bg-purple-500 text-white hover:bg-purple-400 shadow-lg shadow-purple-500/20"
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {txState === "pending"
            ? "Confirm in wallet..."
            : txState === "confirming"
              ? "Confirming on Arbitrum..."
              : txState === "success"
                ? "✓ Flash Loan Executed!"
                : txState === "error"
                  ? "✗ Failed — Retry"
                  : strategy === "leverage_loop"
                    ? `${leverage}x Leverage · $${positionSize.toLocaleString()}`
                    : strategy === "self_liquidation"
                      ? `Self-Liquidate · Save $${savings.toFixed(0)}`
                      : `Flash Borrow $${borrowAmount.toLocaleString()}`}
        </button>
      )}

      {/* TX Hash link */}
      {txHash && (
        <a
          href={`https://arbiscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-2 text-center text-[11px] text-bull underline"
        >
          View on Arbiscan ↗
        </a>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-2 p-2 bg-bear/10 border border-bear/30 rounded-lg text-[11px] text-bear font-mono">
          {error.slice(0, 200)}
        </div>
      )}

      {/* Reset button after success/error */}
      {(txState === "success" || txState === "error") && (
        <button
          onClick={reset}
          className="mt-2 w-full py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-muted hover:text-white hover:border-white/20 transition-all"
        >
          {txState === "success" ? "Execute Another" : "Try Again"}
        </button>
      )}

      {/* Wallet hint */}
      <div className="mt-3 text-[10px] text-muted text-center">
        EVM wallet (MetaMask/Rabby) required · Powered by Aave v3 on Arbitrum
      </div>
    </div>
  );
}

// Export wrapped in error boundary so a crash doesn't take down the whole page
export default function FlashLoanPanelWithBoundary() {
  return (
    <FlashLoanErrorBoundary>
      <FlashLoanPanelInner />
    </FlashLoanErrorBoundary>
  );
}