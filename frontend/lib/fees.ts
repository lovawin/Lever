/**
 * Lever Platform Fee System
 *
 * Three fee points:
 *   1. Open position  — fee on notional (margin × leverage)
 *   2. Close position  — fee on notional (same as open)
 *   3. Profit fee       — % of realized PnL, only when positive
 *
 * Withdrawals are always free (non-custodial).
 *
 * Tiers:
 *   Iron NFT (0.03 ETH)  → 4.5% open/close,  9% profit
 *   Silver NFT (0.6 ETH) → 3.75% open/close, 7.5% profit
 *   Gold NFT (0.1 ETH)  → 2.5% open/close,   5% profit + 15% funding rebate
 *   Diamond NFT (0.3 ETH) → 0% open/close,    0% profit + 25% funding rebate + 25% revenue share
 *
 * Funding rebates and revenue share are distributed from treasury to NFT holders
 * on a periodic basis (weekly).
 */

// ─── Fee Tier Definitions ──────────────────────────────────────────────────

export type FeeTier = 'iron' | 'silver' | 'gold' | 'diamond';

export const FEE_TIERS: Record<FeeTier, {
  label: string;
  color: string;
  openCloseBps: number;       // fee on open & close, in bps (1 bp = 0.01%)
  profitFeePct: number;        // % of positive PnL taken as profit fee
  feeDiscount: number;         // discount vs free tier (for display)
  fundingRebate: number;      // % of funding fees rebated to user
  revenueShare: number;        // % of platform revenue shared with user
  mintPrice: string;
}> = {
  iron: {
    label: 'Iron',
    color: 'text-gray-300',
    openCloseBps: 450,            // 4.5%
    profitFeePct: 9,
    feeDiscount: 10,
    fundingRebate: 0,
    revenueShare: 0,
    mintPrice: '0.03 ETH',
  },
  silver: {
    label: 'Silver',
    color: 'text-gray-200',
    openCloseBps: 375,         // 3.75%
    profitFeePct: 7.5,
    feeDiscount: 25,
    fundingRebate: 0,
    revenueShare: 0,
    mintPrice: '0.06 ETH',
  },
  gold: {
    label: 'Gold',
    color: 'text-yellow-400',
    openCloseBps: 250,            // 2.5%
    profitFeePct: 5,
    feeDiscount: 50,
    fundingRebate: 15,
    revenueShare: 0,
    mintPrice: '0.1 ETH',
  },
  diamond: {
    label: 'Diamond',
    color: 'text-cyan-400',
    openCloseBps: 0,            // 0% — fee-free
    profitFeePct: 0,            // no profit fee
    feeDiscount: 100,
    fundingRebate: 25,
    revenueShare: 25,
    mintPrice: '0.3 ETH',
  },
};

// ─── Fee Calculations ────────────────────────────────────────────────────────

/** Treasury wallet address — platform fees get sent here */
export const TREASURY_ADDRESS = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TREASURY_ADDRESS) || '';

/**
 * Calculate opening fee.
 * Charged on notional when opening a position.
 */
export function calculateOpenFee(
  notionalUsd: number,
  tier: FeeTier = 'iron',
): { feeUsd: number; feeBps: number } {
  const config = FEE_TIERS[tier];
  const feeUsd = notionalUsd * (config.openCloseBps / 10000);
  return { feeUsd, feeBps: config.openCloseBps };
}

/**
 * Calculate closing fee.
 * Same as opening fee — charged on notional when closing.
 */
export function calculateCloseFee(
  notionalUsd: number,
  tier: FeeTier = 'iron',
): { feeUsd: number; feeBps: number } {
  // Same rate as open
  return calculateOpenFee(notionalUsd, tier);
}

/**
 * Calculate profit fee.
 * Only charged on realized PnL when positive (winning trade).
 * Losing trades pay no profit fee.
 */
export function calculateProfitFee(
  pnlUsd: number,
  tier: FeeTier = 'iron',
): { feeUsd: number; feePct: number; applies: boolean } {
  if (pnlUsd <= 0) {
    return { feeUsd: 0, feePct: FEE_TIERS[tier].profitFeePct, applies: false };
  }
  const config = FEE_TIERS[tier];
  const feeUsd = pnlUsd * (config.profitFeePct / 100);
  return { feeUsd, feePct: config.profitFeePct, applies: true };
}

