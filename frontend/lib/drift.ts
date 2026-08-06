/**
 * Drift Protocol Integration — Solana Perps
 *
 * Drift is the primary Solana perps DEX. Supports long AND short
 * on ~50+ pairs including major memes.
 *
 * API: Read market data via REST (gateway), trade via Solana tx + Drift SDK
 */

// ─── Drift Perp Markets (mainnet) ────────────────────────────────────────────
// Sourced from @drift-labs/sdk perpMarkets.ts

export type DriftMarketCategory = 'L1' | 'L2' | 'Meme' | 'Dog' | 'Solana' | 'Infra' | 'Payment' | 'Exchange' | 'Oracle' | 'Lending' | 'Bridge' | 'Data' | 'MEV' | 'Equity' | 'Prediction' | 'AI' | 'DePIN';

export interface DriftPerpMarket {
  symbol: string;           // e.g. 'SOL-PERP'
  baseAssetSymbol: string;  // e.g. 'SOL'
  fullName: string;         // e.g. 'Solana'
  marketIndex: number;
  categories: DriftMarketCategory[];
  isMeme: boolean;
}

export const DRIFT_PERP_MARKETS: DriftPerpMarket[] = [
  // Major L1/L2
  { symbol: 'SOL-PERP', baseAssetSymbol: 'SOL', fullName: 'Solana', marketIndex: 0, categories: ['L1', 'Infra', 'Solana'], isMeme: false },
  { symbol: 'BTC-PERP', baseAssetSymbol: 'BTC', fullName: 'Bitcoin', marketIndex: 1, categories: ['L1', 'Payment'], isMeme: false },
  { symbol: 'ETH-PERP', baseAssetSymbol: 'ETH', fullName: 'Ethereum', marketIndex: 2, categories: ['L1', 'Infra'], isMeme: false },
  { symbol: 'APT-PERP', baseAssetSymbol: 'APT', fullName: 'Aptos', marketIndex: 3, categories: ['L1', 'Infra'], isMeme: false },
  { symbol: 'POL-PERP', baseAssetSymbol: 'POL', fullName: 'Polygon', marketIndex: 5, categories: ['L2', 'Infra'], isMeme: false },
  { symbol: 'ARB-PERP', baseAssetSymbol: 'ARB', fullName: 'Arbitrum', marketIndex: 6, categories: ['L2', 'Infra'], isMeme: false },
  { symbol: 'AVAX-PERP', baseAssetSymbol: 'AVAX', fullName: 'Avalanche', marketIndex: 22, categories: ['L1'], isMeme: false },
  { symbol: 'SUI-PERP', baseAssetSymbol: 'SUI', fullName: 'Sui', marketIndex: 9, categories: ['L1'], isMeme: false },
  { symbol: 'SEI-PERP', baseAssetSymbol: 'SEI', fullName: 'Sei', marketIndex: 21, categories: ['L1'], isMeme: false },
  { symbol: 'INJ-PERP', baseAssetSymbol: 'INJ', fullName: 'Injective', marketIndex: 15, categories: ['L1', 'Exchange'], isMeme: false },
  { symbol: 'BNB-PERP', baseAssetSymbol: 'BNB', fullName: 'BNB', marketIndex: 8, categories: ['Exchange'], isMeme: false },
  { symbol: 'XRP-PERP', baseAssetSymbol: 'XRP', fullName: 'XRP', marketIndex: 13, categories: ['Payments'], isMeme: false },
  { symbol: 'LINK-PERP', baseAssetSymbol: 'LINK', fullName: 'Chainlink', marketIndex: 16, categories: ['Oracle'], isMeme: false },
  { symbol: 'DOGE-PERP', baseAssetSymbol: 'DOGE', fullName: 'Doge', marketIndex: 7, categories: ['Meme', 'Dog'], isMeme: true },
  { symbol: 'LTC-PERP', baseAssetSymbol: 'LTC', fullName: 'Litecoin', marketIndex: -1, categories: ['Payment'], isMeme: false },
  { symbol: 'ADA-PERP', baseAssetSymbol: 'ADA', fullName: 'Cardano', marketIndex: -1, categories: ['L1'], isMeme: false },
  { symbol: 'TON-PERP', baseAssetSymbol: 'TON', fullName: 'Toncoin', marketIndex: -1, categories: ['L1'], isMeme: false },
  { symbol: 'RENDER-PERP', baseAssetSymbol: 'RENDER', fullName: 'Render', marketIndex: 12, categories: ['Infra'], isMeme: false },
  { symbol: 'JTO-PERP', baseAssetSymbol: 'JTO', fullName: 'Jito', marketIndex: 20, categories: ['MEV'], isMeme: false },
  { symbol: 'TIA-PERP', baseAssetSymbol: 'TIA', fullName: 'Celestia', marketIndex: 19, categories: ['Data'], isMeme: false },
  { symbol: 'W-PERP', baseAssetSymbol: 'W', fullName: 'Wormhole', marketIndex: 23, categories: ['Bridge'], isMeme: false },
  { symbol: 'PYTH-PERP', baseAssetSymbol: 'PYTH', fullName: 'Pyth', marketIndex: 18, categories: ['Oracle'], isMeme: false },
  { symbol: 'KMNO-PERP', baseAssetSymbol: 'KMNO', fullName: 'Kamino', marketIndex: 24, categories: ['Lending'], isMeme: false },
  { symbol: 'OP-PERP', baseAssetSymbol: 'OP', fullName: 'Optimism', marketIndex: 11, categories: ['L2', 'Infra'], isMeme: false },
  { symbol: 'HNT-PERP', baseAssetSymbol: 'HNT', fullName: 'Helium', marketIndex: 14, categories: ['DePIN'], isMeme: false },
  { symbol: 'DRIFT-PERP', baseAssetSymbol: 'DRIFT', fullName: 'Drift', marketIndex: -1, categories: ['Exchange'], isMeme: false },
  { symbol: 'JUP-PERP', baseAssetSymbol: 'JUP', fullName: 'Jupiter', marketIndex: -1, categories: ['Exchange', 'Solana'], isMeme: false },
  { symbol: 'RAY-PERP', baseAssetSymbol: 'RAY', fullName: 'Raydium', marketIndex: -1, categories: ['Exchange', 'Solana'], isMeme: false },
  { symbol: 'RLB-PERP', baseAssetSymbol: 'RLB', fullName: 'Rollbit', marketIndex: 17, categories: ['Exchange'], isMeme: false },
  { symbol: 'PAXG-PERP', baseAssetSymbol: 'PAXG', fullName: 'PAX Gold', marketIndex: -1, categories: ['Payment'], isMeme: false },
  { symbol: 'ZEC-PERP', baseAssetSymbol: 'ZEC', fullName: 'Zcash', marketIndex: -1, categories: ['Payment'], isMeme: false },
  { symbol: 'MNT-PERP', baseAssetSymbol: 'MNT', fullName: 'Mantle', marketIndex: -1, categories: ['L2'], isMeme: false },
  { symbol: 'DYM-PERP', baseAssetSymbol: 'DYM', fullName: 'Dymension', marketIndex: -1, categories: ['L1'], isMeme: false },
  { symbol: 'NVDA-PERP', baseAssetSymbol: 'NVDA', fullName: 'Nvidia', marketIndex: 29, categories: ['Equity'], isMeme: false },
  { symbol: 'TAO-PERP', baseAssetSymbol: 'TAO', fullName: 'Bittensor', marketIndex: -1, categories: ['AI'], isMeme: false },
  { symbol: 'IO-PERP', baseAssetSymbol: 'IO', fullName: 'io.net', marketIndex: -1, categories: ['DePIN'], isMeme: false },
  { symbol: 'IP-PERP', baseAssetSymbol: 'IP', fullName: 'Story', marketIndex: -1, categories: ['L1'], isMeme: false },
  { symbol: 'LIT-PERP', baseAssetSymbol: 'LIT', fullName: 'Litentry', marketIndex: -1, categories: ['Infra'], isMeme: false },
  { symbol: 'TNSR-PERP', baseAssetSymbol: 'TNSR', fullName: 'Tensor', marketIndex: -1, categories: ['Exchange', 'Solana'], isMeme: false },
  { symbol: 'XPL-PERP', baseAssetSymbol: 'XPL', fullName: 'Apex', marketIndex: -1, categories: ['L2'], isMeme: false },
  { symbol: 'KAITO-PERP', baseAssetSymbol: 'KAITO', fullName: 'Kaito', marketIndex: -1, categories: ['AI'], isMeme: false },

  // Memes on Drift
  { symbol: '1MBONK-PERP', baseAssetSymbol: '1MBONK', fullName: 'Bonk', marketIndex: 4, categories: ['Meme', 'Dog', 'Solana'], isMeme: true },
  { symbol: '1MPEPE-PERP', baseAssetSymbol: '1MPEPE', fullName: 'Pepe', marketIndex: 10, categories: ['Meme'], isMeme: true },
  { symbol: '1KWEN-PERP', baseAssetSymbol: '1KWEN', fullName: 'Wen', marketIndex: 25, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'WIF-PERP', baseAssetSymbol: 'WIF', fullName: 'dogwifhat', marketIndex: -1, categories: ['Meme', 'Dog', 'Solana'], isMeme: true },
  { symbol: 'POPCAT-PERP', baseAssetSymbol: 'POPCAT', fullName: 'Popcat', marketIndex: -1, categories: ['Meme', 'Cat', 'Solana'], isMeme: true },
  { symbol: 'FARTCOIN-PERP', baseAssetSymbol: 'FARTCOIN', fullName: 'Fartcoin', marketIndex: -1, categories: ['Meme'], isMeme: true },
  { symbol: 'GOAT-PERP', baseAssetSymbol: 'GOAT', fullName: 'Goatseus', marketIndex: -1, categories: ['Meme', 'AI'], isMeme: true },
  { symbol: 'PNUT-PERP', baseAssetSymbol: 'PNUT', fullName: 'Peanut', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'PENGU-PERP', baseAssetSymbol: 'PENGU', fullName: 'Pudgy Penguins', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'TRUMP-PERP', baseAssetSymbol: 'TRUMP', fullName: 'Trump', marketIndex: -1, categories: ['Meme', 'PolitiFi'], isMeme: true },
  { symbol: 'MELANIA-PERP', baseAssetSymbol: 'MELANIA', fullName: 'Melania', marketIndex: -1, categories: ['Meme', 'PolitiFi'], isMeme: true },
  { symbol: 'MICHI-PERP', baseAssetSymbol: 'MICHI', fullName: 'Michi', marketIndex: -1, categories: ['Meme', 'Cat', 'Solana'], isMeme: true },
  { symbol: 'MOTHER-PERP', baseAssetSymbol: 'MOTHER', fullName: 'Mother', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'MOODENG-PERP', baseAssetSymbol: 'MOODENG', fullName: 'Moo Deng', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'FWOG-PERP', baseAssetSymbol: 'FWOG', fullName: 'Fwog', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: '1KMEW-PERP', baseAssetSymbol: '1KMEW', fullName: 'Mew', marketIndex: -1, categories: ['Meme', 'Cat', 'Solana'], isMeme: true },
  { symbol: '1KMON-PERP', baseAssetSymbol: '1KMON', fullName: 'Monke', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: '1KPUMP-PERP', baseAssetSymbol: '1KPUMP', fullName: 'Pump', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'PUMP-PERP', baseAssetSymbol: 'PUMP', fullName: 'Pump.fun', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'CLOUD-PERP', baseAssetSymbol: 'CLOUD', fullName: 'Cloud', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'AI16Z-PERP', baseAssetSymbol: 'AI16Z', fullName: 'ai16z', marketIndex: -1, categories: ['Meme', 'AI'], isMeme: true },
  { symbol: 'HYPE-PERP', baseAssetSymbol: 'HYPE', fullName: 'Hyperliquid', marketIndex: -1, categories: ['Exchange'], isMeme: false },
  { symbol: 'ME-PERP', baseAssetSymbol: 'ME', fullName: 'Magic Eden', marketIndex: -1, categories: ['Exchange', 'Solana'], isMeme: false },
  { symbol: 'MET-PERP', baseAssetSymbol: 'MET', fullName: 'Meteora', marketIndex: -1, categories: ['Exchange', 'Solana'], isMeme: false },
  { symbol: 'LAUNCHCOIN-PERP', baseAssetSymbol: 'LAUNCHCOIN', fullName: 'Launch Coin', marketIndex: -1, categories: ['Meme', 'Solana'], isMeme: true },
  { symbol: 'DBR-PERP', baseAssetSymbol: 'DBR', fullName: 'Debridge', marketIndex: -1, categories: ['Bridge'], isMeme: false },
  { symbol: '2Z-PERP', baseAssetSymbol: '2Z', fullName: '2Z', marketIndex: -1, categories: ['Solana'], isMeme: false },
  { symbol: 'BP-PERP', baseAssetSymbol: 'BP', fullName: 'BP', marketIndex: -1, categories: ['Solana'], isMeme: false },
  { symbol: 'ASTER-PERP', baseAssetSymbol: 'ASTER', fullName: 'Aster', marketIndex: -1, categories: ['Exchange'], isMeme: false },
  { symbol: 'BERA-PERP', baseAssetSymbol: 'BERA', fullName: 'Berachain', marketIndex: -1, categories: ['L1'], isMeme: false },
  { symbol: 'ZEX-PERP', baseAssetSymbol: 'ZEX', fullName: 'Zex', marketIndex: -1, categories: ['Solana'], isMeme: false },
];

