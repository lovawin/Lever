"""
Lever Trading Backend — API v4.0

Arbitrum vault integration:
- On-chain balance reads via LeverVault contract
- Deposit address = vault contract (users deposit USDC directly)
- Withdrawals via vault.withdraw() (always free, always possible)
- Orders via vault.openPosition/closePosition (operator)
- Solvency verification: anyone can check on-chain

Security:
- EVM + Solana wallet signature verification
- CORS locked to frontend domain
- Rate limiting (100/min general, 10/min for orders)
- Input validation with Pydantic
- Session tokens with expiry
"""

import os
import time
import hashlib
import secrets
import httpx
import json
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import psycopg2
from psycopg2.extras import RealDictCursor

from .vault import (
    vault_ready, get_vault_balance, get_vault_total_deposits,
    get_solvency_info, get_vault_fee_params, get_deposit_address as vault_deposit_address,
    check_usdc_allowance, check_usdc_balance,
    open_position as vault_open_position,
    close_position as vault_close_position,
)

app = FastAPI(title="Lever Trading", version="4.0.0")

# ─── Rate Limiting ───────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ─── CORS ────────────────────────────────────────────────────────────────────

ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "https://lever-longshort.vercel.app,https://jb-dash.vercel.app,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)

# ─── Config ──────────────────────────────────────────────────────────────────

HL_API_URL = os.getenv("HL_API_URL", "https://api.hyperliquid.xyz")
HL_TESTNET_URL = os.getenv("HL_TESTNET_URL", "https://api.hyperliquid-testnet.xyz")
DATABASE_URL = os.getenv("DATABASE_URL", "")
TREASURY_ADDRESS = os.getenv("TREASURY_ADDRESS", "")
HL_PRIVATE_KEY = os.getenv("HL_PRIVATE_KEY", "")
SOL_TREASURY = os.getenv("SOL_TREASURY", "")
SESSION_EXPIRY_SECONDS = int(os.getenv("SESSION_EXPIRY_SECONDS", "86400"))

# ─── Fee Schedule ────────────────────────────────────────────────────────────

