/**
 * Cross-Chain Bridge — EVM → Solana via deBridge DLN.
 *
 * Lets a user with both an EVM wallet (MetaMask, Rainbow, Rabby) and a real
 * Solana wallet (Phantom, Solflare) bridge USDC from Arbitrum to Solana.
 *
 * This deliberately does NOT auto-generate a Solana keypair on the user's
 * behalf. An earlier version did — storing an "encrypted" secret key in
 * localStorage so the app could sign for the user without a second wallet
 * popup. That's not fixable to be actually safe: the decryption key was
 * derivable from data sitting right next to the ciphertext (the wallet's
 * own public key + a label baked into the JS bundle), so anyone who could
 * run JS on the page — any XSS, any storage-reading browser extension —
 * could decrypt it using the app's own code. There's no purely client-side
 * scheme that avoids this for a key the page itself needs to use to sign.
 *
 * The real fix is to never hold the key at all: require a real wallet.
 *
 * Flow:
 *   1. User connects both an EVM wallet and a Solana wallet
 *   2. Call deBridge create-tx API to bridge USDC from Arbitrum → the
 *      connected Solana wallet's own address
 *   3. Return the unsigned EVM transaction for the user to sign
 *   4. User signs & broadcasts via their EVM wallet
 *   5. Poll deBridge status until the bridge completes
 *   6. The user's own Solana wallet receives USDC — no intermediate custody
 *
 * deBridge API docs: https://docs.debridge.com/
 * Create tx: GET https://dln.debridge.finance/v1.0/dln/order/create-tx
 * Status:    GET https://dln.debridge.finance/v1.0/dln/order/{id}/status
 */

// ─── Constants ────────────────────────────────────────────────────────────

/** deBridge DLN API base URL */
const DLN_API_BASE = "https://dln.debridge.finance";

/** deBridge order status API (separate host) */
const DLN_STATUS_API = "https://dln-api.debridge.finance";

/** Arbitrum chain ID in deBridge's internal numbering */
export const ARBITRUM_CHAIN_ID = 42161;

/** Solana chain ID in deBridge's internal numbering */
export const SOLANA_CHAIN_ID = 7565164;

/** USDC on Arbitrum (native USDC, not USDC.e) */
export const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/** USDC on Solana */
export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** USDC has 6 decimals on both Arbitrum and Solana */
const USDC_DECIMALS = 6;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BridgeOrderParams {
  /** User's EVM wallet address (source) */
  evmAddress: string;
  /** Solana recipient address (destination — the auto-generated wallet) */
  solanaRecipient: string;
  /** USDC amount to bridge (human-readable, e.g. 100 = 100 USDC) */
  usdcAmount: number;
  /** Source chain ID (default: Arbitrum = 42161) */
  srcChainId?: number;
  /** Destination chain ID (default: Solana = 7565164) */
  dstChainId?: number;
}

export interface BridgeTxResponse {
  /** Unsigned EVM transaction data (hex) for MetaMask/Rainbow to sign */
  tx: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
  };
  /** deBridge order ID for status tracking */
  orderId: string;
  /** Estimated output amount on Solana (in raw USDC units) */
  estimation: {
    srcChainTokenIn: {
      amount: string;
      symbol: string;
      decimals: number;
    };
    dstChainTokenOut: {
      amount: string;
      symbol: string;
      decimals: number;
    };
    usdPriceImpact?: number;
    protocolFee?: string;
  };
}

export type BridgeStatus =
  | "Created"
  | "Fulfilled"
  | "SentUnlock"
  | "ClaimedUnlock"
  | "OrderCancelled"
  | "SentOrderCancel"
  | "ClaimedOrderCancel"
  | "None";

export interface BridgeStatusResponse {
  orderId: string;
  status: BridgeStatus;
}

// ─── deBridge Bridge API ────────────────────────────────────────────────────

