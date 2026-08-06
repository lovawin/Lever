"""
Lever Trading Backend — API v3

Three-point fee system:
  1. Open fee  — charged on notional when opening a position
  2. Close fee — charged on notional when closing a position
  3. Profit fee — % of realized PnL, only on winning trades (losing = no profit fee)

Withdrawals are always FREE (non-custodial).
"""

import os
import time
import hashlib
import secrets
import httpx
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import psycopg2
from psycopg2.extras import RealDictCursor

app = FastAPI(title="Lever Trading", version="3.0.0")

CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN] if CORS_ORIGIN != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Config ──────────────────────────────────────────────────────────────────

HL_API_URL = os.getenv("HL_API_URL", "https://api.hyperliquid.xyz")
HL_TESTNET_URL = os.getenv("HL_TESTNET_URL", "https://api.hyperliquid-testnet.xyz")
DATABASE_URL = os.getenv("DATABASE_URL", "")
TREASURY_ADDRESS = os.getenv("TREASURY_ADDRESS", "")
HL_PRIVATE_KEY = os.getenv("HL_PRIVATE_KEY", "")

# ─── Fee Schedule ────────────────────────────────────────────────────────────
# All rates configurable via env, with sensible defaults

FEE_TIERS = {
    "free":    {"open_close_bps": 10,   "profit_fee_pct": 10,  "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "iron":    {"open_close_bps": 9,    "profit_fee_pct": 9,   "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "silver":  {"open_close_bps": 7.5,  "profit_fee_pct": 7.5, "funding_rebate_pct": 0,  "revenue_share_pct": 0},
    "gold":    {"open_close_bps": 5,    "profit_fee_pct": 5,   "funding_rebate_pct": 15, "revenue_share_pct": 0},
    "diamond": {"open_close_bps": 0,    "profit_fee_pct": 0,   "funding_rebate_pct": 25, "revenue_share_pct": 25},
}

VENUE_TAKER_FEE_BPS = 4.5  # HL base taker fee
VENUE_MAKER_FEE_BPS = 1.5   # HL base maker fee


def get_tier_rates(tier: str) -> dict:
    """Get fee rates for a tier."""
    return FEE_TIERS.get(tier, FEE_TIERS["free"])


def calc_open_fee(notional_usd: float, tier: str) -> float:
    """Fee charged when opening a position. Applied to notional (size * leverage)."""
    rates = get_tier_rates(tier)
    return notional_usd * (rates["open_close_bps"] / 10000)


def calc_close_fee(notional_usd: float, tier: str) -> float:
    """Fee charged when closing a position. Same rate as open fee."""
    rates = get_tier_rates(tier)
    return notional_usd * (rates["open_close_bps"] / 10000)


def calc_profit_fee(pnl_usd: float, tier: str) -> float:
    """Fee on realized PnL. Only charged if PnL > 0 (winning trades)."""
    if pnl_usd <= 0:
        return 0.0
    rates = get_tier_rates(tier)
    return pnl_usd * (rates["profit_fee_pct"] / 100)


def calc_venue_fee(notional_usd: float, is_maker: bool = False) -> float:
    """HL venue fee estimate."""
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
                    tx_hash TEXT,
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
                    -- 'open_fee', 'close_fee', 'profit_fee', 'venue_fee'
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


class AuthChallenge(BaseModel):
    address: str


class AuthVerify(BaseModel):
    address: str
    signature: str
    message: str


class SessionInfo(BaseModel):
    token: str
    address: str
    fee_tier: str = "free"


@app.post("/api/auth/challenge")
async def auth_challenge(req: AuthChallenge):
    nonce = secrets.token_hex(16)
    _sessions[f"nonce:{req.address.lower()}"] = {
        "nonce": nonce,
        "expires": time.time() + 300,
    }
    message = (
        f"Lever Trading\n\n"
        f"Sign this message to verify your wallet.\n\n"
        f"Nonce: {nonce}"
    )
    return {"message": message, "nonce": nonce}


@app.post("/api/auth/verify", response_model=SessionInfo)
async def auth_verify(req: AuthVerify):
    nonce_key = f"nonce:{req.address.lower()}"
    nonce_data = _sessions.get(nonce_key)
    if not nonce_data:
        raise HTTPException(400, "No challenge found. Request a new one.")
    if time.time() > nonce_data["expires"]:
        del _sessions[nonce_key]
        raise HTTPException(400, "Challenge expired. Request a new one.")

    token = secrets.token_hex(32)
    user_info = {
        "address": req.address.lower(),
        "fee_tier": "free",  # TODO: check NFT holdings
        "created": time.time(),
    }
    _sessions[token] = user_info
    del _sessions[nonce_key]

    return SessionInfo(
        token=token,
        address=req.address.lower(),
        fee_tier=user_info["fee_tier"],
    )


def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid authorization")
    token = authorization[7:]
    user = _sessions.get(token)
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    if time.time() - user.get("created", 0) > 86400:
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
    network: str = "ethereum"
    asset: str = "USDC"


@app.get("/api/deposit/address", response_model=DepositAddressResponse)
async def get_deposit_address(user: dict = Depends(get_current_user)):
    if not TREASURY_ADDRESS:
        raise HTTPException(501, "Deposit address not configured")
    return DepositAddressResponse(
        address=TREASURY_ADDRESS,
        memo=user["address"],
        network="ethereum",
        asset="USDC",
    )


class DepositConfirmRequest(BaseModel):
    tx_hash: str
    amount: float


@app.post("/api/deposit/confirm")
async def confirm_deposit(req: DepositConfirmRequest, user: dict = Depends(get_current_user)):
    address = user["address"]
    balance_key = f"balance:{address}:USDC"

    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}

    _sessions[balance_key]["available"] += req.amount

    return {
        "status": "credited",
        "amount": req.amount,
        "new_balance": _sessions[balance_key]["available"],
    }