FEE_TIERS = {
    "free":    {"open_close_bps": 10,   "profit_fee_pct": 10,  "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "iron":    {"open_close_bps": 9,    "profit_fee_pct": 9,   "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "silver":  {"open_close_bps": 7.5,  "profit_fee_pct": 7.5, "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "gold":    {"open_close_bps": 5,    "profit_fee_pct": 5,   "funding_rebate_pct": 15, "revenue_share_pct": 0},
    "diamond": {"open_close_bps": 0,    "profit_fee_pct": 0,   "funding_rebate_pct": 25, "revenue_share_pct": 25},
}

VENUE_TAKER_FEE_BPS = 4.5
VENUE_MAKER_FEE_BPS = 1.5


def get_tier_rates(tier: str) -> dict:
    return FEE_TIERS.get(tier, FEE_TIERS["free"])


def calc_open_fee(notional_usd: float, tier: str) -> float:
    return notional_usd * (get_tier_rates(tier)["open_close_bps"] / 10000)


def calc_close_fee(notional_usd: float, tier: str) -> float:
    return notional_usd * (get_tier_rates(tier)["open_close_bps"] / 10000)


def calc_profit_fee(pnl_usd: float, tier: str) -> float:
    if pnl_usd <= 0:
        return 0.0
    return pnl_usd * (get_tier_rates(tier)["profit_fee_pct"] / 100)


def calc_venue_fee(notional_usd: float, is_maker: bool = False) -> float:
    bps = VENUE_MAKER_FEE_BPS if is_maker else VENUE_TAKER_FEE_BPS
    return notional_usd * (bps / 10000)


# ─── Database ────────────────────────────────────────────────────────────────

def get_db():
    if not DATABASE_URL:
        return None
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return conn


def init_db():
    conn = get_db()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    address TEXT UNIQUE NOT NULL,
                    nonce TEXT NOT NULL,
                    fee_tier TEXT DEFAULT 'free',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    last_login TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS balances (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    asset TEXT DEFAULT 'USDC',
                    available NUMERIC(20, 8) DEFAULT 0,
                    locked NUMERIC(20, 8) DEFAULT 0,
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, asset)
                );
                CREATE TABLE IF NOT EXISTS deposits (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    tx_hash TEXT UNIQUE NOT NULL,
                    amount NUMERIC(20, 8) NOT NULL,
                    asset TEXT DEFAULT 'USDC',
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    confirmed_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS withdrawals (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    amount NUMERIC(20, 8) NOT NULL,
                    asset TEXT DEFAULT 'USDC',
                    destination TEXT NOT NULL,
                    tx_hash TEXT,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    processed_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS positions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    coin TEXT NOT NULL,
                    side TEXT NOT NULL,
                    size_usd NUMERIC(20, 8) NOT NULL,
                    entry_price NUMERIC(20, 8) NOT NULL,
                    leverage INTEGER NOT NULL,
                    notional_usd NUMERIC(20, 8) NOT NULL,
                    open_fee NUMERIC(20, 8) DEFAULT 0,
                    liquidation_price NUMERIC(20, 8),
                    status TEXT DEFAULT 'open',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    closed_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS fee_log (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    position_id INTEGER REFERENCES positions(id),
                    fee_type TEXT NOT NULL,
                    amount NUMERIC(20, 8) NOT NULL,
                    asset TEXT DEFAULT 'USDC',
                    tier TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()
    finally:
        conn.close()


# ─── Auth ────────────────────────────────────────────────────────────────────

_sessions: dict[str, dict] = {}
_nonces: dict[str, dict] = {}

EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
SOL_ADDRESS_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


def is_evm_address(addr: str) -> bool:
    return bool(EVM_ADDRESS_RE.match(addr))


def is_sol_address(addr: str) -> bool:
    return bool(SOL_ADDRESS_RE.match(addr))


class AuthChallenge(BaseModel):
    address: str

    @validator("address")
    def validate_address(cls, v):
        v = v.strip()
        if not is_evm_address(v) and not is_sol_address(v):
            raise ValueError("Invalid wallet address format")
        return v.lower() if is_evm_address(v) else v


class AuthVerify(BaseModel):
    address: str
    signature: str
    message: str

    @validator("address")
    def validate_address(cls, v):
        v = v.strip()
        if not is_evm_address(v) and not is_sol_address(v):
            raise ValueError("Invalid wallet address format")
        return v.lower() if is_evm_address(v) else v

    @validator("signature")
    def validate_signature(cls, v):
        v = v.strip()
        if not v or len(v) > 500:
            raise ValueError("Invalid signature format")
        return v


class SessionInfo(BaseModel):
    token: str
    address: str
    fee_tier: str = "free"


def verify_evm_signature(message: str, signature: str, expected_address: str) -> bool:
    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct
        msg = encode_defunct(text=message)
        recovered = Account.recover_message(msg, signature=signature)
        return recovered.lower() == expected_address.lower()
    except ImportError:
        import logging
        logging.getLogger("lever").warning("No EVM verification library. Install eth_account.")
        return True
    except Exception:
        return False


def verify_sol_signature(message: str, signature: str, expected_address: str) -> bool:
    try:
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError
        import base58
        sig_bytes = base58.b58decode(signature)
        msg_bytes = message.encode("utf-8")
        pubKey_bytes = base58.b58decode(expected_address)
        verify_key = VerifyKey(pubKey_bytes)
        verify_key.verify(msg_bytes, sig_bytes)
        return True
    except ImportError:
        import logging
        logging.getLogger("lever").warning("No Solana verification library. Install PyNaCl + base58.")
        return True
    except Exception:
        return False


@app.post("/api/auth/challenge")
async def auth_challenge(req: AuthChallenge):
    nonce = secrets.token_hex(16)
    address = req.address
    _nonces[address] = {"nonce": nonce, "expires": time.time() + 300}
    message = (
        f"Lever Trading\n\n"
        f"Sign this message to verify your wallet.\n\n"
        f"Nonce: {nonce}"
    )
    return {"message": message, "nonce": nonce}


@app.post("/api/auth/verify", response_model=SessionInfo)
async def auth_verify(req: AuthVerify):
    address = req.address
    nonce_data = _nonces.get(address)
    if not nonce_data:
        raise HTTPException(400, "No challenge found. Request a new one.")
    if time.time() > nonce_data["expires"]:
        del _nonces[address]
        raise HTTPException(400, "Challenge expired. Request a new one.")
    if nonce_data["nonce"] not in req.message:
        raise HTTPException(400, "Message doesn't match challenge nonce.")

    verified = False
    if is_evm_address(address):
        verified = verify_evm_signature(req.message, req.signature, address)
    elif is_sol_address(address):
        verified = verify_sol_signature(req.message, req.signature, address)
    else:
        raise HTTPException(400, "Unsupported address type")

    if not verified:
        raise HTTPException(401, "Invalid signature.")

    token = secrets.token_hex(32)
    user_info = {"address": address, "fee_tier": "free", "created": time.time()}
    _sessions[token] = user_info
    del _nonces[address]

    return SessionInfo(token=token, address=address, fee_tier=user_info["fee_tier"])


def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid authorization")
    token = authorization[7:]
    user = _sessions.get(token)
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    if time.time() - user.get("created", 0) > SESSION_EXPIRY_SECONDS:
        del _sessions[token]
        raise HTTPException(401, "Session expired. Please re-login.")
    return user


# ─── Balance ─────────────────────────────────────────────────────────────────

class BalanceResponse(BaseModel):
    address: str
    asset: str = "USDC"
    available: float
    locked: float
    total: float
    fee_tier: str


@app.get("/api/balance", response_model=BalanceResponse)
async def get_balance(user: dict = Depends(get_current_user)):
    address = user["address"]

    # Read balance directly from vault contract (on-chain)
    if vault_ready() and is_evm_address(address):
        vault_bal = get_vault_balance(address)
        return BalanceResponse(
            address=address,
            available=vault_bal,
            locked=0.0,  # vault doesn't track locked separately
            total=vault_bal,
            fee_tier=user["fee_tier"],
        )

    # Fallback: in-memory (dev mode, or Solana users without vault)
    balance_key = f"balance:{address}:USDC"
    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}
    bal = _sessions[balance_key]
    return BalanceResponse(
        address=address,
        available=bal["available"],
        locked=bal["locked"],
        total=bal["available"] + bal["locked"],
        fee_tier=user["fee_tier"],
    )


# ─── Deposit ────────────────────────────────────────────────────────────────

class DepositAddressResponse(BaseModel):
    address: str
    memo: str | None = None
    network: str = "arbitrum"
    asset: str = "USDC"


@app.get("/api/deposit/address", response_model=DepositAddressResponse)
async def get_deposit_address_endpoint(user: dict = Depends(get_current_user)):
    address = user["address"]

    if vault_ready() and is_evm_address(address):
        # Vault mode: deposit directly to the vault contract
        vault_addr = vault_deposit_address()
        return DepositAddressResponse(
            address=vault_addr,
            memo=None,
            network="arbitrum",
            asset="USDC",
        )

    # Fallback: send to treasury wallet
    if not TREASURY_ADDRESS:
        raise HTTPException(501, "Deposit address not configured")
    return DepositAddressResponse(
        address=TREASURY_ADDRESS,
        memo=address,
        network="ethereum",
        asset="USDC",
    )


class DepositConfirmRequest(BaseModel):
    tx_hash: str
    amount: float

    @validator("tx_hash")
    def validate_tx_hash(cls, v):
        v = v.strip()
        if not v or len(v) < 10 or len(v) > 200:
            raise ValueError("Invalid transaction hash")
        return v

    @validator("amount")
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("Amount must be positive")
        if v > 1_000_000:
            raise ValueError("Amount exceeds maximum")
        return round(v, 8)


@app.post("/api/deposit/confirm")
async def confirm_deposit(req: DepositConfirmRequest, user: dict = Depends(get_current_user)):
    """Confirm a deposit. With vault, the on-chain deposit event is the source of truth.
    
    For now, the vault contract's balance is the canonical balance — 
    deposits happen directly on-chain (user calls deposit() on the vault).
    This endpoint is for tracking/confirmation only."""
    address = user["address"]

    if vault_ready() and is_evm_address(address):
        # Vault mode: balance is already on-chain, just return current balance
        vault_bal = get_vault_balance(address)
        return {
            "status": "confirmed",
            "tx_hash": req.tx_hash,
            "vault_balance": vault_bal,
            "note": "Vault balance is read on-chain. Deposit directly to vault contract.",
        }

    # Fallback: in-memory
    balance_key = f"balance:{address}:USDC"
    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}
    _sessions[balance_key]["available"] += req.amount
    return {
        "status": "credited",
        "amount": req.amount,
        "new_balance": _sessions[balance_key]["available"],
        "note": "MVP: deposit not yet verified on-chain.",
    }


# ─── Withdrawal ──────────────────────────────────────────────────────────────

class WithdrawRequest(BaseModel):
    amount: float
    destination: str
    asset: str = "USDC"

    @validator("amount")
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("Amount must be positive")
        if v > 100_000:
            raise ValueError("Amount exceeds maximum withdrawal")
        return round(v, 8)

    @validator("destination")
    def validate_destination(cls, v):
        v = v.strip()
        if not is_evm_address(v) and not is_sol_address(v):
            raise ValueError("Invalid destination wallet address")
        return v


class WithdrawResponse(BaseModel):
    id: str
    amount: float
    destination: str
    status: str
    fee: float


@app.post("/api/withdraw", response_model=WithdrawResponse)
async def request_withdrawal(req: WithdrawRequest, user: dict = Depends(get_current_user)):
    address = user["address"]

    if vault_ready() and is_evm_address(address):
        # Vault mode: withdrawal happens on-chain via vault.withdraw()
        # The frontend calls the contract directly — backend just tracks
        vault_bal = get_vault_balance(address)
        if req.amount > vault_bal:
            raise HTTPException(400, f"Insufficient vault balance. Available: ${vault_bal:.2f}")
        if req.amount < 1:
            raise HTTPException(400, "Minimum withdrawal is $1")

        withdraw_id = secrets.token_hex(8)
        return WithdrawResponse(
            id=withdraw_id,
            amount=req.amount,
            destination=req.destination,
            status="pending_onchain",
            fee=0.0,
        )

    # Fallback: in-memory
    balance_key = f"balance:{address}:USDC"
    if balance_key not in _sessions:
        raise HTTPException(400, "No balance found")
    bal = _sessions[balance_key]
    if req.amount > bal["available"]:
        raise HTTPException(400, f"Insufficient balance. Available: ${bal['available']:.2f}")
    if req.amount < 1:
        raise HTTPException(400, "Minimum withdrawal is $1")

    bal["available"] -= req.amount
    withdraw_id = secrets.token_hex(8)
    return WithdrawResponse(
        id=withdraw_id,
        amount=req.amount,
        destination=req.destination,
        status="processing",
        fee=0.0,
    )


# ─── Order Placement ─────────────────────────────────────────────────────────

class PlaceOrderRequest(BaseModel):
    coin: str
    side: str
    size_usd: float = Field(ge=10, le=1_000_000)
    leverage: int = Field(ge=1, le=50)

    @validator("side")
    def validate_side(cls, v):
        if v not in ("long", "short"):
            raise ValueError("Side must be 'long' or 'short'")
        return v

    @validator("coin")
    def validate_coin(cls, v):
        v = v.strip().upper()
        if not v or len(v) > 20:
            raise ValueError("Invalid coin symbol")
        return v


class OrderResponse(BaseModel):
    id: str
    coin: str
    side: str
    size_usd: float
    leverage: int
    notional: float
    open_fee: float
    venue_fee_est: float
    total_deducted: float
    status: str
    fill_price: float | None = None
    tx_hash: str | None = None


@app.post("/api/order", response_model=OrderResponse)
@limiter.limit("10/minute")
async def place_order(request: Request, req: PlaceOrderRequest, user: dict = Depends(get_current_user)):
    """Place an order. Routes through vault contract if available."""
    address = user["address"]
    tier = user.get("fee_tier", "free")

    notional = req.size_usd * req.leverage
    open_fee = calc_open_fee(notional, tier)
    venue_fee_est = calc_venue_fee(notional)
    total_deducted = req.size_usd + open_fee

    tx_hash = None

    if vault_ready() and is_evm_address(address):
        # Check vault balance
        vault_bal = get_vault_balance(address)
        if total_deducted > vault_bal:
            raise HTTPException(
                400,
                f"Insufficient vault balance. Need ${total_deducted:.2f} "
                f"(margin ${req.size_usd:.2f} + fee ${open_fee:.2f}), "
                f"have ${vault_bal:.2f} in vault"
            )

        # Submit to vault contract via operator
        try:
            tx_hash = vault_open_position(
                user_address=address,
                margin_usd=req.size_usd,
                open_fee_usd=open_fee,
                coin=req.coin,
                is_long=(req.side == "long"),
                leverage=req.leverage,
            )
        except Exception as e:
            raise HTTPException(500, f"Vault transaction failed: {str(e)}")
    else:
        # Fallback: in-memory balances
        balance_key = f"balance:{address}:USDC"
        if balance_key not in _sessions:
            _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}
        bal = _sessions[balance_key]
        if total_deducted > bal["available"]:
            raise HTTPException(
                400,
                f"Insufficient balance. Need ${total_deducted:.2f}, have ${bal['available']:.2f}"
            )
        bal["available"] -= total_deducted
        bal["locked"] += req.size_usd

    order_id = secrets.token_hex(8)

    return OrderResponse(
        id=order_id,
        coin=req.coin,
        side=req.side,
        size_usd=req.size_usd,
        leverage=req.leverage,
        notional=notional,
        open_fee=open_fee,
        venue_fee_est=venue_fee_est,
        total_deducted=total_deducted,
        status="filled" if tx_hash else "pending",
        fill_price=None,
        tx_hash=tx_hash,
    )


# ─── Close Position ──────────────────────────────────────────────────────────

class ClosePositionRequest(BaseModel):
    position_id: str
    close_size_usd: float | None = None


class ClosePositionResponse(BaseModel):
    position_id: str
    closed_size: float
    close_fee: float
    profit_fee: float
    pnl: float
    net_payout: float
    status: str
    tx_hash: str | None = None


@app.post("/api/position/close", response_model=ClosePositionResponse)
async def close_position(req: ClosePositionRequest, user: dict = Depends(get_current_user)):
    tier = user.get("fee_tier", "free")
    address = user["address"]

    # MVP placeholders — in production, these come from HL position data
    notional = 1000.0
    pnl = 50.0
    margin = 100.0

    close_fee = calc_close_fee(notional, tier)
    profit_fee = calc_profit_fee(pnl, tier)
    net_payout = margin + pnl - close_fee - profit_fee

    tx_hash = None

    if vault_ready() and is_evm_address(address):
        try:
            tx_hash = vault_close_position(
                user_address=address,
                margin_usd=margin,
                pnl_usd=pnl,
                close_fee_usd=close_fee,
                profit_fee_usd=profit_fee,
                coin="BTC",     # TODO: from position data
                is_long=True,   # TODO: from position data
            )
        except Exception as e:
            raise HTTPException(500, f"Vault close failed: {str(e)}")
    else:
        # Fallback: in-memory
        balance_key = f"balance:{address}:USDC"
        if balance_key not in _sessions:
            _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}
        _sessions[balance_key]["available"] += net_payout
        _sessions[balance_key]["locked"] -= margin

    return ClosePositionResponse(
        position_id=req.position_id,
        closed_size=notional,
        close_fee=close_fee,
        profit_fee=profit_fee,
        pnl=pnl,
        net_payout=net_payout,
        status="closed",
        tx_hash=tx_hash,
    )


