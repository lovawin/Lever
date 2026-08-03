/**
 * Hyperliquid public API helpers (read-only).
 *
 * We deliberately avoid the @nktkas/hyperliquid SDK here because of
 * dependency conflicts at deploy time. For MVP, this file provides:
 *   - getMeta()    — list of perp markets
 *   - getAllMids() — current mid price per coin
 *
 * Trade placement (writes) is currently stubbed — the UI shows a clear
 * "not yet wired" error. To enable real trades, we need to either:
 *   (a) Resolve the SDK dep conflict (lock correct versions), or
 *   (b) Implement the EIP-712 sign + POST /exchange flow ourselves.
 */

const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_INFO_TESTNET = "https://api.hyperliquid-testnet.xyz/info";

export type PerpMarket = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
};

export async function getMeta(testnet = true): Promise<{ universe: PerpMarket[] }> {
  const url = testnet ? HL_INFO_TESTNET : HL_INFO;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "meta" }),
  });
  if (!r.ok) throw new Error(`meta ${r.status}`);
  return r.json();
}

export async function getAllMids(testnet = true): Promise<Record<string, string>> {
  const url = testnet ? HL_INFO_TESTNET : HL_INFO;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  if (!r.ok) throw new Error(`allMids ${r.status}`);
  return r.json();
}

/**
 * Place order stub. Returns a clear "not wired" error so the UI can show it.
 * Real impl: EIP-712 sign the order with viem wallet client, POST to /exchange.
 */
export async function placeMarketOrder(_params: {
  coin: string;
  isLong: boolean;
  sizeUsd: number;
  address: `0x${string}`;
  walletClient: any;
  testnet?: boolean;
}) {
  throw new Error(
    "Trade execution not yet wired — backend signature signing pending. UI is live; reads work; writes coming next deploy."
  );
}
