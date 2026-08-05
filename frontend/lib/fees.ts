/**
 * Lever Platform Fee System
 *
 * Every trade on Lever pays a platform fee. This is our fee, separate from
 * any venue (HL, Kamino, etc.) fees that are already built into execution.
 *
 * Tiers:
 *   Free (no NFT)    → 0.10% platform fee
 *   Iron NFT (free)   → 0.09% (10% discount)
 *   Silver NFT        → 0.075% (25% discount)
 *   Gold NFT          → 0.05% (50% discount + 15% funding rebate)
 *   Diamond NFT       → 0.00% (100% discount + 25% funding rebate + 25% revenue share)
 *
 * Funding rebates and revenue share are distributed from treasury to NFT holders
 * on a periodic basis (weekly).
 */

// ─── Fee Tier Definitions ──────────────────────────────────────────────────

export type FeeTier = 'free' | 'iron' | 'silver' | 'gold' | 'diamond';

export const FEE_TIERS: Record<FeeTier, {
  label: string;
  emoji: string;
  platformFeeBps: number;     // platform fee in basis points (1 bp = 0.01%)
  feeDiscount: number;        // discount percentage vs free tier
  fundingRebate: number;       // % of funding fees rebated to user
  revenueShare: number;        // % of platform revenue shared with user
  mintPrice: string;           // ETH price to mint
  color: string;               // tailwind color class
}> = {
  free: {
    label: 'Free',
    emoji: '🆓',
    platformFeeBps: 10,        // 0.10%
    feeDiscount: 0,
    fundingRebate: 0,
    revenueShare: 0,
    mintPrice: 'Free',
    color: 'text-gray-400',
  },
  iron: {
    label: 'Iron',
    emoji: '🛡️',
    platformFeeBps: 9,          // 0.09%
    feeDiscount: 10,            // 10% off
    fundingRebate: 0,
    revenueShare: 0,
    mintPrice: 'Free',
    color: 'text-gray-300',
  },
  silver: {
    label: 'Silver',
    emoji: '🥈',
    platformFeeBps: 7.5,        // 0.075%
    feeDiscount: 25,
    fundingRebate: 0,
    revenueShare: 0,
    mintPrice: '0.05 ETH',
    color: 'text-gray-200',
  },
  gold: {
    label: 'Gold',
    emoji: '🥇',
    platformFeeBps: 5,          // 0.05%
    feeDiscount: 50,
    fundingRebate: 15,          // 15% of funding fees rebated
    revenueShare: 0,
    mintPrice: '0.2 ETH',
    color: 'text-yellow-400',
  },
  diamond: {
    label: 'Diamond',
    emoji: '💎',
    platformFeeBps: 0,          // 0.00% — fee-free trading
    feeDiscount: 100,
    fundingRebate: 25,
    revenueShare: 25,           // 25% of platform revenue
    mintPrice: '1 ETH',
    color: 'text-cyan-400',
  },
};

// ─── Fee Calculation ────────────────────────────────────────────────────────

/** Treasury wallet address — platform fees get sent here */
export const TREASURY_ADDRESS = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TREASURY_ADDRESS) || '';

/**
 * Calculate the platform fee for a trade.
 *
 * @param notionalUsd - Trade size in USD (price × size)
 * @param tier - User's fee tier
 * @returns Object with fee details
 */
export function calculatePlatformFee(
  notionalUsd: number,
  tier: FeeTier = 'free',
): {
  feeUsd: number;
  feeBps: number;
  tier: FeeTier;
  discount: number;
} {
  const config = FEE_TIERS[tier];
  const feeUsd = notionalUsd * (config.platformFeeBps / 10000);
  return {
    feeUsd,
    feeBps: config.platformFeeBps,
    tier,
    discount: config.feeDiscount,
  };
}

/**
 * Calculate the total fee breakdown for a perps trade.
 * Includes both Lever platform fee and HL's venue fee.
 *
 * @param notionalUsd - Trade size in USD
 * @param tier - User's fee tier
 * @param isMaker - Whether the order is a maker order
 * @param hlVolumeTier - HL fee tier (0-6 based on 14d volume)
 */
