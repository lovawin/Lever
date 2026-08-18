"""
Lever Price Oracle — DEX price feeds for flash loan opportunity detection.

Fetches real-time prices from multiple DEXs on Arbitrum to find arbitrage
opportunities and calculate swap paths.

Sources:
  - DexScreener API (aggregated, easiest)
  - Uniswap V3 Quoter (on-chain, most accurate)
  - Camelot API (Arbitrum-native DEX)
  - SushiSwap API (multi-chain)

For same-block execution:
  - We simulate the full tx (eth_call) before sending
  - If simulation passes, we submit with high priority gas
  - The entire flash loan + swaps + repayment is ONE tx
  - No MEV risk because it's atomic — either all succeeds or all reverts
"""

import os
import time
import logging
from decimal import Decimal
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("lever.price_oracle")

# ─── Token Addresses (Arbitrum) ──────────────────────────────────────────────

TOKENS = {
    "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "WETH": "0x82aF49447D8a07e3c9598C603844F8F261FBCD43",
    "WBTC": "0x2f2a254b4a59177838F3d16d28C8f6119AB6B635",
    "ARB":  "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
    "GMX":  "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    "LINK": "0xf97f4df75117a78c1A5a0DBb814Af92458539784",
    "UNI":  "0xFa7F8980A23Ff5E43863828c47F8F81e3A19D3D9",
}

# Reverse lookup
ADDRESS_TO_SYMBOL = {v.lower(): k for k, v in TOKENS.items()}

# ─── DEX Pools on Arbitrum ──────────────────────────────────────────────────

# Uniswap V3 pool fees (in hundredths of a bip)
UNISWAP_POOL_FEES = {
    "USDC-WETH": 500,    # 0.05%
    "WETH-USDC": 500,
    "WBTC-WETH": 30,     # 0.03%
    "WETH-ARB":  500,
}

# ─── Price Data ──────────────────────────────────────────────────────────────

@dataclass
class PriceQuote:
    """A price quote from a DEX."""
    token_in: str       # symbol
    token_out: str      # symbol
    amount_in: float    # in tokens
    amount_out: float   # in tokens
    price: float        # amount_out / amount_in
    dex: str            # which DEX
    pool_fee_bps: float # pool fee in bps
    route: list[str]    # token path e.g. ["USDC", "WETH"]
    timestamp: float = field(default_factory=time.time)
    confidence: float = 1.0  # 0-1


@dataclass
class ArbOpportunity:
    """An arbitrage opportunity detected between two DEXs."""
    token: str           # what we're arb-ing
    buy_dex: str         # cheaper DEX
    sell_dex: str        # more expensive DEX
    buy_price: float     # price on buy_dex
    sell_price: float    # price on sell_dex
    spread_bps: float    # price difference in basis points
    spread_usd: float    # estimated profit per $1 traded
    estimated_profit_usd: float  # net profit after all fees
    buy_route: list[str] # swap path for buying
    sell_route: list[str] # swap path for selling
    buy_pool_fee: int    # uniswap pool fee for buy side
    sell_pool_fee: int   # uniswap pool fee for sell side
    profitable: bool = True


