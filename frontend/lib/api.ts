/**
 * Lever Backend API Client
 *
 * Connects to our FastAPI backend for:
 * - Auth (wallet sign-in)
 * - Balance tracking
 * - Deposit/Withdraw
 * - Order placement + close position
 * - Fee info + preview
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
  notional: number;
  open_fee: number;
  venue_fee_est: number;
  total_deducted: number;
  status: string;
  fill_price: number | null;
  tx_hash: string | null;
};

export type ClosePositionResult = {
  position_id: string;
  closed_size: number;
  close_fee: number;
  profit_fee: number;
  pnl: number;
  net_payout: number;
  status: string;
  tx_hash: string | null;
};

export type FeeInfo = {
  tier: FeeTier;
  open_close_bps: number;
  open_close_pct: number;
  profit_fee_pct: number;
  funding_rebate_pct: number;
  revenue_share_pct: number;
  venue_taker_bps: number;
  venue_maker_bps: number;
  withdrawal_fee_bps: number;
  withdrawal_note: string;
};

export type FeePreview = {
  tier: FeeTier;
  open_fee: { amount: number; rate: string };
  close_fee: { amount: number; rate: string };
  profit_fee: { amount: number; rate: string; applies: boolean; note: string };
  venue_fee_est: { amount: number; rate: string };
  total_lever_fees: number;
  total_all_fees: number;
  withdrawal_fee: number;
};

// ─── API Client ─────────────────────────────────────────────────────────────

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== 'undefined' && window.localStorage) {
    if (token) {
      localStorage.setItem("lever_token", token);
    } else {
      localStorage.removeItem("lever_token");
    }
  }
}

export function getAuthToken(): string | null {
  if (!authToken && typeof window !== 'undefined' && window.localStorage) {
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

// ─── Close Position ──────────────────────────────────────────────────────────

export async function closePosition(
  positionId: string,
  closeSizeUsd?: number
): Promise<ClosePositionResult> {
  return apiFetch("/api/position/close", {
    method: "POST",
    body: JSON.stringify({
      position_id: positionId,
      close_size_usd: closeSizeUsd,
    }),
  });
}

// ─── Positions ───────────────────────────────────────────────────────────────

export async function getPositions(): Promise<any> {
  return apiFetch("/api/positions");
}

// ─── Vault ───────────────────────────────────────────────────────────────────

export type VaultInfo = {
  status: string;
  vault_address: string | null;
  solvency: {
    vault_balance: number;
    total_deposits: number;
    deficit: number;
    solvent: boolean;
  } | null;
  fee_params: Record<string, any> | null;
};

export type VaultBalance = {
  address: string;
  vault_balance_usdc: number;
  wallet_balance_usdc: number;
  vault_allowance_usdc: number;
};

export async function getVaultInfo(): Promise<VaultInfo> {
  return apiFetch("/api/vault/info");
}

export async function getVaultBalance(address: string): Promise<VaultBalance> {
  return apiFetch(`/api/vault/balance/${address}`);
}

// ─── Fees ────────────────────────────────────────────────────────────────────

export async function getFeeInfo(): Promise<FeeInfo> {
  return apiFetch("/api/fees");
}

export async function previewFees(
  notionalUsd: number,
  marginUsd: number,
  estimatedPnlUsd: number = 0,
  tier: FeeTier = "free"
): Promise<FeePreview> {
  return apiFetch("/api/fees/preview", {
    method: "POST",
    body: JSON.stringify({
      notional_usd: notionalUsd,
      margin_usd: marginUsd,
      estimated_pnl_usd: estimatedPnlUsd,
      tier,
    }),
  });
}