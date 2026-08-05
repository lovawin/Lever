/**
 * Hyperliquid API helpers — reads + EIP-712 signed writes.
 *
 * Reads use raw HTTP POST to /info (no SDK needed).
 * Writes (order placement, etc.) use phantom-agent EIP-712 signing
 * implemented directly with viem — no SDK dependency.
 *
 * L1 Action signing flow:
 *   1. Serialize action with msgpack
 *   2. Append vault_address (20 bytes, zero-padded) + nonce (8 bytes big-endian)
 *   3. keccak256 hash → connectionId for phantom agent
 *   4. EIP-712 signTypedData with domain { name: "Exchange", version: "1", chainId: 1337 }
 *   5. POST { action, nonce, signature } to /exchange
 */

import { type WalletClient, type Hash, type Hex, hashMessage, keccak256, encodeAbiParameters, hexToBytes, bytesToHex } from "viem";

// ─── Endpoints ────────────────────────────────────────────────────────────

const HL_API = "https://api.hyperliquid.xyz";
const HL_API_TESTNET = "https://api.hyperliquid-testnet.xyz";

function baseUrl(testnet: boolean) {
  return testnet ? HL_API_TESTNET : HL_API;
}

// ─── Types ────────────────────────────────────────────────────────────────

export type PerpMarket = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
};

// ─── Minimal msgpack encoder ──────────────────────────────────────────────
// Only handles the types we need for HL actions: maps with string/number/bool/array values.

function msgpackEncode(obj: unknown): Uint8Array {
  const parts: Uint8Array[] = [];
  encodeValue(obj, parts);
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeValue(val: unknown, parts: Uint8Array[]): void {
  if (val === null || val === undefined) {
    // msgpack nil
    parts.push(new Uint8Array([0xc0]));
  } else if (typeof val === "boolean") {
    parts.push(new Uint8Array([val ? 0xc3 : 0xc2]));
  } else if (typeof val === "number") {
    // Prefer integer if it fits
    if (Number.isInteger(val) && val >= 0 && val <= 0x7f) {
      parts.push(new Uint8Array([val]));
    } else if (Number.isInteger(val) && val >= -0x20 && val < 0) {
      parts.push(new Uint8Array([0x100 + val]));
    } else {
      // Float64
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, false); // big-endian
      parts.push(new Uint8Array([0xcb, ...new Uint8Array(buf)]));
    }
  } else if (typeof val === "string") {
    const encoded = new TextEncoder().encode(val);
    if (encoded.length <= 31) {
      // fixstr
      parts.push(new Uint8Array([0xa0 | encoded.length, ...encoded]));
    } else if (encoded.length <= 0xff) {
      parts.push(new Uint8Array([0xd9, encoded.length, ...encoded]));
    } else {
      // str16
      const len = encoded.length;
      parts.push(new Uint8Array([0xda, (len >> 8) & 0xff, len & 0xff, ...encoded]));
    }
  } else if (val instanceof Uint8Array) {
    // bin8 / bin16
    if (val.length <= 0xff) {
      parts.push(new Uint8Array([0xc4, val.length, ...val]));
    } else {
      const len = val.length;
      parts.push(new Uint8Array([0xc5, (len >> 8) & 0xff, len & 0xff, ...val]));
    }
  } else if (Array.isArray(val)) {
    if (val.length <= 15) {
      parts.push(new Uint8Array([0x90 | val.length]));
    } else if (val.length <= 0xffff) {
      const len = val.length;
      parts.push(new Uint8Array([0xdc, (len >> 8) & 0xff, len & 0xff]));
    } else {
      const len = val.length;
      parts.push(new Uint8Array([0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]));
    }
    for (const item of val) {
      encodeValue(item, parts);
    }
  } else if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length <= 15) {
      parts.push(new Uint8Array([0x80 | entries.length]));
    } else if (entries.length <= 0xffff) {
      const len = entries.length;
      parts.push(new Uint8Array([0xde, (len >> 8) & 0xff, len & 0xff]));
    } else {
      const len = entries.length;
      parts.push(new Uint8Array([0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]));
    }
    for (const [k, v] of entries) {
      encodeValue(k, parts);
      encodeValue(v, parts);
    }
  }
}

// ─── EIP-712 L1 Action Signing ────────────────────────────────────────────

const EIP712_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000" as Hex,
};

const AGENT_TYPE = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
};

/**
 * Sign an L1 action using the phantom-agent EIP-712 construction.
 * This is how Hyperliquid authenticates all trading operations.
 */