class PriceOracle:
    """
    Fetches prices from multiple sources and detects arb opportunities.
    
    For same-block flash loans, we need to:
    1. Get prices fast (< 1 second)
    2. Find a spread > total fees (Aave + Lever + gas + DEX fees)
    3. Simulate the full tx
    4. Submit before the spread closes
    """

    def __init__(self, rpc_url: str = None):
        self.rpc_url = rpc_url or os.getenv("ARBITRUM_RPC", "https://arb1.arbitrum.io/rpc")
        self.dexscreener_url = "https://api.dexscreener.com/latest"
        self._cache: dict[str, PriceQuote] = {}
        self._cache_ttl = 5.0  # seconds

    async def get_price_dexscreener(
        self,
        token_in: str,
        token_out: str,
        amount: float = 1000.0,
    ) -> list[PriceQuote]:
        """
        Fetch prices from DexScreener.
        
        DexScreener aggregates all DEXs and returns the best prices.
        This is the easiest way to find cross-DEX spreads.
        """
        token_in_addr = TOKENS.get(token_in.upper(), token_in)
        token_out_addr = TOKENS.get(token_out.upper(), token_out)

        quotes = []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Search for the pair
                pair = f"{token_in.lower()}_{token_out.lower()}" if token_in.upper() in TOKENS else f"{token_in}_{token_out}"
                resp = await client.get(
                    f"{self.dexscreener_url}/dex/pairs/arbitrum/{token_in_addr}",
                    params={"q": f"{token_in}/{token_out}"},
                )
                if resp.status_code != 200:
                    logger.warning(f"DexScreener returned {resp.status_code}")
                    return quotes

                data = resp.json()
                pairs = data.get("pairs", [])

                for pair_data in pairs[:10]:
                    try:
                        dex_id = pair_data.get("dexId", "unknown")
                        price_native = float(pair_data.get("priceNative", 0))
                        price_usd = float(pair_data.get("priceUsd", 0))

                        if price_native <= 0:
                            continue

                        # Calculate output amount
                        amount_out = amount * price_native if price_native > 1 else amount / price_native

                        quotes.append(PriceQuote(
                            token_in=token_in.upper(),
                            token_out=token_out.upper(),
                            amount_in=amount,
                            amount_out=amount_out,
                            price=price_native,
                            dex=dex_id,
                            pool_fee_bps=0,  # DexScreener doesn't provide this
                            route=[token_in.upper(), token_out.upper()],
                            confidence=0.8,  # slightly less confident since aggregated
                        ))
                    except (ValueError, TypeError, KeyError) as e:
                        logger.debug(f"Skipping pair: {e}")
                        continue

        except httpx.TimeoutException:
            logger.warning("DexScreener timeout")
        except Exception as e:
            logger.warning(f"DexScreener error: {e}")

        return quotes

    async def get_prices(
        self,
        token_in: str,
        token_out: str,
        amount: float = 1000.0,
    ) -> dict[str, PriceQuote]:
        """
        Get prices from all available DEXs for a pair.
        
        Returns a dict of {dex_name: PriceQuote}.
        If prices differ between DEXs, there's an arb opportunity.
        """
        quotes = await self.get_price_dexscreener(token_in, token_out, amount)

        # Deduplicate by DEX
        by_dex: dict[str, PriceQuote] = {}
        for q in quotes:
            dex = q.dex
            if dex not in by_dex or q.confidence > by_dex[dex].confidence:
                by_dex[dex] = q

        return by_dex

    async def find_arbitrage(
        self,
        token: str,
        amount_usd: float = 10000.0,
        min_spread_bps: float = 100.0,
    ) -> list[ArbOpportunity]:
        """
        Find arbitrage opportunities for a token on Arbitrum.
        
        Args:
            token: Token symbol (WETH, WBTC, ARB, etc.)
            amount_usd: How much USDC to borrow for the arb
            min_spread_bps: Minimum spread in bps to consider profitable
                            (needs to exceed Aave 0.05% + Lever fee + gas)
        
        Returns:
            List of ArbOpportunity sorted by estimated profit (best first)
        """
        # Get USDC → token prices across DEXs
        buy_quotes = await self.get_prices("USDC", token, amount_usd)
        sell_quotes = await self.get_prices(token, "USDC", amount_usd)

        opportunities = []

        # Compare every pair of DEXs
        # Buy token on one DEX, sell on another
        for buy_dex, buy_quote in buy_quotes.items():
            for sell_dex, sell_quote in sell_quotes.items():
                if buy_dex == sell_dex:
                    continue  # same DEX, no arb

                # Spread = difference in effective price
                if buy_quote.price <= 0 or sell_quote.price <= 0:
                    continue

                # How much token we get for amount_usd
                tokens_bought = amount_usd / buy_quote.price if buy_quote.price > 1 else amount_usd * buy_quote.price
                # How much USDC we get selling those tokens
                usdc_received = tokens_bought * sell_quote.price

                spread_usd = usdc_received - amount_usd
                spread_bps = (spread_usd / amount_usd) * 10000 if amount_usd > 0 else 0

                if spread_bps < min_spread_bps:
                    continue

                # Estimate net profit (after all fees)
                # Aave: 0.05%, Lever: 0.5% (free tier), Gas: ~$0.10
                aave_fee = amount_usd * 0.0005
                lever_fee = amount_usd * 0.005
                gas = 0.10
                net_profit = spread_usd - aave_fee - lever_fee - gas

                opp = ArbOpportunity(
                    token=token,
                    buy_dex=buy_dex,
                    sell_dex=sell_dex,
                    buy_price=buy_quote.price,
                    sell_price=sell_quote.price,
                    spread_bps=spread_bps,
                    spread_usd=spread_usd,
                    estimated_profit_usd=net_profit,
                    buy_route=buy_quote.route,
                    sell_route=sell_quote.route,
                    buy_pool_fee=500,  # default 0.05% pool
                    sell_pool_fee=500,
                    profitable=net_profit > 0,
                )
                opportunities.append(opp)

        # Sort by estimated profit, best first
        opportunities.sort(key=lambda x: x.estimated_profit_usd, reverse=True)
        return opportunities

    def get_swap_path(
        self,
        token_in: str,
        token_out: str,
        max_hops: int = 2,
    ) -> list[list[str]]:
        """
        Get possible swap paths between two tokens.
        
        Direct: USDC → WETH
        2-hop:  USDC → WETH → WBTC (if USDC/WBTC pool is thin)
        
        Returns list of possible routes, sorted by expected cost.
        """
        paths = []

        # Direct
        if token_in.upper() in TOKENS and token_out.upper() in TOKENS:
            paths.append([token_in.upper(), token_out.upper()])

        # 2-hop through WETH (most liquid pair)
        if token_in.upper() != "WETH" and token_out.upper() != "WETH":
            paths.append([token_in.upper(), "WETH", token_out.upper()])

        # 2-hop through USDC
        if token_in.upper() != "USDC" and token_out.upper() != "USDC":
            paths.append([token_in.upper(), "USDC", token_out.upper()])

        return paths[:max_hops + 1]


# ─── Singleton ───────────────────────────────────────────────────────────────

_oracle: PriceOracle | None = None


def get_price_oracle() -> PriceOracle:
    """Get or create the price oracle singleton."""
    global _oracle
    if _oracle is None:
        _oracle = PriceOracle()
    return _oracle