# ─── Withdrawal ──────────────────────────────────────────────────────────────

class WithdrawRequest(BaseModel):
    amount: float
    destination: str
    asset: str = "USDC"


class WithdrawResponse(BaseModel):
    id: str
    amount: float
    destination: str
    status: str
    fee: float  # Always 0


@app.post("/api/withdraw", response_model=WithdrawResponse)
async def request_withdrawal(req: WithdrawRequest, user: dict = Depends(get_current_user)):
    address = user["address"]
    balance_key = f"balance:{address}:USDC"

    if balance_key not in _sessions:
        raise HTTPException(400, "No balance found")

    bal = _sessions[balance_key]
    if req.amount > bal["available"]:
        raise HTTPException(400, f"Insufficient balance. Available: ${bal['available']:.2f}")

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
    side: str  # "long" or "short"
    size_usd: float = Field(ge=10)  # margin
    leverage: int = Field(ge=1, le=50)


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


@app.post("/api/order", response_model=OrderResponse)
async def place_order(req: PlaceOrderRequest, user: dict = Depends(get_current_user)):
    """Place an order. Deducts open fee + margin upfront."""
    address = user["address"]
    tier = user.get("fee_tier", "free")
    balance_key = f"balance:{address}:USDC"

    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}

    bal = _sessions[balance_key]

    # Calculate notional and fees
    notional = req.size_usd * req.leverage
    open_fee = calc_open_fee(notional, tier)
    venue_fee_est = calc_venue_fee(notional, is_maker=False)

    # Total deduction: margin + open fee
    total_deducted = req.size_usd + open_fee

    if total_deducted > bal["available"]:
        raise HTTPException(
            400,
            f"Insufficient balance. Need ${total_deducted:.2f} "
            f"(margin ${req.size_usd:.2f} + open fee ${open_fee:.2f}), "
            f"have ${bal['available']:.2f}"
        )

    # Deduct from available, lock margin
    bal["available"] -= total_deducted
    bal["locked"] += req.size_usd

    # TODO: Actually place order on HL using HL_PRIVATE_KEY with builder fee
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
        status="filled",
    )


# ─── Close Position ──────────────────────────────────────────────────────────

class ClosePositionRequest(BaseModel):
    position_id: str
    close_size_usd: float | None = None  # None = close all


class ClosePositionResponse(BaseModel):
    position_id: str
    closed_size: float
    close_fee: float
    profit_fee: float
    pnl: float
    net_payout: float
    status: str


@app.post("/api/position/close", response_model=ClosePositionResponse)
async def close_position(req: ClosePositionRequest, user: dict = Depends(get_current_user)):
    """Close a position. Deducts close fee + profit fee (if winning)."""
    tier = user.get("fee_tier", "free")
    address = user["address"]
    balance_key = f"balance:{address}:USDC"

    # MVP: Simulate position close
    # Production: Fetch real position from HL, calculate actual PnL

    # Placeholder values — production would come from HL position data
    notional = 1000.0  # placeholder
    pnl = 50.0  # placeholder

    close_fee = calc_close_fee(notional, tier)
    profit_fee = calc_profit_fee(pnl, tier)

    # Release margin, apply PnL, deduct fees
    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}

    # net_payout = margin + pnl - close_fee - profit_fee
    margin = 100.0  # placeholder
    net_payout = margin + pnl - close_fee - profit_fee
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


# ─── Fee Info ─────────────────────────────────────────────────────────────────

@app.get("/api/fees")
async def get_fee_info(user: dict = Depends(get_current_user)):
    """Get fee schedule for the user's tier."""
    tier = user.get("fee_tier", "free")
    rates = get_tier_rates(tier)

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
    }


# ─── Fee Preview ──────────────────────────────────────────────────────────────

class FeePreviewRequest(BaseModel):
    notional_usd: float
    margin_usd: float
    estimated_pnl_usd: float = 0
    tier: str = "free"


@app.post("/api/fees/preview")
async def preview_fees(req: FeePreviewRequest):
    """Preview fee breakdown for a trade (no auth required)."""
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
    return {
        "ok": True,
        "service": "lever-trading",
        "version": "3.0.0",
        "fee_model": "open+close+profit",
        "default_open_close_bps": FEE_TIERS["free"]["open_close_bps"],
        "default_profit_fee_pct": FEE_TIERS["free"]["profit_fee_pct"],
        "treasury_configured": bool(TREASURY_ADDRESS),
    }


# ─── Init ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    if DATABASE_URL:
        init_db()