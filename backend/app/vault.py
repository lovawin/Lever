"""
LeverVault contract integration.

On-chain vault on Arbitrum for non-custodial USDC deposits.
Backend operates as a vault operator (places/closes positions).

Architecture:
  - Users deposit USDC into the vault contract
  - Backend reads balances directly from the contract (no DB needed for balances)
  - Backend (operator) calls openPosition/closePosition on the vault
  - Users can withdraw anytime, even if contract is paused (emergencyWithdraw)
  - Withdrawals are FREE — no fee gating

Required env vars:
  VAULT_ADDRESS  — deployed LeverVault contract address on Arbitrum
  ARBITRUM_RPC   — Arbitrum RPC URL (default: https://arb1.arbitrum.io/rpc)
  OPERATOR_KEY   — Private key for the vault operator (backend)
"""

import os
from web3 import Web3
from eth_account import Account

# ─── Config ──────────────────────────────────────────────────────────────────

ARBITRUM_RPC = os.getenv("ARBITRUM_RPC", "https://arb1.arbitrum.io/rpc")
VAULT_ADDRESS = os.getenv("VAULT_ADDRESS", "")
OPERATOR_KEY = os.getenv("OPERATOR_KEY", "")

# Arbitrum USDC (native)
USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
USDC_DECIMALS = 6

# ─── LeverVault ABI ──────────────────────────────────────────────────────────

VAULT_ABI = [
    {"inputs": [{"name": "amount", "type": "uint256"}], "name": "deposit", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "amount", "type": "uint256"}], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "withdrawAll", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "emergencyWithdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "user", "type": "address"},
        {"name": "margin", "type": "uint256"},
        {"name": "openFee", "type": "uint256"},
        {"name": "coin", "type": "string"},
        {"name": "isLong", "type": "bool"},
        {"name": "leverage", "type": "uint256"},
    ], "name": "openPosition", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [
        {"name": "user", "type": "address"},
        {"name": "margin", "type": "uint256"},
        {"name": "pnl", "type": "int256"},
        {"name": "closeFee", "type": "uint256"},
        {"name": "profitFee", "type": "uint256"},
        {"name": "coin", "type": "string"},
        {"name": "isLong", "type": "bool"},
    ], "name": "closePosition", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "user", "type": "address"}], "name": "balances", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "totalDeposits", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "USDC", "outputs": [{"name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "treasury", "outputs": [{"name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "hlMasterAccount", "outputs": [{"name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "openCloseFeeBps", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "profitFeeBps", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "isSolvent", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getSolvencyInfo", "outputs": [
        {"name": "vaultBalance", "type": "uint256"},
        {"name": "totalDeposits", "type": "uint256"},
        {"name": "deficit", "type": "uint256"},
        {"name": "solvent", "type": "bool"},
    ], "stateMutability": "view", "type": "function"},
    {"inputs": [
        {"name": "user", "type": "address"},
        {"name": "operator", "type": "address"},
        {"name": "status", "type": "bool"},
    ], "name": "setOperator", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "paused", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "user", "type": "address"},
        {"indexed": False, "name": "amount", "type": "uint256"},
    ], "name": "Deposited", "type": "event"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "user", "type": "address"},
        {"indexed": False, "name": "amount", "type": "uint256"},
    ], "name": "Withdrawn", "type": "event"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "user", "type": "address"},
        {"indexed": False, "name": "margin", "type": "uint256"},
        {"indexed": False, "name": "openFee", "type": "uint256"},
        {"indexed": False, "name": "coin", "type": "string"},
        {"indexed": False, "name": "isLong", "type": "bool"},
        {"indexed": False, "name": "leverage", "type": "uint256"},
    ], "name": "PositionOpened", "type": "event"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "user", "type": "address"},
        {"indexed": False, "name": "margin", "type": "uint256"},
        {"indexed": False, "name": "pnl", "type": "int256"},
        {"indexed": False, "name": "closeFee", "type": "uint256"},
        {"indexed": False, "name": "profitFee", "type": "uint256"},
        {"indexed": False, "name": "coin", "type": "string"},
        {"indexed": False, "name": "isLong", "type": "bool"},
    ], "name": "PositionClosed", "type": "event"},
]

# ─── USDC ABI (minimal) ──────────────────────────────────────────────────────

