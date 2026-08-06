"use client";

import { useState } from "react";
import { FEE_TIERS, type FeeTier, calculateTradeFees, formatUsd } from "@/lib/fees";

const TIER_INFO: Record<FeeTier, {
  name: string;
  emoji: string;
  color: string;
  mintPrice: string;
  count: number;
  earlyAccess: string;
  votes: number;
}> = {
  free: {
    name: "Free Tier",
    emoji: "",
    color: "#888",
    mintPrice: "—",
    count: Infinity,
    earlyAccess: "—",
    votes: 0,
  },
  iron: {
    name: "Iron Levers",
    emoji: "",
    color: "#cd7f32",
    mintPrice: "Free (gas only)",
    count: 6000,
    earlyAccess: "1h",
    votes: 1,
  },
  silver: {
    name: "Silver Levers",
    emoji: "",
    color: "#c0c0c0",
    mintPrice: "0.05 ETH",
    count: 3000,
    earlyAccess: "4h",
    votes: 3,
  },
  gold: {
    name: "Gold Levers",
    emoji: "",
    color: "#ffd700",
    mintPrice: "0.2 ETH",
    count: 900,
    earlyAccess: "24h",
    votes: 10,
  },
  diamond: {
    name: "Diamond Levers",
    emoji: "",
    color: "#b9f2ff",
    mintPrice: "1 ETH",
    count: 100,
    earlyAccess: "48h",
    votes: 50,
  },
};

export default function NFTBenefits() {
  const [selectedTier, setSelectedTier] = useState<FeeTier>("silver");
  const [previewUsd, setPreviewUsd] = useState(1000);

  const feeConfig = FEE_TIERS[selectedTier];
  const tierInfo = TIER_INFO[selectedTier];
  const fees = calculateTradeFees(previewUsd, previewUsd * 2, selectedTier, 0, false, 0); // assume 2x leverage for preview
  const freeFees = calculateTotalFees(previewUsd, "free", false, 0);

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold">NFT Benefits</h2>
        <span className="text-[9px] uppercase tracking-widest text-muted px-2 py-0.5 rounded bg-white/5">
          Coming Soon
        </span>
      </div>

      <p className="text-xs text-muted mb-3 leading-relaxed">
        10k generative PFP collection. Holders get real trading advantages — lower fees,
        funding rebates, early access, and revenue share.
      </p>

      {/* Tier selector */}
      <div className="grid grid-cols-5 gap-1.5 mb-4">
        {(Object.keys(FEE_TIERS) as FeeTier[]).map((key) => {
          const info = TIER_INFO[key];
          const cfg = FEE_TIERS[key];
          return (
            <button
              key={key}
              onClick={() => setSelectedTier(key)}
              className={`py-2 rounded-lg text-center transition-all ${
                selectedTier === key
                  ? "bg-white/10 border border-white/20"
                  : "bg-white/[0.02] border border-transparent hover:bg-white/5"
              }`}
            >
              <div className="text-base font-bold" style={{ color: info.color }}>{cfg.label}</div>
              <div className="text-[9px] font-bold" style={{ color: info.color }}>{cfg.label}</div>
              <div className="text-[8px] text-muted">{cfg.platformFeeBps === 0 ? 'FREE' : `${cfg.platformFeeBps / 100}% fee`}</div>
            </button>
          );
        })}
      </div>

      {/* Fee calculator preview */}
      <div className="bg-white/5 rounded-xl p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-widest text-muted">Fee calculator</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">$</span>
            <input
              type="number"
              min={100}
              step={100}
              value={previewUsd}
              onChange={(e) => setPreviewUsd(Math.max(100, Number(e.target.value) || 0))}
              className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs font-mono text-right focus:outline-none focus:border-bull/50"
            />
            <span className="text-xs text-muted">trade</span>
          </div>
        </div>
        <div className="space-y-1.5 text-xs font-mono">
          {fees.breakdown.map((item, i) => (
            <div key={i} className={`flex justify-between ${i >= fees.breakdown.length - 2 ? 'font-bold border-t border-white/5 pt-1.5' : ''}`}>
              <span className="text-muted">
                {item.label}
                {item.label === 'Profit fee' && <span className="text-muted/60"> (if win)</span>}
              </span>
              <span>
                {item.rate === 'FREE' 
                  ? <span className="text-bull">FREE</span> 
                  : <>{item.rate} · {formatUsd(item.amount)}</>
                }
              </span>
            </div>
          ))}
          {fees.savingsVsFree > 0 && (
            <div className="flex justify-between text-bull">
              <span>You save</span>
              <span>{formatUsd(fees.savingsVsFree)}/round trip</span>
            </div>
          )}
        </div>
      </div>

      {/* Benefits card */}
      <div className="bg-white/5 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold" style={{ color: tierInfo.color }}>
            {tierInfo.name}
          </span>
          {tierInfo.count !== Infinity && (
            <span className="text-xs text-muted">{tierInfo.count.toLocaleString()} available</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/[0.03] rounded-lg p-2.5">
            <div className="text-[9px] uppercase tracking-widest text-muted">Platform Fee</div>
            <div className="text-lg font-black" style={{ color: tierInfo.color }}>
              {feeConfig.openCloseBps === 0 ? "FREE" : `${feeConfig.openCloseBps / 100}%`}
            </div>
            <div className="text-[10px] text-muted">
              {feeConfig.openCloseBps === 0 ? "Zero fees" : `open+close · was 0.10%`}
            </div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-2.5">
            <div className="text-[9px] uppercase tracking-widest text-muted">Profit Fee</div>
            <div className="text-lg font-black" style={{ color: tierInfo.color }}>
              {feeConfig.profitFeePct === 0 ? "FREE" : `${feeConfig.profitFeePct}%`}
            </div>
            <div className="text-[10px] text-muted">{feeConfig.profitFeePct === 0 ? "no profit cut" : "of winning trades"}</div>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-muted">Early Access</span>
            <span className="font-mono font-bold">{tierInfo.earlyAccess}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-muted">Governance Votes</span>
            <span className="font-mono font-bold">{tierInfo.votes > 0 ? `${tierInfo.votes}x` : "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-white/5">
            <span className="text-muted">Revenue Share</span>
            <span className="font-mono font-bold">{feeConfig.revenueShare > 0 ? `${feeConfig.revenueShare}%` : "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-muted">Mint Price</span>
            <span className="font-mono font-bold">{tierInfo.mintPrice}</span>
          </div>
        </div>
      </div>

      {/* Staking note */}
      <div className="mt-3 text-[10px] text-muted leading-relaxed bg-white/[0.02] rounded-lg p-2.5">
        <strong className="text-white/70">Staking bonus:</strong> Stake your NFT for 1.5x benefits multiplier.
        Staked NFTs earn LEVER token emissions and unlock max tier benefits.
      </div>
    </div>
  );
}