/**
 * Create a bridge order via deBridge DLN API.
 * Returns the unsigned EVM transaction for the user to sign with MetaMask/Rainbow/Rabby.
 *
 * The API endpoint is GET with query parameters:
 *   srcChainId, srcChainTokenIn, srcChainTokenInAmount,
 *   dstChainId, dstChainTokenOut, dstChainTokenOutAmount,
 *   dstChainTokenOutRecipient, srcChainOrderAuthorityAddress, dstChainOrderAuthorityAddress
 */
export async function bridgeEvmToSolana(
  params: BridgeOrderParams
): Promise<BridgeTxResponse> {
  const {
    evmAddress,
    solanaRecipient,
    usdcAmount,
    srcChainId = ARBITRUM_CHAIN_ID,
    dstChainId = SOLANA_CHAIN_ID,
  } = params;

  if (usdcAmount <= 0) {
    throw new Error("USDC amount must be greater than 0");
  }
  if (!evmAddress || !evmAddress.startsWith("0x")) {
    throw new Error("Valid EVM address required");
  }
  if (!solanaRecipient) {
    throw new Error("Solana recipient address required");
  }

  // Convert human-readable USDC to raw units (6 decimals)
  const srcChainTokenInAmount = Math.round(usdcAmount * 10 ** USDC_DECIMALS).toString();

  // Build the API URL — deBridge create-tx is a GET endpoint
  const url = new URL(`${DLN_API_BASE}/v1.0/dln/order/create-tx`);
  url.searchParams.set("srcChainId", String(srcChainId));
  url.searchParams.set("srcChainTokenIn", USDC_ARBITRUM);
  url.searchParams.set("srcChainTokenInAmount", srcChainTokenInAmount);
  url.searchParams.set("dstChainId", String(dstChainId));
  url.searchParams.set("dstChainTokenOut", USDC_SOLANA);
  url.searchParams.set("dstChainTokenOutAmount", "auto");
  url.searchParams.set("dstChainTokenOutRecipient", solanaRecipient);
  url.searchParams.set("srcChainOrderAuthorityAddress", evmAddress);
  url.searchParams.set("dstChainOrderAuthorityAddress", solanaRecipient);
  url.searchParams.set("prependOperatingExpense", "true");
  url.searchParams.set("enableEstimate", "false");
  url.searchParams.set("senderAddress", evmAddress);

  const r = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`deBridge create-tx failed (${r.status}): ${err}`);
  }

  const data = await r.json();

  // The API returns { estimation, tx, orderId } when all required params are present
  if (!data.tx) {
    throw new Error(
      "deBridge API did not return a transaction. Ensure all parameters are correct."
    );
  }

  // Extract the order ID from the response
  // deBridge includes the orderId in the tx data or as a separate field
  const orderId = data.orderId ?? extractOrderIdFromTx(data.tx);

  return {
    tx: {
      to: data.tx.to,
      data: data.tx.data,
      value: data.tx.value,
      gasLimit: data.tx.gasLimit,
    },
    orderId,
    estimation: {
      srcChainTokenIn: {
        amount: data.estimation?.srcChainTokenIn?.amount ?? srcChainTokenInAmount,
        symbol: data.estimation?.srcChainTokenIn?.symbol ?? "USDC",
        decimals: data.estimation?.srcChainTokenIn?.decimals ?? USDC_DECIMALS,
      },
      dstChainTokenOut: {
        amount: data.estimation?.dstChainTokenOut?.amount ?? "0",
        symbol: data.estimation?.dstChainTokenOut?.symbol ?? "USDC",
        decimals: data.estimation?.dstChainTokenOut?.decimals ?? USDC_DECIMALS,
      },
      usdPriceImpact: data.usdPriceImpact,
      protocolFee: data.protocolFee,
    },
  };
}