async function signL1Action(
  walletClient: WalletClient,
  action: Record<string, unknown>,
  nonce: number,
  isMainnet: boolean,
  vaultAddress?: Hex,
): Promise<{ r: string; s: string; v: number }> {
  // 1. msgpack encode the action
  const actionBytes = msgpackEncode(action);

  // 2. Build the data to hash: actionBytes + vault_address (20 bytes) + nonce (8 bytes big-endian)
  const vaultBytes = vaultAddress
    ? hexToBytes(vaultAddress.toLowerCase().replace(/^0x/, "") as Hex, { size: 20 })
    : new Uint8Array(20);

  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false);

  const dataToHash = new Uint8Array(actionBytes.length + 20 + 8);
  dataToHash.set(actionBytes, 0);
  dataToHash.set(vaultBytes, actionBytes.length);
  dataToHash.set(nonceBytes, actionBytes.length + 20);

  // 3. keccak256 hash → connectionId
  const connectionId = keccak256(dataToHash) as Hex;

  // 4. Build phantom agent
  const agent = {
    source: isMainnet ? "a" : "b",
    connectionId,
  };

  // 5. EIP-712 signTypedData via the wallet
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: EIP712_DOMAIN,
    types: AGENT_TYPE,
    primaryType: "Agent",
    message: agent,
  });

  // 6. Parse signature into r, s, v
  // viem returns a hex signature — 65 bytes: r(32) + s(32) + v(1)
  const sigBytes = hexToBytes(signature);
  const r = `0x${bytesToHex(sigBytes.slice(0, 32))}` as Hex;
  const s = `0x${bytesToHex(sigBytes.slice(32, 64))}` as Hex;
  const v = sigBytes[64];

  return { r, s, v };
}

// ─── Read API ──────────────────────────────────────────────────────────────

export async function getMeta(testnet = true): Promise<{ universe: PerpMarket[] }> {
  const url = baseUrl(testnet) + "/info";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "meta" }),
  });
  if (!r.ok) throw new Error(`meta ${r.status}`);
  return r.json();
}

export async function getAllMids(testnet = true): Promise<Record<string, string>> {
  const url = baseUrl(testnet) + "/info";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  if (!r.ok) throw new Error(`allMids ${r.status}`);
  return r.json();
}

// ─── Place Order ───────────────────────────────────────────────────────────

export type PlaceOrderParams = {
  coin: string;
  isLong: boolean;
  sizeUsd: number;
  address: Hex;
  walletClient: WalletClient;
  testnet?: boolean;
  /** Asset index from meta (auto-fetched if not provided) */
  assetIndex?: number;
  /** Leverage to set before placing order (default: cross, 20x) */
  leverage?: number;
  /** Limit price offset from mid as decimal, e.g. 0.05 = 5% */
  slippageBps?: number;
};

export type OrderResult = {
  status: string;
  response?: {
    type: string;
    data: {
      statuses: Array<{ resting?: { oid: number }; filled?: { totalSz: string; avgPx: string; oid: number }; error?: string }>;
    };
  };
  error?: string;
};

/**
 * Place a market order on Hyperliquid.
 * 
 * Flow:
 *   1. (Optional) Set leverage via updateLeverage
 *   2. Fetch mid price for slippage
 *   3. Build order action
 *   4. Sign with phantom-agent EIP-712
 *   5. POST to /exchange
 */
