"use client";

import { useState } from "react";

type NFTTier = "iron" | "silver" | "gold" | "diamond";

const TIER_INFO: Record<NFTTier, {
  name: string;
  emoji: string;
  color: string;
  mintPrice: string;
  count: number;
  feeDiscount: number;
  fundingRebate: number;
  earlyAccess: string;
  votes: number;
  revenueShare: string;
}> = {
  iron: {
    name: "Iron Levers",
    emoji: "🥉",
    color: "#cd7f32",
    mintPrice: "Free (gas only)",
    count: 6000,
    feeDiscount: 10,
    fundingRebate: 0,
    earlyAccess: "1h",
    votes: 1,
    revenueShare: "—",
  },
  silver: {
    name: "Silver Levers",
    emoji: "🥈",
    color: "#c0c0c0",
    mintPrice: "0.05 ETH",
    count: 3000,
    feeDiscount: 25,
    fundingRebate: 5,
    earlyAccess: "4h",
    votes: 3,
    revenueShare: "—",
  },
  gold: {
    name: "Gold Levers",
    emoji: "🥇",
    color: "#ffd700",
    mintPrice: "0.2 ETH",
    count: 900,
    feeDiscount: 50,
    fundingRebate: 15,
    earlyAccess: "24h",
    votes: 10,
    revenueShare: "10% pool",
  },
  diamond: {
    name: "Diamond Levers",
    emoji: "💎",
    color: "#b9f2ff",
    mintPrice: "1 ETH",
    count: 100,
    feeDiscount: 100,
    fundingRebate: 25,
    earlyAccess: "48h",
    votes: 50,
    revenueShare: "25% pool",
  },
};

export default function NFTBenefits() {
  const [selectedTier, setSelectedTier] = useState<NFTTier>("silver");

  const tier = TIER_INFO[selectedTier];

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-bold">💎 NFT Benefits</h2>
        <span className="text-[9px] uppercase tracking-widest text-muted px-2 py-0.5 rounded bg-white/5">
          Coming Soon
        </span>
      </div>

      <p className="text-xs text-muted mb-4 leading-relaxed">
        10k generative PFP collection. Holders get real trading advantages — fee discounts,
        funding rebates, early access, and revenue share.
      </p>

      {/* Tier selector */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {(Object.entries(TIER_INFO) as [NFTTier, typeof tier][]).map(([key, info]) => (
          <button
            key={key}
            onClick={() => setSelectedTier(key)}
            className={`py-2 rounded-xl text-center transition-all ${
              selectedTier === key
                ? "bg-white/10 border border-white/20"
                : "bg-white/[0.02] border border-transparent hover:bg-white/5"
            }`}
          >
            <div className="text-lg">{info.emoji}</div>
            <div className="text-[9px] font-bold" style={{ color: info.color }}>{info.name.split(" ")[0]}</div>
            <div className="text-[8px] text-muted">{info.mintPrice}</div>
          </button>
        ))}
      </div>

      {/* Benefits card */}
      <div className="bg-white/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold" style={{ color: tier.color }}>
            {tier.emoji} {tier.name}
          </span>
          <span className="text-xs text-muted">{tier.count.toLocaleString()} available</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] uppercase tracking-widest text-muted">Fee Discount</div>
            <div className="text-lg font-black" style={{ color: tier.color }}>{tier.feeDiscount}%</div>
            <div className="text-[10px] text-muted">off maker fees</div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] uppercase tracking-widest text-muted">Funding Rebate</div>
            <div className="text-lg font-black" style={{ color: tier.color }}>
              {tier.fundingRebate > 0 ? `+${tier.fundingRebate}%` : "—"}
            </div>
            <div className="text-[10px] text-muted">on funding payments</div>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1.5 border-b border-white/5">
            <span className="text-muted">Early Access</span>
            <span className="font-mono font-bold">{tier.earlyAccess} before public</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/5">
            <span className="text-muted">Governance Votes</span>
            <span className="font-mono font-bold">{tier.votes}x</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/5">
            <span className="text-muted">Revenue Share</span>
            <span className="font-mono font-bold">{tier.revenueShare}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted">Mint Price</span>
            <span className="font-mono font-bold">{tier.mintPrice}</span>
          </div>
        </div>
      </div>

      {/* Staking note */}
      <div className="mt-3 text-[10px] text-muted leading-relaxed bg-white/[0.02] rounded-lg p-3">
        <strong className="text-white/70">🔥 Staking bonus:</strong> Stake your NFT for 1.5x benefits multiplier.
        Staked NFTs earn LEVER token emissions and unlock max tier benefits.
      </div>
    </div>
  );
}