USDC_ABI = [
    {"inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}], "name": "allowance", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
    {"anonymous": False, "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ], "name": "Transfer", "type": "event"},
]

# ─── Connection ──────────────────────────────────────────────────────────────

_w3 = None
_vault_contract = None
_usdc_contract = None
_operator_account = None


def get_w3() -> Web3:
    global _w3
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(ARBITRUM_RPC))
    return _w3


def get_vault():
    global _vault_contract
    if _vault_contract is None and VAULT_ADDRESS:
        w3 = get_w3()
        _vault_contract = w3.eth.contract(
            address=Web3.to_checksum_address(VAULT_ADDRESS),
            abi=VAULT_ABI,
        )
    return _vault_contract


def get_usdc():
    global _usdc_contract
    if _usdc_contract is None:
        w3 = get_w3()
        _usdc_contract = w3.eth.contract(
            address=Web3.to_checksum_address(USDC_ARB),
            abi=USDC_ABI,
        )
    return _usdc_contract


def get_operator() -> Account | None:
    global _operator_account
    if _operator_account is None and OPERATOR_KEY:
        _operator_account = Account.from_key(OPERATOR_KEY)
    return _operator_account


def vault_ready() -> bool:
    """Check if vault contract is configured and reachable."""
    return bool(VAULT_ADDRESS) and get_vault() is not None


# ─── Read Functions (no gas) ────────────────────────────────────────────────

def get_vault_balance(address: str) -> float:
    """Get a user's USDC balance in the vault (in USD)."""
    vault = get_vault()
    if not vault:
        return 0.0
    balance_raw = vault.functions.balances(
        Web3.to_checksum_address(address)
    ).call()
    return float(balance_raw) / 10**USDC_DECIMALS


def get_vault_total_deposits() -> float:
    """Get total deposits across all users (in USD)."""
    vault = get_vault()
    if not vault:
        return 0.0
    total_raw = vault.functions.totalDeposits().call()
    return float(total_raw) / 10**USDC_DECIMALS


def get_solvency_info() -> dict:
    """Check vault solvency — anyone can verify on-chain."""
    vault = get_vault()
    if not vault:
        return {"solvent": False, "vault_balance": 0, "total_deposits": 0, "deficit": 0}
    info = vault.functions.getSolvencyInfo().call()
    return {
        "vault_balance": float(info[0]) / 10**USDC_DECIMALS,
        "total_deposits": float(info[1]) / 10**USDC_DECIMALS,
        "deficit": float(info[2]) / 10**USDC_DECIMALS,
        "solvent": info[3],
    }


def get_vault_fee_params() -> dict:
    """Get current fee parameters from the vault contract."""
    vault = get_vault()
    if not vault:
        return {}
    return {
        "open_close_fee_bps": vault.functions.openCloseFeeBps().call(),
        "profit_fee_bps": vault.functions.profitFeeBps().call(),
        "treasury": vault.functions.treasury().call(),
        "hl_master": vault.functions.hlMasterAccount().call(),
        "paused": vault.functions.paused().call(),
    }


def is_operator(address: str) -> bool:
    """Check if an address is a vault operator."""
    vault = get_vault()
    if not vault:
        return False
    result = vault.functions.operators(Web3.to_checksum_address(address)).call()
    return bool(result)


# ─── Write Functions (need gas — operator only) ──────────────────────────────

def _send_tx(func, w3=None, operator=None):
    """Build, sign, and send a transaction. Returns tx hash."""
    if w3 is None:
        w3 = get_w3()
    if operator is None:
        operator = get_operator()
    if not operator:
        raise RuntimeError("OPERATOR_KEY not configured")

    tx = func.build_transaction({
        "from": operator.address,
        "nonce": w3.eth.get_transaction_count(operator.address),
        "gas": 500_000,
        "maxFeePerGas": w3.eth.gas_price * 2,
        "maxPriorityFeePerGas": w3.eth.gas_price // 2,
        "chainId": 42161,  # Arbitrum One
    })

    signed = w3.eth.account.sign_transaction(tx, operator.key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()


def open_position(
    user_address: str,
    margin_usd: float,
    open_fee_usd: float,
    coin: str,
    is_long: bool,
    leverage: int,
) -> str:
    """Open a position via the vault contract. Returns tx hash."""
    vault = get_vault()
    if not vault:
        raise RuntimeError("Vault contract not configured")
    w3 = get_w3()
    margin_raw = int(margin_usd * 10**USDC_DECIMALS)
    open_fee_raw = int(open_fee_usd * 10**USDC_DECIMALS)
    func = vault.functions.openPosition(
        Web3.to_checksum_address(user_address),
        margin_raw,
        open_fee_raw,
        coin,
        is_long,
        leverage,
    )
    return _send_tx(func, w3)


def close_position(
    user_address: str,
    margin_usd: float,
    pnl_usd: float,
    close_fee_usd: float,
    profit_fee_usd: float,
    coin: str,
    is_long: bool,
) -> str:
    """Close a position via the vault contract. Returns tx hash."""
    vault = get_vault()
    if not vault:
        raise RuntimeError("Vault contract not configured")
    w3 = get_w3()
    margin_raw = int(margin_usd * 10**USDC_DECIMALS)
    # pnl can be negative — use int conversion
    pnl_raw = int(pnl_usd * 10**USDC_DECIMALS)
    close_fee_raw = int(close_fee_usd * 10**USDC_DECIMALS)
    profit_fee_raw = int(profit_fee_usd * 10**USDC_DECIMALS)
    func = vault.functions.closePosition(
        Web3.to_checksum_address(user_address),
        margin_raw,
        pnl_raw,
        close_fee_raw,
        profit_fee_raw,
        coin,
        is_long,
    )
    return _send_tx(func, w3)


# ─── Deposit Address ─────────────────────────────────────────────────────────

def get_deposit_address() -> str:
    """The deposit address IS the vault contract address.
    Users approve USDC spending, then call deposit() on the vault.
    For MVP, frontend handles the contract interaction directly."""
    return VAULT_ADDRESS


def check_usdc_allowance(user_address: str) -> float:
    """Check how much USDC a user has approved for the vault."""
    usdc = get_usdc()
    if not usdc or not VAULT_ADDRESS:
        return 0.0
    allowance_raw = usdc.functions.allowance(
        Web3.to_checksum_address(user_address),
        Web3.to_checksum_address(VAULT_ADDRESS),
    ).call()
    return float(allowance_raw) / 10**USDC_DECIMALS


def check_usdc_balance(user_address: str) -> float:
    """Check a user's wallet USDC balance (not in vault, just wallet)."""
    usdc = get_usdc()
    if not usdc:
        return 0.0
    balance_raw = usdc.functions.balanceOf(
        Web3.to_checksum_address(user_address)
    ).call()
    return float(balance_raw) / 10**USDC_DECIMALS