export async function placeMarketOrder(params: PlaceOrderParams): Promise<OrderResult> {
  const {
    coin,
    isLong,
    sizeUsd,
    address,
    walletClient,
    testnet = true,
    leverage = 20,
    slippageBps = 100, // 1% default
  } = params;

  const apiBase = baseUrl(testnet);

  // 1. Get asset index and mid price
  const [meta, mids] = await Promise.all([getMeta(testnet), getAllMids(testnet)]);

  const assetIndex = params.assetIndex
    ?? meta.universe.findIndex((m) => m.name === coin);
  if (assetIndex < 0) throw new Error(`Unknown coin: ${coin}`);

  const midStr = mids[coin];
  if (!midStr) throw new Error(`No mid price for ${coin}`);

  const mid = parseFloat(midStr);
  const szDecimals = meta.universe[assetIndex].szDecimals;

  // 2. Calculate size and price
  // sizeUsd / mid = number of coins; round to szDecimals
  const sz = parseFloat((sizeUsd / mid).toFixed(szDecimals));
  if (sz <= 0) throw new Error("Size too small");

  // Market order: use IOC with price offset for slippage
  const priceOffset = mid * (slippageBps / 10000);
  const limitPx = isLong
    ? (mid + priceOffset).toFixed(szDecimals + 1) // buy higher
    : (mid - priceOffset).toFixed(szDecimals + 1); // sell lower

  // 3. Set leverage first (cross margin, specified leverage)
  const nonce1 = Date.now();
  const leverageAction = {
    type: "updateLeverage",
    asset: assetIndex,
    isCross: true,
    leverage,
  };

  const leverageSig = await signL1Action(walletClient, leverageAction, nonce1, !testnet);

  const leverageResp = await fetch(apiBase + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: leverageAction,
      nonce: nonce1,
      signature: leverageSig,
    }),
  });

  const leverageResult = await leverageResp.json();
  // Leverage update can fail silently for existing positions — that's OK
  if (leverageResult?.status === "err") {
    console.warn("Leverage update warning:", leverageResult);
  }

  // 4. Place the order
  const nonce2 = Date.now() + 1;
  const orderAction = {
    type: "order",
    orders: [{
      a: assetIndex,
      b: isLong,
      p: limitPx,
      s: sz.toString(),
      r: false,
      t: { limit: { tif: "Ioc" } },
    }],
    grouping: "na",
  };

  const orderSig = await signL1Action(walletClient, orderAction, nonce2, !testnet);

  const orderResp = await fetch(apiBase + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: orderAction,
      nonce: nonce2,
      signature: orderSig,
    }),
  });

  if (!orderResp.ok) {
    const errText = await orderResp.text();
    throw new Error(`Order failed (${orderResp.status}): ${errText}`);
  }

  return orderResp.json();
}

/**
 * Cancel open orders for a given asset.
 */
export async function cancelOrders(
  address: Hex,
  walletClient: WalletClient,
  assetIndex: number,
  orderIds: number[],
  testnet = true,
): Promise<OrderResult> {
  const nonce = Date.now();
  const action = {
    type: "cancel",
    cancels: orderIds.map((oid) => ({ a: assetIndex, o: oid })),
  };

  const sig = await signL1Action(walletClient, action, nonce, !testnet);

  const resp = await fetch(baseUrl(testnet) + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature: sig }),
  });

  if (!resp.ok) throw new Error(`Cancel failed (${resp.status})`);
  return resp.json();
}

// ─── L2 Order Book ─────────────────────────────────────────────────────────

export type L2BookLevel = {
  px: string;   // price
  sz: string;   // total size
  n: number;    // number of orders
};

export type L2Book = {
  coin: string;
  time: number;
  levels: [L2BookLevel[], L2BookLevel[]]; // [bids, asks]
  spread?: string;  // only when nSigFigs is set
};

/**
 * Fetch L2 order book for a coin.
 * nSigFigs controls aggregation: 2=coarse, 5=fine (with mantissa 2 or 5)
 */
export async function getL2Book(coin: string, testnet = true, nSigFigs?: number): Promise<L2Book> {
  const body: Record<string, unknown> = { type: "l2Book", coin };
  if (nSigFigs) body.nSigFigs = nSigFigs;

  const r = await fetch(baseUrl(testnet) + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`l2Book ${r.status}`);
  return r.json();
}

// ─── Asset Contexts (funding, mark price, OI, premium) ──────────────────────

export type AssetCtx = {
  dayNtlVlm: string;    // 24h notional volume
  funding: string;      // current funding rate
  impactPxs: [string, string]; // [bid_impact, ask_impact]
  markPx: string;       // mark price
  midPx: string;         // mid price
  openInterest: string;  // open interest in coins
  oraclePx: string;      // oracle price
  premium: string;       // premium component
  prevDayPx: string;     // previous day price
};

/**
 * Fetch meta + asset contexts for all perpetual markets.
 * Returns [meta, assetCtxs] where assetCtxs[i] corresponds to meta.universe[i].
 */