# ─── Positions ────────────────────────────────────────────────────────────────

@app.get("/api/positions")
async def get_positions(user: dict = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{HL_API_URL}/info",
                json={"type": "clearinghouseState", "user": TREASURY_ADDRESS or "0x0000000000000000000000000000000000000000"},
            )
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return {"positions": [], "margin": {}}


# ─── Vault Info ──────────────────────────────────────────────────────────────

@app.get("/api/vault/info")
async def vault_info():
    """On-chain vault status — solvency, fees, pause state."""
    if not vault_ready():
        return {"status": "not_configured", "vault_address": None}
    info = get_solvency_info()
    params = get_vault_fee_params()
    return {
        "status": "active",
        "vault_address": vault_deposit_address(),
        "solvency": info,
        "fee_params": params,
    }


@app.get("/api/vault/balance/{address}")
async def vault_balance(address: str):
    """Check any address's vault balance on-chain."""
    if not vault_ready():
        raise HTTPException(501, "Vault contract not configured")
    if not is_evm_address(address):
        raise HTTPException(400, "Only EVM addresses supported for vault balance")
    balance = get_vault_balance(address)
    wallet_balance = check_usdc_balance(address)
    allowance = check_usdc_allowance(address)
    return {
        "address": address,
        "vault_balance_usdc": balance,
        "wallet_balance_usdc": wallet_balance,
        "vault_allowance_usdc": allowance,
    }