/**
 * Full fee breakdown for a trade (open + close + profit fee).
 * Profit fee is estimated — actual profit fee depends on realized PnL at close.
 */
export function calculateTradeFees(
  notionalUsd: number,
  marginUsd: number,
  tier: FeeTier = 'iron',
  estimatedPnlUsd: number = 0,
  isMaker: boolean = false,
  hlVolumeTier: number = 0,
): {
  // Lever fees
  openFee: number;
  closeFee: number;
  openCloseBps: number;
  profitFeePct: number;
  estimatedProfitFee: number;
  totalLeverFees: number;
  // Venue fees (HL)
  venueFee: number;
  venueBps: number;
  // Totals
  totalFees: number;
  totalBps: number;
  // Comparison
  savingsVsBase: number;
  // Withdrawal
  withdrawalFee: number;
  // Breakdown for display
  breakdown: { label: string; amount: number; rate: string }[];
} {
  const config = FEE_TIERS[tier];

  // Lever fees
  const open = calculateOpenFee(notionalUsd, tier);
  const close = calculateCloseFee(notionalUsd, tier);
  const profit = calculateProfitFee(estimatedPnlUsd, tier);

  // HL venue fees (taker by default)
  const venueFeeSchedule = [
    { maker: 1.5, taker: 4.5 },
    { maker: 1.2, taker: 4.0 },
    { maker: 0.8, taker: 3.5 },
    { maker: 0.4, taker: 3.0 },
    { maker: 0.0, taker: 2.8 },
    { maker: 0.0, taker: 2.6 },
    { maker: 0.0, taker: 2.4 },
  ];
  const hlFees = venueFeeSchedule[hlVolumeTier] || venueFeeSchedule[0];
  const venueBps = isMaker ? hlFees.maker : hlFees.taker;
  const venueFee = notionalUsd * (venueBps / 10000);

  // Totals
  const totalLeverFees = open.feeUsd + close.feeUsd + (profit.applies ? profit.feeUsd : 0);
  const totalFees = totalLeverFees + venueFee;
  const totalBps = config.openCloseBps * 2 + venueBps; // approximate

  // Savings vs free tier
  const baseConfig = FEE_TIERS['iron'];
  const baseOpen = notionalUsd * (baseConfig.openCloseBps / 10000);
  const baseClose = baseOpen;
  const baseProfit = estimatedPnlUsd > 0 ? estimatedPnlUsd * (baseConfig.profitFeePct / 100) : 0;
  const savingsVsFree = (baseOpen + baseClose + baseProfit) - totalLeverFees;

  // Breakdown for display
  const breakdown = [
    { label: 'Open fee', amount: open.feeUsd, rate: config.openCloseBps === 0 ? 'FREE' : `${config.openCloseBps / 100}%` },
    { label: 'Close fee', amount: close.feeUsd, rate: config.openCloseBps === 0 ? 'FREE' : `${config.openCloseBps / 100}%` },
    { label: 'Profit fee', amount: profit.applies ? profit.feeUsd : 0, rate: config.profitFeePct === 0 ? 'FREE' : `${config.profitFeePct}% of gains` },
    { label: 'Venue fee (est.)', amount: venueFee, rate: `${venueBps / 100}%` },
    { label: 'Withdrawal', amount: 0, rate: 'FREE' },
  ];

  return {
    openFee: open.feeUsd,
    closeFee: close.feeUsd,
    openCloseBps: config.openCloseBps,
    profitFeePct: config.profitFeePct,
    estimatedProfitFee: profit.applies ? profit.feeUsd : 0,
    totalLeverFees,
    venueFee,
    venueBps,
    totalFees,
    totalBps,
    savingsVsBase,
    withdrawalFee: 0,
    breakdown,
  };
}

// ─── HL Builder Fee Integration ─────────────────────────────────────────────

/**
 * For HL perps, we use Builder Codes to capture our platform fee on-chain.
 * The builder fee is included in the order action as: { b: builderAddr, f: feeBps }
 * where f is in tenths of basis points (so 0.10% = 10).
 */
export function leverFeeToHlBuilderCode(tier: FeeTier = 'iron'): {
  builderAddress: string;
  feeTenthsOfBps: number;
} {
  const config = FEE_TIERS[tier];
  const feeTenthsOfBps = Math.round(config.openCloseBps * 10);
  return {
    builderAddress: TREASURY_ADDRESS,
    feeTenthsOfBps,
  };
}

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