/**
 * Poll the deBridge status endpoint until the bridge order is fulfilled.
 *
 * Status progression:
 *   Created → Fulfilled → SentUnlock → ClaimedUnlock (terminal success)
 *   Created → OrderCancelled → SentOrderCancel → ClaimedOrderCancel (terminal cancel)
 *
 * Returns when status is one of: Fulfilled, SentUnlock, ClaimedUnlock
 * Throws on: OrderCancelled, SentOrderCancel, ClaimedOrderCancel, or timeout
 */
export async function waitForBridgeCompletion(
  orderId: string,
  options?: {
    /** Polling interval in ms (default: 5000) */
    pollIntervalMs?: number;
    /** Timeout in ms (default: 600000 = 10 min) */
    timeoutMs?: number;
    /** Optional progress callback */
    onProgress?: (status: BridgeStatus) => void;
  }
): Promise<BridgeStatusResponse> {
  const pollIntervalMs = options?.pollIntervalMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 600_000;
  const onProgress = options?.onProgress;

  const startTime = Date.now();
  const completionStates: BridgeStatus[] = ["Fulfilled", "SentUnlock", "ClaimedUnlock"];
  const cancelStates: BridgeStatus[] = ["OrderCancelled", "SentOrderCancel", "ClaimedOrderCancel"];

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Bridge timeout: order ${orderId} not fulfilled within ${timeoutMs / 1000}s. ` +
        `Check status at https://app.debridge.com/orders`
      );
    }

    let status: BridgeStatus;
    try {
      status = await getBridgeStatus(orderId);
    } catch {
      // Network errors are retriable — wait and try again
      await sleep(pollIntervalMs);
      continue;
    }

    onProgress?.(status);

    if (completionStates.includes(status)) {
      return { orderId, status };
    }

    if (cancelStates.includes(status)) {
      throw new Error(
        `Bridge order ${orderId} was cancelled (status: ${status}). ` +
        `Funds can be reclaimed on the source chain.`
      );
    }

    // Still in progress (Created or None) — wait and poll again
    await sleep(pollIntervalMs);
  }
}

/**
 * Get the current status of a deBridge bridge order.
 */
export async function getBridgeStatus(orderId: string): Promise<BridgeStatus> {
  const url = `${DLN_API_BASE}/v1.0/dln/order/${orderId}/status`;
  const r = await fetch(url);

  if (!r.ok) {
    // 400 with UNKNOWN_ORDER means the order hasn't been indexed yet
    if (r.status === 400) {
      return "None";
    }
    throw new Error(`deBridge status failed (${r.status})`);
  }

  const data = await r.json();
  return data.status as BridgeStatus;
}

/**
 * Get the order ID from a transaction hash (after the EVM tx is broadcast).
 */