// Quick lookup: does Drift have perps for this token?
const DRIFT_SYMBOL_MAP = new Map(
  DRIFT_PERP_MARKETS.map(m => [m.baseAssetSymbol.toUpperCase(), m])
);

/**
 * Check if a token has Drift perps available.
 */
export function hasDriftPerp(symbol: string): boolean {
  return DRIFT_SYMBOL_MAP.has(symbol.toUpperCase());
}

/**
 * Get Drift perp market info for a token.
 */
export function getDriftMarket(symbol: string): DriftPerpMarket | undefined {
  return DRIFT_SYMBOL_MAP.get(symbol.toUpperCase());
}

/**
 * Get all Drift meme perp markets.
 */
export function getDriftMemeMarkets(): DriftPerpMarket[] {
  return DRIFT_PERP_MARKETS.filter(m => m.isMeme);
}

/**
 * Search Drift markets by name or symbol.
 */
export function searchDriftMarkets(query: string): DriftPerpMarket[] {
  const q = query.toLowerCase();
  return DRIFT_PERP_MARKETS.filter(m =>
    m.baseAssetSymbol.toLowerCase().includes(q) ||
    m.fullName.toLowerCase().includes(q) ||
    m.symbol.toLowerCase().includes(q)
  );
}

// ─── Drift API Constants ────────────────────────────────────────────────────

