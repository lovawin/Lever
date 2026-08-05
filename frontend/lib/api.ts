/**
 * Lever Backend API Client
 *
 * Connects to our FastAPI backend for:
 * - Auth (wallet sign-in)
 * - Balance tracking
 * - Deposit/Withdraw
 * - Order placement
 * - Fee info
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://tbb-site.onrender.com";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeeTier = "free" | "iron" | "silver" | "gold" | "diamond";

export type AuthChallenge = {
  message: string;
  nonce: string;
};

export type SessionInfo = {
  token: string;
  address: string;
  fee_tier: FeeTier;
};

export type BalanceInfo = {
  address: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  fee_tier: FeeTier;
};

export type DepositAddress = {
  address: string;
  memo: string | null;
  network: string;
  asset: string;
};

export type OrderResult = {
  id: string;
  coin: string;
  side: string;
  size_usd: number;
  leverage: number;
  platform_fee: number;
  venue_fee_est: number;
  total_fee: number;
  status: string;
  fill_price: number | null;
  fill_size: number | null;
};

export type FeeInfo = {
  tier: FeeTier;
  platform_fee_bps: number;
  platform_fee_pct: number;
  discount_pct: number;
  funding_rebate_pct: number;
  venue_fee_bps: number;
  withdrawal_fee_bps: number;
  withdrawal_fee_pct: number;
  withdrawal_note: string;
};

// ─── API Client ─────────────────────────────────────────────────────────────

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("lever_token", token);
  } else {
    localStorage.removeItem("lever_token");
  }
}

export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem("lever_token");
  }
  return authToken;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error ${res.status}`);
  }

  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function requestChallenge(address: string): Promise<AuthChallenge> {
  return apiFetch("/api/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export async function verifyAuth(
  address: string,
  signature: string,
  message: string
): Promise<SessionInfo> {
  const result = await apiFetch<SessionInfo>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ address, signature, message }),
  });
  setAuthToken(result.token);
  return result;
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export async function getBalance(): Promise<BalanceInfo> {
  return apiFetch("/api/balance");
}

// ─── Deposit ─────────────────────────────────────────────────────────────────

export async function getDepositAddress(): Promise<DepositAddress> {
  return apiFetch("/api/deposit/address");
}

export async function confirmDeposit(txHash: string, amount: number): Promise<{
  status: string;
  amount: number;
  new_balance: number;
}> {
  return apiFetch("/api/deposit/confirm", {
    method: "POST",
    body: JSON.stringify({ tx_hash: txHash, amount }),
  });
}

// ─── Withdraw ────────────────────────────────────────────────────────────────

export async function requestWithdrawal(
  amount: number,
  destination: string,
  asset = "USDC"
): Promise<{
  id: string;
  amount: number;
  destination: string;
  status: string;
  fee: number;
}> {
  return apiFetch("/api/withdraw", {
    method: "POST",
    body: JSON.stringify({ amount, destination, asset }),
  });
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function placeLeverOrder(
  coin: string,
  side: "long" | "short",
  sizeUsd: number,
  leverage: number
): Promise<OrderResult> {
  return apiFetch("/api/order", {
    method: "POST",
    body: JSON.stringify({
      coin,
      side,
      size_usd: sizeUsd,
      leverage,
    }),
  });
}

// ─── Positions ───────────────────────────────────────────────────────────────

export async function getPositions(): Promise<any> {
  return apiFetch("/api/positions");
}

// ─── Fees ────────────────────────────────────────────────────────────────────

export async function getFeeInfo(): Promise<FeeInfo> {
  return apiFetch("/api/fees");
}