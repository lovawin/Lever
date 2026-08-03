/**
 * Hyperliquid positions and account data.
 *
 * Uses the public info endpoint directly (no SDK needed) so we don't depend
 * on full SDK install. Works for both testnet and mainnet.
 */

const HL_INFO = "https://api.hyperliquid.xyz/info";
const HL_INFO_TESTNET = "https://api.hyperliquid-testnet.xyz/info";

export type AssetPosition = {
  position: {
    coin: string;
    szi: string; // signed size: positive = long, negative = short
    leverage: { type: string; value: number };
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    returnOnEquity: string;
    liquidationPx: string | null;
    marginUsed: string;
    maxLeverage: number;
    cumFunding: { allTime: string; sinceOpen: string; sinceChange: string };
  };
  type: string;
};

export type ClearinghouseState = {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: AssetPosition[];
  time: number;
};

export type Fill = {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A"; // B = buy, A = sell (ask)
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken: string;
  twapId: number | null;
};

export async function getClearinghouseState(
  address: string,
  testnet = true
): Promise<ClearinghouseState> {
  const url = testnet ? HL_INFO_TESTNET : HL_INFO;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
  });
  if (!r.ok) throw new Error(`clearinghouseState ${r.status}`);
  return r.json();
}

export async function getUserFills(address: string, testnet = true, limit = 50): Promise<Fill[]> {
  const url = testnet ? HL_INFO_TESTNET : HL_INFO;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "userFills", user: address, aggregateByTime: false }),
  });
  if (!r.ok) throw new Error(`userFills ${r.status}`);
  const data = (await r.json()) as Fill[];
  // Return most recent first
  return (data ?? [])
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

export async function getOpenOrders(address: string, testnet = true) {
  const url = testnet ? HL_INFO_TESTNET : HL_INFO;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "openOrders", user: address }),
  });
  if (!r.ok) throw new Error(`openOrders ${r.status}`);
  return r.json();
}