export async function getOrderIdByTxHash(txHash: string): Promise<string> {
  const url = `${DLN_STATUS_API}/api/Transaction/${txHash}/orderIds`;
  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Failed to get order ID from tx hash (${r.status})`);
  }

  const data = await r.json();
  if (data.orderIds && data.orderIds.length > 0) {
    return data.orderIds[0];
  }

  throw new Error("No order IDs found for transaction hash");
}

// ─── EVM Transaction Helpers ──────────────────────────────────────────────

/**
 * Send the bridge transaction via the user's EVM wallet (MetaMask/Rainbow/Rabby).
 * Uses window.ethereum to request accounts and send the transaction.
 *
 * Returns the transaction hash.
 */
export async function sendBridgeTx(
  tx: { to: string; data: string; value?: string; gasLimit?: string },
  fromAddress: string
): Promise<string> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask or Rainbow.");
  }

  const ethereum = (window as any).ethereum;

  // Build the transaction object for eth_sendTransaction
  const txParams: Record<string, string> = {
    from: fromAddress,
    to: tx.to,
    data: tx.data,
  };

  if (tx.value && tx.value !== "0" && tx.value !== "0x0") {
    txParams.value = tx.value;
  }

  if (tx.gasLimit) {
    txParams.gas = tx.gasLimit;
  }

  // Send the transaction — returns a tx hash
  const txHash: string = await ethereum.request({
    method: "eth_sendTransaction",
    params: [txParams],
  });

  return txHash;
}

/**
 * Check if the user's EVM wallet is connected.
 */
export function isEvmWalletConnected(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).ethereum?.selectedAddress;
}

/**
 * Get the user's EVM wallet address.
 */
export async function getEvmWalletAddress(): Promise<string | null> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    return null;
  }

  const ethereum = (window as any).ethereum;
  try {
    const accounts: string[] = await ethereum.request({ method: "eth_accounts" });
    return accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

/**
 * Request EVM wallet connection (prompts the user to connect).
 */
export async function connectEvmWallet(): Promise<string> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask or Rainbow.");
  }

  const ethereum = (window as any).ethereum;
  const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
  if (accounts.length === 0) {
    throw new Error("No EVM accounts available");
  }
  return accounts[0];
}

// ─── ERC-20 Approval Helper ────────────────────────────────────────────────

/**
 * Check if the USDC allowance is sufficient for the bridge.
 * The deBridge create-tx response includes the spender address (tx.to).
 */
export async function checkUsdcAllowance(
  owner: string,
  spender: string
): Promise<boolean> {
  if (typeof window === "undefined" || !(window as any).ethereum) return false;

  const ethereum = (window as any).ethereum;

  // ERC-20 allowance(address,uint256) = 0xdd62ed3e
  // balanceOf(address) = 0x70a08231
  const allowanceData =
    "0xdd62ed3e" +
    owner.slice(2).padStart(64, "0") +
    spender.slice(2).padStart(64, "0");

  try {
    const result: string = await ethereum.request({
      method: "eth_call",
      params: [{ to: USDC_ARBITRUM, data: allowanceData }, "latest"],
    });
    const allowance = BigInt(result);
    // Need at least 1 USDC (1e6) allowance to be safe
    return allowance >= 1_000_000n;
  } catch {
    return false;
  }
}

/**
 * Approve USDC spending for the deBridge router.
 * Returns the approval tx hash, or null if already approved.
 */
export async function approveUsdc(
  spender: string,
  fromAddress: string,
  writeContract?: any,
  publicClient?: any
): Promise<string | null> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No EVM wallet found");
  }

  // Check existing allowance first
  const hasAllowance = await checkUsdcAllowance(fromAddress, spender);
  if (hasAllowance) return null;

  // Use wagmi's writeContract if available (handles gas estimation properly)
  if (writeContract && publicClient) {
    const USDC_ABI = [{
      inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
      name: "approve",
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable",
      type: "function"
    }];

    const hash = await writeContract({
      address: USDC_ARBITRUM,
      abi: USDC_ABI,
      functionName: "approve",
      args: [spender, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // Fallback: raw eth_sendTransaction with manual gas estimation
  const ethereum = (window as any).ethereum;
  const spenderPadded = spender.toLowerCase().slice(2).padStart(64, "0");
  const maxUint256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const approveData = "0x095ea7b3" + spenderPadded + maxUint256;

  // Estimate gas first
  let gasLimit = "0x100000";
  try {
    const estimate = await ethereum.request({
      method: "eth_estimateGas",
      params: [{ from: fromAddress, to: USDC_ARBITRUM, data: approveData }],
    });
    if (estimate) gasLimit = estimate;
  } catch {}

  const txHash: string = await ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: fromAddress, to: USDC_ARBITRUM, data: approveData, gasLimit }],
  });

  return txHash;
}

// ─── Utility ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try to extract the orderId from the transaction data.
 * deBridge encodes the order ID in the calldata of the DlnSource contract call.
 */
function extractOrderIdFromTx(tx: { to: string; data: string }): string {
  // The createOrder call on DlnSource includes the order ID as a parameter.
  // In practice, the deBridge API returns orderId as a top-level field.
  // If it's missing, we'll need to get it from the tx hash after broadcasting.
  // Return empty string — we'll use getOrderIdByTxHash instead.
  return "";
}

