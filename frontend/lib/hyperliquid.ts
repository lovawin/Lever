/**
 * Hyperliquid client wrapper.
 *
 * Uses @nktkas/hyperliquid — the community-maintained TS SDK.
 * Supports read endpoints (no auth) and write endpoints (signed EIP-712).
 *
 * For the frontend MVP, we:
 *   - Read market meta (universe of perps)
 *   - Read all mid prices
 *   - Read user state (positions, fills)
 *   - Place market orders (long/short) — requires a signer (wallet)
 *
 * Write operations need a private key. NEVER ship private keys to the browser.
 * The frontend should:
 *   1. Build the unsigned order client-side
 *   2. Pass to wallet for signing via wagmi's useWalletClient() (MetaMask) or
 *      window.solana.signMessage? (no — HL is EVM only)
 *
 * Hyperliquid only supports EVM wallets (MetaMask, Rabby, etc.) for signing.
 * Solana users would need to bridge — out of scope for MVP.
 */

import { Hyperliquid } from "@nktkas/hyperliquid";

// Public read-only client (no signer = no write capability)
export const hl = new Hyperliquid({
  serverUrl: "https://api.hyperliquid.xyz",
  testnet: false,
});

// Testnet client (paper trading — recommended for MVP)
export const hlTest = new Hyperliquid({
  serverUrl: "https://api.hyperliquid.xyz",
  testnet: true,
});

export type PerpMarket = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
};

export async function getMeta(testnet = false): Promise<{ universe: PerpMarket[] }> {
  const client = testnet ? hlTest : hl;
  const meta = await client.info.perpetuals.getMeta();
  return meta as unknown as { universe: PerpMarket[] };
}

export async function getAllMids(testnet = false): Promise<Record<string, string>> {
  const client = testnet ? hlTest : hl;
  const mids = await client.info.getAllMids();
  return mids as unknown as Record<string, string>;
}

/**
 * Get user's perp state (positions, margin, etc.)
 * Address is the EVM address (0x...).
 */
export async function getUserState(address: string, testnet = false) {
  const client = testnet ? hlTest : hl;
  return await client.info.perpetuals.getUserState({ user: address as `0x${string}` });
}

/**
 * Place a market order.
 * Requires a connected wallet signer (passed in).
 *
 * For MVP: limit-style market order using IOC + market price.
 */
export async function placeMarketOrder(params: {
  coin: string;
  isLong: boolean;
  sizeUsd: number; // notional size in USD
  leverage: number;
  address: `0x${string}`;
  // walletClient from wagmi's useWalletClient()
  walletClient: any;
  testnet?: boolean;
}) {
  const { coin, isLong, sizeUsd, leverage, address, walletClient, testnet = false } = params;

  // Get current mid price for the coin
  const mids = await getAllMids(testnet);
  const mid = parseFloat(mids[coin]);
  if (!mid || Number.isNaN(mid)) {
    throw new Error(`no mid price for ${coin}`);
  }

  // Size in coin units (e.g. number of HYPE tokens)
  const sizeCoin = sizeUsd / mid;

  // Hyperliquid wants the wallet signer wrapped properly
  const transport = testnet
    ? hlTest.config.transport
    : hl.config.transport;

  const client = new Hyperliquid({
    serverUrl: testnet ? "https://api.hyperliquid.xyz" : "https://api.hyperliquid.xyz",
    testnet,
    walletClient, // SDK uses viem wallet client for signing
  });

  const result = await client.exchange.placeOrder({
    orders: [
      {
        coin,
        isLong,
        sz: sizeCoin,
        limitPx: mid, // market = use current mid (cross/slippage handled by HL)
        orderType: { limit: { tif: "Ioc" } }, // IOC = market-like
        reduceOnly: false,
      },
    ],
    grouping: "na",
  });

  return result;
}