export const DRIFT_PROGRAM_ID = 'dRiftyHA39MWEi3m9HuxDgBqBksGq3b3Nv8m8E6jDgPv';
export const DRIFT_API_URL = 'https://api.drift.trade';
export const DRIFT_RPC_URL = 'https://api.mainnet-beta.solana.com';

/**
 * Drift perp market metadata (for UI display).
 * We hardcode the known ones and fall back to generic.
 */
export const DRIFT_MARKET_META: Record<string, { maxLeverage: number; minSize: number }> = {
  'SOL-PERP': { maxLeverage: 20, minSize: 0.1 },
  'BTC-PERP': { maxLeverage: 50, minSize: 0.001 },
  'ETH-PERP': { maxLeverage: 20, minSize: 0.01 },
  'DOGE-PERP': { maxLeverage: 10, minSize: 100 },
  '1MBONK-PERP': { maxLeverage: 10, minSize: 1000 },
  '1MPEPE-PERP': { maxLeverage: 10, minSize: 1000 },
  'WIF-PERP': { maxLeverage: 10, minSize: 1 },
  'POPCAT-PERP': { maxLeverage: 10, minSize: 1 },
  // Default for unknown markets
  _default: { maxLeverage: 10, minSize: 1 },
};

export function getDriftMarketMeta(symbol: string) {
  return DRIFT_MARKET_META[symbol] || DRIFT_MARKET_META._default;
}