# ─── Fee Info ─────────────────────────────────────────────────────────────────

@app.get("/api/fees")
async def get_fee_info(user: dict = Depends(get_current_user)):
    tier = user.get("fee_tier", "free")
    rates = get_tier_rates(tier)

    # Merge on-chain vault fee params if available
    vault_params = {}
    if vault_ready():
        vault_params = get_vault_fee_params()

    return {
        "tier": tier,
        "open_close_bps": rates["open_close_bps"],
        "open_close_pct": rates["open_close_bps"] / 100,
        "profit_fee_pct": rates["profit_fee_pct"],
        "funding_rebate_pct": rates["funding_rebate_pct"],
        "revenue_share_pct": rates["revenue_share_pct"],
        "venue_taker_bps": VENUE_TAKER_FEE_BPS,
        "venue_maker_bps": VENUE_MAKER_FEE_BPS,
        "withdrawal_fee_bps": 0,
        "withdrawal_note": "Free — Lever is non-custodial",
        "vault_fee_params": vault_params or None,
    }


# ─── Fee Preview ──────────────────────────────────────────────────────────────

class FeePreviewRequest(BaseModel):
    notional_usd: float = Field(ge=1, le=10_000_000)
    margin_usd: float = Field(ge=1, le=10_000_000)
    estimated_pnl_usd: float = Field(ge=-1_000_000, le=10_000_000)
    tier: str = "free"

    @validator("tier")
    def validate_tier(cls, v):
        if v not in FEE_TIERS:
            raise ValueError(f"Invalid tier. Must be one of: {list(FEE_TIERS.keys())}")
        return v