export async function getMetaAndAssetCtxs(testnet = true): Promise<[
  {
    universe: PerpMarket[];
    marginTables: [number, { description: string; marginTiers: { lowerBound: string; maxLeverage: number }[] }][];
  },
  AssetCtx[]
]> {
  const r = await fetch(baseUrl(testnet) + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  if (!r.ok) throw new Error(`metaAndAssetCtxs ${r.status}`);
  return r.json();
}

// ─── Funding History ────────────────────────────────────────────────────────

export type FundingRateEntry = {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;  // ms timestamp
};

/**
 * Fetch funding rate history for a coin.
 * @param startTime - Start time in ms
 * @param endTime - Optional end time in ms
 */
export async function getFundingHistory(
  coin: string,
  startTime: number,
  endTime?: number,
  testnet = true,
): Promise<FundingRateEntry[]> {
  const body: Record<string, unknown> = { type: "fundingHistory", coin, startTime };
  if (endTime) body.endTime = endTime;

  const r = await fetch(baseUrl(testnet) + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`fundingHistory ${r.status}`);
  return r.json();
}

// ─── Builder Fee (Platform Fee) ────────────────────────────────────────────

/**
 * Hyperliquid Builder Code system for platform fees.
 *
 * How it works:
 * 1. User approves a max builder fee for our address (ApproveBuilderFee action)
 * 2. When placing orders, we include { b: builderAddress, f: feeInTenthsOfBps }
 * 3. Max fee: 0.1% (10 bps) on perps, 1% on spot
 * 4. We claim fees through the referral reward process
 * 5. Each user can have max 10 active builder approvals
 */

// Builder address — set this to your deployed wallet that holds 100+ USDC
// In production, this should be an env variable
const BUILDER_ADDRESS = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUILDER_ADDRESS) || '';

// Default builder fee: 1 bp = 0.01% = 1 tenth of a basis point
// So fee of 10 = 1 basis point = 0.01%
// fee of 100 = 10 bps = 0.1% (max for perps)
const DEFAULT_BUILDER_FEE_BPS = 5; // 0.05% = 5 tenths of a basis point

/**
 * Check the max builder fee a user has approved for our builder address.
 * Returns the max fee in tenths of basis points, or 0 if not approved.
 */
export async function getMaxBuilderFee(
  userAddress: string,
  builderAddress?: string,
  testnet = true,
): Promise<number> {
  const builder = builderAddress || BUILDER_ADDRESS;
  if (!builder) return 0;

  const r = await fetch(baseUrl(testnet) + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "maxBuilderFee", user: userAddress, builder }),
  });
  if (!r.ok) return 0;
  const data = await r.json();
  return typeof data === 'number' ? data : 0;
}

/**
 * Approve a builder fee for a user.
 * This must be signed by the USER's MAIN wallet (not an agent).
 * The user approves a maximum fee that our builder can charge per order.
 *
 * @param maxFee - Maximum fee in tenths of basis points (1 = 0.001%, 10 = 0.01%, 100 = 0.1%)
 */
export async function approveBuilderFee(
  walletClient: WalletClient,
  builderAddress: string,
  maxFee: number = 100, // default 0.1% = max allowed for perps
  testnet = true,
): Promise<{ status: string; response?: any }> {
  const nonce = Date.now();
  const action = {
    type: "approveBuilderFee",
    builder: builderAddress,
    maxFee,
  };

  const sig = await signL1Action(walletClient, action, nonce, !testnet);

  const resp = await fetch(baseUrl(testnet) + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature: sig }),
  });

  if (!resp.ok) throw new Error(`Approve builder fee failed (${resp.status})`);
  return resp.json();
}

/**
 * Remove a builder fee approval.
 */
export async function removeBuilderFee(
  walletClient: WalletClient,
  builderAddress: string,
  testnet = true,
): Promise<{ status: string; response?: any }> {
  const nonce = Date.now();
  const action = {
    type: "approveBuilderFee",
    builder: builderAddress,
    maxFee: 0, // Setting to 0 removes the approval
  };

  const sig = await signL1Action(walletClient, action, nonce, !testnet);

  const resp = await fetch(baseUrl(testnet) + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature: sig }),
  });

  if (!resp.ok) throw new Error(`Remove builder fee failed (${resp.status})`);
  return resp.json();
}

// ─── Update Leverage ──────────────────────────────────────────────────────

export async function updateLeverage(
  address: Hex,
  walletClient: WalletClient,
  assetIndex: number,
  leverage: number,
  isCross = true,
  testnet = true,
): Promise<OrderResult> {
  const nonce = Date.now();
  const action = {
    type: "updateLeverage",
    asset: assetIndex,
    isCross,
    leverage,
  };

  const sig = await signL1Action(walletClient, action, nonce, !testnet);

  const resp = await fetch(baseUrl(testnet) + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature: sig }),
  });

  if (!resp.ok) throw new Error(`Update leverage failed (${resp.status})`);
  return resp.json();
}