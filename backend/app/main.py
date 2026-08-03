"""
Lever signals API.

Returns memecoin health scores so the frontend can curate what to show.

For Solana tokens, uses DexScreener public API (free, no auth) plus Helius RPC.
For EVM tokens (Robinhood Chain, etc.) can be added later.
"""
import os
import time
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Lever Signals", version="0.2.0")

CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN] if CORS_ORIGIN != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HELIUS_KEY = os.getenv("HELIUS_API_KEY", "")
DEXSCREENER = "https://api.dexscreener.com/latest/dex"

# In-memory cache (simple TTL). Real prod would use Redis.
_cache: dict[str, tuple[float, dict]] = {}
_TTL_S = 60


def _get_cached(key: str) -> dict | None:
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < _TTL_S:
            return data
    return None


def _set_cache(key: str, data: dict) -> None:
    _cache[key] = (time.time(), data)


class Signal(BaseModel):
    chain: str
    address: str
    symbol: str
    price_usd: float | None = None
    market_cap_usd: float | None = None
    fdv_usd: float | None = None
    liquidity_usd: float | None = None
    volume_24h_usd: float | None = None
    price_change_24h_pct: float | None = None
    buys_24h: int | None = None
    sells_24h: int | None = None
    liquidity_ratio: float | None = None  # liquidity / mcap
    buy_pressure_24h: float | None = None  # buys / (buys + sells)
    score: int | None = None  # 0-100 composite
    notes: list[str] = []


def score_signal(s: Signal) -> Signal:
    """Compute a 0-100 score from the metrics.

    Components (each 0-100, weighted):
      - liquidity ratio: 25% (healthy = >2%, rug = <0.5%)
      - buy pressure 24h: 20% (>55% buys = bull, <45% = bear)
      - volume: 20% (>$100k = healthy)
      - price action: 15% (mild up = ok, big up = suspicious, down = bearish)
      - mcap floor: 20% (>$1m = real, <$100k = micro)
    """
    parts: list[tuple[float, float]] = []  # (component_score, weight)

    # liquidity ratio
    if s.liquidity_ratio is not None:
        r = s.liquidity_ratio
        if r >= 0.02:
            parts.append((100.0, 25.0))
        elif r >= 0.01:
            parts.append((70.0, 25.0))
        elif r >= 0.005:
            parts.append((40.0, 25.0))
        else:
            parts.append((10.0, 25.0))

    # buy pressure 24h
    if s.buy_pressure_24h is not None:
        bp = s.buy_pressure_24h
        if bp >= 0.55:
            parts.append((100.0, 20.0))
        elif bp >= 0.45:
            parts.append((60.0, 20.0))
        else:
            parts.append((20.0, 20.0))

    # volume
    if s.volume_24h_usd is not None:
        v = s.volume_24h_usd
        if v >= 500_000:
            parts.append((100.0, 20.0))
        elif v >= 100_000:
            parts.append((75.0, 20.0))
        elif v >= 25_000:
            parts.append((50.0, 20.0))
        else:
            parts.append((20.0, 20.0))

    # price change 24h
    if s.price_change_24h_pct is not None:
        p = s.price_change_24h_pct
        if -10 <= p <= 30:
            parts.append((80.0, 15.0))
        elif p > 30:
            parts.append((50.0, 15.0))  # suspicious pump
        elif p > -30:
            parts.append((40.0, 15.0))
        else:
            parts.append((10.0, 15.0))

    # mcap floor
    if s.market_cap_usd is not None:
        m = s.market_cap_usd
        if m >= 5_000_000:
            parts.append((100.0, 20.0))
        elif m >= 1_000_000:
            parts.append((80.0, 20.0))
        elif m >= 250_000:
            parts.append((55.0, 20.0))
        else:
            parts.append((20.0, 20.0))

    notes: list[str] = []
    if s.liquidity_ratio is not None and s.liquidity_ratio < 0.005:
        notes.append("thin liquidity — high rug risk")
    if s.price_change_24h_pct is not None and s.price_change_24h_pct > 50:
        notes.append("pumping — could be a setup")
    if s.buy_pressure_24h is not None and s.buy_pressure_24h > 0.7:
        notes.append("extreme buy pressure — late or coordinated?")
    if s.market_cap_usd is not None and s.market_cap_usd < 250_000:
        notes.append("micro-cap — extreme volatility expected")

    if parts:
        total_w = sum(w for _, w in parts)
        weighted = sum(c * w for c, w in parts) / total_w
        s.score = int(round(weighted))
    else:
        s.score = None
    s.notes = notes
    return s


