"""Lever signals API.

Returns memecoin health scores so the frontend can curate what to show.
For MVP, this is a stub — score formula is a placeholder.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="Lever Signals", version="0.1.0")

CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN] if CORS_ORIGIN != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "service": "lever-signals"}


@app.get("/signals/{symbol}")
def get_signal(symbol: str):
    """Stub. Real impl will hit Helius (Solana) or Hyperliquid info endpoint,
    return volume, buy/sell ratio, liquidity, etc., and a composite score 0-100."""
    return {
        "symbol": symbol.upper(),
        "score": None,
        "metrics": None,
        "note": "stub — signals not implemented yet",
    }


@app.get("/hl/meta")
def hyperliquid_meta():
    """Proxy to Hyperliquid public info endpoint for market universe."""
    import httpx
    try:
        r = httpx.post(
            os.getenv("HL_INFO_URL", "https://api.hyperliquid.xyz/info"),
            json={"type": "meta"},
            timeout=10.0,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}
