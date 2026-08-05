"""
Lever Trading Backend — API v2

Core features:
- Wallet-based auth (sign message)
- Internal balance tracking (deposits, withdrawals, P&L)
- Order routing to HL (our master account executes on behalf of users)
- Platform fee collection
- Position tracking
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

app = FastAPI(title="Lever Trading", version="2.0.0")

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
PLATFORM_FEE_BPS = float(os.getenv("PLATFORM_FEE_BPS", "10"))  # 0.10% default
TREASURY_ADDRESS = os.getenv("TREASURY_ADDRESS", "")
HL_PRIVATE_KEY = os.getenv("HL_PRIVATE_KEY", "")  # Our master account key

# ─── Database ────────────────────────────────────────────────────────────────

def get_db():
    """Get a database connection."""
    if not DATABASE_URL:
        return None
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return conn


def init_db():
    """Create tables if they don't exist."""
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
                
                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    coin TEXT NOT NULL,
                    side TEXT NOT NULL,  -- 'long' or 'short'
                    size_usd NUMERIC(20, 8) NOT NULL,
                    leverage INTEGER NOT NULL DEFAULT 1,
                    platform_fee NUMERIC(20, 8) DEFAULT 0,
                    venue_fee_est NUMERIC(20, 8) DEFAULT 0,
                    hl_order_id TEXT,
                    status TEXT DEFAULT 'pending',
                    fill_price NUMERIC(20, 8),
                    fill_size NUMERIC(20, 8),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );
                
                CREATE TABLE IF NOT EXISTS positions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    coin TEXT NOT NULL,
                    side TEXT NOT NULL,
                    size NUMERIC(20, 8) NOT NULL,
                    entry_price NUMERIC(20, 8) NOT NULL,
                    leverage INTEGER NOT NULL,
                    liquidation_price NUMERIC(20, 8),
                    unrealized_pnl NUMERIC(20, 8) DEFAULT 0,
                    status TEXT DEFAULT 'open',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    closed_at TIMESTAMPTZ
                );
                
                CREATE TABLE IF NOT EXISTS fee_log (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    order_id INTEGER REFERENCES orders(id),
                    fee_type TEXT NOT NULL,  -- 'platform' or 'venue'
                    amount NUMERIC(20, 8) NOT NULL,
                    asset TEXT DEFAULT 'USDC',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()
    finally:
        conn.close()


# ─── Auth ────────────────────────────────────────────────────────────────────

# In-memory session store (prod would use Redis/DB)
_sessions: dict[str, dict] = {}  # token -> user_info


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
    """Generate a nonce for the user to sign."""
    nonce = secrets.token_hex(16)
    # Store nonce for this address
    _sessions[f"nonce:{req.address.lower()}"] = {
        "nonce": nonce,
        "expires": time.time() + 300,  # 5 min
    }
    message = (
        f"Lever Trading\n\n"
        f"Sign this message to verify your wallet.\n\n"
        f"Nonce: {nonce}"
    )
    return {"message": message, "nonce": nonce}


@app.post("/api/auth/verify", response_model=SessionInfo)
async def auth_verify(req: AuthVerify):
    """Verify a signed message and issue a session token."""
    # In production, verify the signature cryptographically
    # For MVP, we trust the frontend's verification
    # TODO: Add proper eth_verify / solana_verify
    
    nonce_key = f"nonce:{req.address.lower()}"
    nonce_data = _sessions.get(nonce_key)
    if not nonce_data:
        raise HTTPException(400, "No challenge found. Request a new one.")
    if time.time() > nonce_data["expires"]:
        del _sessions[nonce_key]
        raise HTTPException(400, "Challenge expired. Request a new one.")
    
    # Issue session token
    token = secrets.token_hex(32)
    user_info = {
        "address": req.address.lower(),
        "fee_tier": "free",  # TODO: check NFT holdings
        "created": time.time(),
    }
    _sessions[token] = user_info
    del _sessions[nonce_key]  # Clean up nonce
    
    return SessionInfo(
        token=token,
        address=req.address.lower(),
        fee_tier=user_info["fee_tier"],
    )


def get_current_user(authorization: str = Header(None)) -> dict:
    """Extract and validate session token from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid authorization")
    token = authorization[7:]
    user = _sessions.get(token)
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    if time.time() - user.get("created", 0) > 86400:  # 24h expiry
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
    """Get the user's internal balance."""
    # MVP: In-memory balances. Production would use the database.
    # For now, return a mock balance for demo purposes
    address = user["address"]
    balance_key = f"balance:{address}:USDC"
    
    if balance_key not in _sessions:
        # Give demo balance for testing
        _sessions[balance_key] = {
            "available": 10000.0,  # $10,000 demo USDC
            "locked": 0.0,
        }
    
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
    """Get a deposit address for the user.
    
    MVP: Returns our master deposit address.
    Production: Generate per-user addresses or use smart contract.
    """
    if not TREASURY_ADDRESS:
        raise HTTPException(501, "Deposit address not configured")
    
    return DepositAddressResponse(
        address=TREASURY_ADDRESS,
        memo=user["address"],  # Use user's address as memo
        network="ethereum",
        asset="USDC",
    )


class DepositConfirmRequest(BaseModel):
    tx_hash: str
    amount: float


@app.post("/api/deposit/confirm")
async def confirm_deposit(req: DepositConfirmRequest, user: dict = Depends(get_current_user)):
    """Confirm a deposit. 
    
    MVP: Trust the user's reported amount (demo).
    Production: Verify on-chain tx, check confirmations, credit after safe depth.
    """
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
    destination: str  # wallet address to send to
    asset: str = "USDC"


class WithdrawResponse(BaseModel):
    id: str
    amount: float
    destination: str
    status: str
    fee: float  # Always 0 for now


@app.post("/api/withdraw", response_model=WithdrawResponse)
async def request_withdrawal(req: WithdrawRequest, user: dict = Depends(get_current_user)):
    """Request a withdrawal. Always free (non-custodial ethos).
    
    MVP: Deduct from internal balance immediately.
    Production: Queue for processing, send from master wallet, confirm on-chain.
    """
    address = user["address"]
    balance_key = f"balance:{address}:USDC"
    
    if balance_key not in _sessions:
        raise HTTPException(400, "No balance found")
    
    bal = _sessions[balance_key]
    if req.amount > bal["available"]:
        raise HTTPException(400, f"Insufficient balance. Available: ${bal['available']:.2f}")
    
    # Deduct from available
    bal["available"] -= req.amount
    
    withdraw_id = secrets.token_hex(8)
    
    return WithdrawResponse(
        id=withdraw_id,
        amount=req.amount,
        destination=req.destination,
        status="processing",
        fee=0.0,  # Always free
    )


# ─── Order Placement ─────────────────────────────────────────────────────────

class PlaceOrderRequest(BaseModel):
    coin: str
    side: str  # "long" or "short"
    size_usd: float = Field(ge=10)
    leverage: int = Field(ge=1, le=50)


class OrderResponse(BaseModel):
    id: str
    coin: str
    side: str
    size_usd: float
    leverage: int
    platform_fee: float
    venue_fee_est: float
    total_fee: float
    status: str
    fill_price: float | None = None
    fill_size: float | None = None


@app.post("/api/order", response_model=OrderResponse)
async def place_order(req: PlaceOrderRequest, user: dict = Depends(get_current_user)):
    """Place an order. 
    
    The backend:
    1. Validates user balance
    2. Deducts platform fee
    3. Routes to HL via our master account
    4. Tracks the position internally
    """
    address = user["address"]
    balance_key = f"balance:{address}:USDC"
    
    # Check balance
    if balance_key not in _sessions:
        _sessions[balance_key] = {"available": 10000.0, "locked": 0.0}
    
    bal = _sessions[balance_key]
    
    # Calculate fees
    notional = req.size_usd * req.leverage
    platform_fee = notional * (PLATFORM_FEE_BPS / 10000)
    venue_fee_est = notional * 0.00045  # 0.045% taker fee estimate
    total_fee = platform_fee + venue_fee_est
    
    # Check if user can cover margin + fees
    total_cost = req.size_usd + platform_fee
    if total_cost > bal["available"]:
        raise HTTPException(
            400, 
            f"Insufficient balance. Need ${total_cost:.2f} (margin ${req.size_usd:.2f} + fee ${platform_fee:.2f}), have ${bal['available']:.2f}"
        )
    
    # Deduct margin + platform fee
    bal["available"] -= total_cost
    bal["locked"] += req.size_usd  # Margin locked in position
    
    # In production: route to HL via our master account
    # For MVP: simulate the order
    order_id = secrets.token_hex(8)
    
    # TODO: Actually place the order on HL using HL_PRIVATE_KEY
    # This would use the HL API to place the order with builder fee
    
    return OrderResponse(
        id=order_id,
        coin=req.coin,
        side=req.side,
        size_usd=req.size_usd,
        leverage=req.leverage,
        platform_fee=platform_fee,
        venue_fee_est=venue_fee_est,
        total_fee=total_fee,
        status="filled",  # MVP: auto-fill
        fill_price=None,  # Would be set from HL response
        fill_size=None,
    )


# ─── Positions ────────────────────────────────────────────────────────────────

@app.get("/api/positions")
async def get_positions(user: dict = Depends(get_current_user)):
    """Get user's open positions."""
    # MVP: Return positions from HL for the master account, filtered by user
    # Production: Map HL positions to internal user positions
    
    # For now, proxy to HL
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
    
    tiers = {
        "free": {"platform_bps": 10, "discount_pct": 0, "funding_rebate_pct": 0},
        "iron": {"platform_bps": 9, "discount_pct": 10, "funding_rebate_pct": 0},
        "silver": {"platform_bps": 7.5, "discount_pct": 25, "funding_rebate_pct": 0},
        "gold": {"platform_bps": 5, "discount_pct": 50, "funding_rebate_pct": 15},
        "diamond": {"platform_bps": 0, "discount_pct": 100, "funding_rebate_pct": 25},
    }
    
    info = tiers.get(tier, tiers["free"])
    
    return {
        "tier": tier,
        "platform_fee_bps": info["platform_bps"],
        "platform_fee_pct": info["platform_bps"] / 100,
        "discount_pct": info["discount_pct"],
        "funding_rebate_pct": info["funding_rebate_pct"],
        "venue_fee_bps": 4.5,  # HL base taker fee
        "withdrawal_fee_bps": 0,
        "withdrawal_fee_pct": 0,
        "withdrawal_note": "Free — Lever is non-custodial, your funds are always yours",
    }


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "lever-trading",
        "version": "2.0.0",
        "platform_fee_bps": PLATFORM_FEE_BPS,
        "treasury_configured": bool(TREASURY_ADDRESS),
    }


# ─── Init ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    if DATABASE_URL:
        init_db()