async def fetch_solana_signal(mint: str) -> Signal | None:
    cache_key = f"sol:{mint}"
    cached = _get_cached(cache_key)
    if cached:
        return Signal(**cached)

    # DexScreener public API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{DEXSCREENER}/tokens/{mint}")
            if r.status_code != 200:
                return None
            data = r.json()
            pairs = data.get("pairs") or []
            # Pick the highest-liquidity pair
            if not pairs:
                return None
            best = max(pairs, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0))
            liq = (best.get("liquidity") or {}).get("usd")
            vol = (best.get("volume") or {}).get("h24")
            txns = best.get("txns") or {}
            h24 = txns.get("h24") or {}
            buys = h24.get("buys")
            sells = h24.get("sells")
            price_change = (best.get("priceChange") or {}).get("h24")
            mcap = best.get("marketCap") or best.get("fdv")
            fdv = best.get("fdv")
            price = (best.get("priceUsd"))
            base = best.get("baseToken") or {}

            liq_f = float(liq) if liq is not None else None
            vol_f = float(vol) if vol is not None else None
            mcap_f = float(mcap) if mcap is not None else None
            fdv_f = float(fdv) if fdv is not None else None
            price_f = float(price) if price is not None else None

            total_tx = (buys or 0) + (sells or 0)
            bp = (buys / total_tx) if total_tx else None
            liq_ratio = (liq_f / mcap_f) if (liq_f and mcap_f) else None

            sig = Signal(
                chain="solana",
                address=mint,
                symbol=base.get("symbol") or mint[:6],
                price_usd=price_f,
                market_cap_usd=mcap_f,
                fdv_usd=fdv_f,
                liquidity_usd=liq_f,
                volume_24h_usd=vol_f,
                price_change_24h_pct=float(price_change) if price_change is not None else None,
                buys_24h=buys,
                sells_24h=sells,
                liquidity_ratio=liq_ratio,
                buy_pressure_24h=bp,
            )
            sig = score_signal(sig)
            _set_cache(cache_key, sig.model_dump())
            return sig
    except Exception:
        return None


@app.get("/health")
def health():
    return {"ok": True, "service": "lever-signals"}


@app.get("/hl/meta")
async def hyperliquid_meta():
    """Proxy to Hyperliquid public info endpoint for market universe."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                os.getenv("HL_INFO_URL", "https://api.hyperliquid.xyz/info"),
                json={"type": "meta"},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/hl/mids")
async def hyperliquid_mids():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                os.getenv("HL_INFO_URL", "https://api.hyperliquid.xyz/info"),
                json={"type": "allMids"},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/signal/solana/{mint}", response_model=Signal)
async def signal_solana(mint: str):
    sig = await fetch_solana_signal(mint)
    if not sig:
        raise HTTPException(404, f"no signal for {mint}")
    return sig


@app.get("/signals/batch")
async def signals_batch(mints: str):
    """Comma-separated mint addresses, returns signals for each."""
    items = [m.strip() for m in mints.split(",") if m.strip()]
    out = []
    for m in items[:20]:  # cap batch size
        sig = await fetch_solana_signal(m)
        if sig:
            out.append(sig.model_dump())
    return {"count": len(out), "signals": out}
