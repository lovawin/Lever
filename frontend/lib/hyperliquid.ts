/**
 * Hyperliquid SDK wrapper.
 *
 * Uses @nktkas/hyperliquid v0.33 — InfoClient + ExchangeClient.
 *
 * Read endpoints (no auth): meta, allMids, l2Book
 * Write endpoints (signed): order placement via ExchangeClient
 *
 * For trading, we pass viem's WalletClient from wagmi's useWalletClient() hook.
 * Signing happens in the user's wallet (MetaMask, Rabby, etc.) — never on our server.
 */

import {
  HttpTransport,
  InfoClient,
  ExchangeClient,
} from "@nktkas/hyperliquid";
import type { WalletClient } from "viem";

const HL_MAINNET = "https://api.hyperliquid.xyz";
const HL_TESTNET = "https://api.hyperliquid-testnet.xyz";

function transport(testnet = false) {
  return new HttpTransport({ serverUrl: testnet ? HL_TESTNET : HL_MAINNET });
}

function info(testnet = false) {
  return new InfoClient({ transport: transport(testnet) });
}

export type PerpMarket = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
};

export async function getMeta(testnet = true): Promise<{ universe: PerpMarket[] }> {
  const meta = await info(testnet).perpetuals.getMeta();
  return meta as unknown as { universe: PerpMarket[] };
}

export async function getAllMids(testnet = true): Promise<Record<string, string>> {
  const mids = await info(testnet).allMids();
  return mids as unknown as Record<string, string>;
}

/**
 * Place a market order on Hyperliquid.
 * `walletClient` is viem's WalletClient from wagmi's useWalletClient().
 */
export async function placeMarketOrder(params: {
  coin: string;
  isLong: boolean;
  sizeUsd: number;
  address: `0x${string}`;
  walletClient: WalletClient;
  testnet?: boolean;
}) {
  const { coin, isLong, sizeUsd, address, walletClient, testnet = true } = params;

  const meta = await getMeta(testnet);
  const mids = await getAllMids(testnet);

  const idx = meta.universe.findIndex((u) => u.name === coin);
  if (idx === -1) throw new Error(`unknown coin ${coin}`);

  const mid = parseFloat(mids[coin]);
  if (!mid || Number.isNaN(mid)) throw new Error(`no mid for ${coin}`);

  const szDecimals = meta.universe[idx].szDecimals;
  const sizeCoin = sizeUsd / mid;
  // Round to szDecimals
  const sizeRounded =
    Math.round(sizeCoin * Math.pow(10, szDecimals)) / Math.pow(10, szDecimals);

  const exchange = new ExchangeClient({
    transport: transport(testnet),
    wallet: walletClient as any,
  });

  // Market order via IOC at current mid (small slippage buffer)
  const limitPx = (isLong ? mid * 1.01 : mid * 0.99).toFixed(2);

  const result = await exchange.order({
    orders: [
      {
        a: idx,
        b: isLong,
        p: limitPx,
        s: sizeRounded.toString(),
        r: false,
        t: { limit: { tif: "Ioc" } },
      },
    ],
    grouping: "na",
  });

  return result;
}