export function calculateTotalFees(
  notionalUsd: number,
  tier: FeeTier = 'free',
  isMaker: boolean = false,
  hlVolumeTier: number = 0,
): {
  leverFee: number;
  leverBps: number;
  venueFee: number;
  venueBps: number;
  totalFee: number;
  totalBps: number;
  savingsVsFree: number;
  withdrawalFee: number; // always 0 — non-custodial
} {
  // Spot pairs between two spot quote assets have 80% lower taker fees
  // and maker rebates. Aligned quote assets get 20% lower taker fees.
  // Lever platform fees are ON TOP of venue fees.
  // Withdrawals are always free — Lever never holds your funds (non-custodial).

  // Lever platform fee (our fee, on top of venue fees)
  const lever = calculatePlatformFee(notionalUsd, tier);

  // HL venue fee (base rate, tier 0)
  // Maker: 0.015% (1.5 bps), Taker: 0.045% (4.5 bps)
  // Higher tiers reduce these based on 14d volume
  const venueFeeSchedule = [
    { maker: 1.5, taker: 4.5 },   // tier 0 (base)
    { maker: 1.2, taker: 4.0 },   // tier 1 (>5M)
    { maker: 0.8, taker: 3.5 },   // tier 2 (>25M)
    { maker: 0.4, taker: 3.0 },   // tier 3 (>100M)
    { maker: 0.0, taker: 2.8 },   // tier 4 (>500M)
    { maker: 0.0, taker: 2.6 },   // tier 5 (>2B)
    { maker: 0.0, taker: 2.4 },   // tier 6 (>7B)
  ];
  const hlFees = venueFeeSchedule[hlVolumeTier] || venueFeeSchedule[0];
  const venueBps = isMaker ? hlFees.maker : hlFees.taker;
  const venueFee = notionalUsd * (venueBps / 10000);

  // Total
  const totalFee = lever.feeUsd + venueFee;
  const totalBps = lever.feeBps + venueBps;

  // How much the user saves vs free tier
  const freeTier = calculatePlatformFee(notionalUsd, 'free');
  const savingsVsFree = freeTier.feeUsd - lever.feeUsd;

  return {
    leverFee: lever.feeUsd,
    leverBps: lever.feeBps,
    venueFee,
    venueBps,
    totalFee,
    totalBps,
    savingsVsFree,
    withdrawalFee: 0, // non-custodial — we never hold your funds
  };
}

// ─── HL Builder Fee Integration ─────────────────────────────────────────────

/**
 * For HL perps, we use Builder Codes to capture our platform fee on-chain.
 * The builder fee is included in the order action as: { b: builderAddr, f: feeBps }
 * where f is in tenths of basis points (so 0.10% = 10).
 *
 * This converts our platform fee to the HL builder fee format.
 */
export function leverFeeToHlBuilderCode(tier: FeeTier = 'free'): {
  builderAddress: string;
  feeTenthsOfBps: number;  // HL expects tenths of bps
} {
  const config = FEE_TIERS[tier];
  // Our platformFeeBps is in full bps. HL wants tenths of bps.
  // e.g., 0.10% = 10 bps = 100 tenths-of-bps
  // But HL max is 0.1% for perps = 10 bps = 100 tenths-of-bps
  const feeTenthsOfBps = Math.round(config.platformFeeBps * 10);

  return {
    builderAddress: TREASURY_ADDRESS,
    feeTenthsOfBps,
  };
}

/**
 * Check if the builder address is configured.
 * If not, platform fees won't be captured on-chain.
 */
export function isBuilderConfigured(): boolean {
  return TREASURY_ADDRESS.length > 0 && TREASURY_ADDRESS.startsWith('0x');
}

// ─── Fee Display Helpers ────────────────────────────────────────────────────

export function formatFee(bps: number): string {
  if (bps === 0) return '0%';
  if (bps >= 1) return `${(bps / 100).toFixed(2)}%`;
  return `${(bps / 100).toFixed(3)}%`;
}

export function formatUsd(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}