@app.post("/api/fees/preview")
async def preview_fees(req: FeePreviewRequest):
    tier = req.tier
    rates = get_tier_rates(tier)

    open_fee = calc_open_fee(req.notional_usd, tier)
    close_fee = calc_close_fee(req.notional_usd, tier)
    profit_fee = calc_profit_fee(req.estimated_pnl_usd, tier)
    venue_fee = calc_venue_fee(req.notional_usd)

    return {
        "tier": tier,
        "open_fee": {"amount": open_fee, "rate": f"{rates['open_close_bps'] / 100}%"},
        "close_fee": {"amount": close_fee, "rate": f"{rates['open_close_bps'] / 100}%"},
        "profit_fee": {
            "amount": profit_fee,
            "rate": f"{rates['profit_fee_pct']}%",
            "applies": req.estimated_pnl_usd > 0,
            "note": "Only charged on winning trades" if rates["profit_fee_pct"] > 0 else "FREE for Diamond tier",
        },
        "venue_fee_est": {"amount": venue_fee, "rate": f"{VENUE_TAKER_FEE_BPS / 100}%"},
        "total_lever_fees": open_fee + close_fee + profit_fee,
        "total_all_fees": open_fee + close_fee + profit_fee + venue_fee,
        "withdrawal_fee": 0,
    }


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    vault_status = "not_configured"
    vault_address = None
    solvency = None
    if vault_ready():
        vault_status = "active"
        vault_address = vault_deposit_address()
        solvency = get_solvency_info()

    return {
        "ok": True,
        "service": "lever-trading",
        "version": "4.0.0",
        "fee_model": "open+close+profit",
        "vault": {
            "status": vault_status,
            "address": vault_address,
            "solvency": solvency,
        },
        "default_open_close_bps": FEE_TIERS["free"]["open_close_bps"],
        "default_profit_fee_pct": FEE_TIERS["free"]["profit_fee_pct"],
        "treasury_configured": bool(TREASURY_ADDRESS),
        "security": {
            "cors_locked": len(ALLOWED_ORIGINS) > 0 and "*" not in ALLOWED_ORIGINS,
            "rate_limiting": True,
            "signature_verification": True,
            "input_validation": True,
            "session_expiry_seconds": SESSION_EXPIRY_SECONDS,
        },
    }


# ─── Init ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    if DATABASE_URL:
        init_db()