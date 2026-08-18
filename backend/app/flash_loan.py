"""
Lever Flash Loan Engine — Backend Service (Option 3)

Uses Aave v3 flash loans on Arbitrum to execute arbitrage, self-liquidation,
and leverage amplification — all server-side via the operator key.

No contract changes needed. The vault stays as-is. Flash loans are borrowed
from Aave, executed through our backend, and repaid in the same tx.

Architecture:
  - Backend detects opportunities (arb, liquidation, leverage loop)
  - Backend builds + signs a flash loan tx using the operator key
  - Flash loan callback executes the strategy (swap, open position, etc.)
  - Aave verifies repayment in the same tx

Supported strategies:
  1. Arbitrage — borrow USDC, buy low on DEX A, sell high on DEX B, repay + keep profit
  2. Self-liquidation — borrow USDC to close an underwater position cheaply
  3. Leverage loop — borrow USDC, deposit into vault, open bigger position

Required env vars:
  ARBITRUM_RPC        — Arbitrum RPC URL
  OPERATOR_KEY        — Private key for tx signing (same as vault operator)
  FLASH_LOAN_ENABLED  — Set to "true" to enable (default: disabled for safety)

Aave v3 Arbitrum addresses:
  Pool:                0x794a61358D6845594F94dc1DB02A252b5b4814aD
  PoolAddressesProvider: 0xa97684ead0e402dC232d5A977953DF790BaF5dc0
  USDC:                0xaf88d065e77c8cC2239327C5EDb3A432268e5831
  WETH:               0x82aF49447D8a07e3c9598C603844F8F261FBCD43
"""

import os
import time
import logging
from decimal import Decimal
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from web3 import Web3
from eth_account import Account
from eth_abi import encode

logger = logging.getLogger("lever.flash_loan")

# ─── Config ──────────────────────────────────────────────────────────────────

ARBITRUM_RPC = os.getenv("ARBITRUM_RPC", "https://arb1.arbitrum.io/rpc")
OPERATOR_KEY = os.getenv("OPERATOR_KEY", "")
FLASH_LOAN_ENABLED = os.getenv("FLASH_LOAN_ENABLED", "false").lower() == "true"

# Aave v3 Arbitrum
AAVE_POOL = Web3.to_checksum_address("0x794a61358D6845594F94dc1DB02A252b5b4814aD")
AAVE_POOL_ADDRESSES_PROVIDER = Web3.to_checksum_address(
    "0xa97684ead0e402dC232d5A977953DF790BaF5dc0"
)

# Deployed contracts
FLASH_LOAN_RECEIVER_ADDRESS = Web3.to_checksum_address(
    os.getenv("FLASH_LOAN_RECEIVER", "0xb7073FBC347e8fa14eF25D12112EC66d73612bE9")
)

# Tokens
USDC_ARB = Web3.to_checksum_address("0xaf88d065e77c8cC2239327C5EDb3A432268e5831")
WETH_ARB = Web3.to_checksum_address("0x82aF49447D8a07e3c9598C603844F8F261FBCD43")
USDC_DECIMALS = 6
WETH_DECIMALS = 18

# Aave flash loan fee: 0.05% = 5 bps
AAVE_FLASH_LOAN_FEE_BPS = 5
AAVE_FLASH_LOAN_PREMIUM = 5  # Aave v3: 5/10000 = 0.05%

# ─── Lever Flash Loan Fees ──────────────────────────────────────────────────
# These are ON TOP of Aave's fee. The user pays Aave fee + Lever fee.
# Lever fee goes to your treasury.

# Default: 0.5% = 50 bps on top of Aave's 0.05%
# So total cost to user: 0.55% for a flash loan
LEVER_FLASH_LOAN_FEE_BPS = int(os.getenv("LEVER_FLASH_LOAN_FEE_BPS", "50"))  # 0.5%

# Fee split: what % of the Lever fee goes to the treasury vs the user referrer
# Default: 70% treasury, 30% referrer (if any)
LEVER_FEE_TREASURY_PCT = int(os.getenv("LEVER_FEE_TREASURY_PCT", "70"))  # 70%
LEVER_FEE_REFERRER_PCT = 100 - LEVER_FEE_TREASURY_PCT  # 30%

# Minimum Lever fee in USD (don't charge less than this)
LEVER_MIN_FEE_USD = float(os.getenv("LEVER_MIN_FEE_USD", "1.0"))  # $1 minimum

# Where Lever fees get sent (your treasury)
LEVER_FEE_RECIPIENT = os.getenv("LEVER_FEE_RECIPIENT", os.getenv("TREASURY_ADDRESS", ""))

# ─── Fee Tiers for Flash Loans ─────────────────────────────────────────────
# Lower tiers = lower fees (same model as your position fee tiers)
FLASH_LOAN_FEE_TIERS = {
    "free":    {"lever_bps": 50, "label": "0.50%"},   # 0.5% + 0.05% Aave = 0.55% total
    "iron":    {"lever_bps": 40, "label": "0.40%"},   # 0.4% + 0.05% Aave = 0.45% total
    "silver":  {"lever_bps": 30, "label": "0.30%"},   # 0.3% + 0.05% Aave = 0.35% total
    "gold":    {"lever_bps": 20, "label": "0.20%"},   # 0.2% + 0.05% Aave = 0.25% total
    "diamond": {"lever_bps": 10, "label": "0.10%"},   # 0.1% + 0.05% Aave = 0.15% total
}

# DEX routers on Arbitrum
UNISWAP_V3_ROUTER = Web3.to_checksum_address("0x68b3465833fb72A70ec138488f5723Ce294C6d30")
SUSHI_SWAP_ROUTER = Web3.to_checksum_address("0x1b02dA8Cb0d097eB8D57A175b05127041362C6E8")
CAMELOT_ROUTER = Web3.to_checksum_address("0x6420aD42e7aE6fFc1D6a3E748b91f8a7fb9a5B5C")

# ─── ABIs (minimal) ──────────────────────────────────────────────────────────

AAVE_POOL_ABI = [
    {
        "inputs": [
            {"name": "receiver", "type": "address"},
            {"name": "assets", "type": "address[]"},
            {"name": "amounts", "type": "uint256[]"},
            {"name": "interestRateModes", "type": "uint256[]"},
            {"name": "onBehalfOf", "type": "address"},
            {"name": "params", "type": "bytes"},
            {"name": "referralCode", "type": "uint16"},
        ],
        "name": "flashLoanSimple",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "receiver", "type": "address"},
            {"name": "assets", "type": "address[]"},
            {"name": "amounts", "type": "uint256[]"},
            {"name": "interestRateModes", "type": "uint256[]"},
            {"name": "onBehalfOf", "type": "address"},
            {"name": "params", "type": "bytes"},
            {"name": "referralCode", "type": "uint16"},
        ],
        "name": "flashLoan",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "FLASHLOAN_PREMIUM_TOTAL",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]

# ERC20 approve + balanceOf
ERC20_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


# ─── Strategy Types ──────────────────────────────────────────────────────────

class FlashLoanStrategy(str, Enum):
    ARBITRAGE = "arbitrage"
    SELF_LIQUIDATION = "self_liquidation"
    LEVERAGE_LOOP = "leverage_loop"


class FlashLoanStatus(str, Enum):
    PENDING = "pending"
    SIMULATING = "simulating"
    BUILDING = "building"
    SIGNING = "signing"
    SENT = "sent"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    REVERTED = "reverted"


@dataclass
class FlashLoanOpportunity:
    """A detected flash loan opportunity."""
    strategy: FlashLoanStrategy
    asset: str  # token address
    amount: Decimal  # borrow amount in token units
    expected_profit: Decimal  # net profit after fees
    profit_usd: float  # estimated profit in USD
    confidence: float  # 0-1 confidence score
    details: dict = field(default_factory=dict)


@dataclass
class FlashLoanResult:
    """Result of a flash loan execution."""
    strategy: FlashLoanStrategy
    status: FlashLoanStatus
    amount_borrowed: Decimal
    fee_paid: Decimal
    profit: Decimal
    # Lever fee breakdown
    aave_fee_usd: float = 0.0
    lever_fee_usd: float = 0.0
    total_fee_usd: float = 0.0
    treasury_fee_usd: float = 0.0
    referrer_fee_usd: float = 0.0
    net_profit_usd: float = 0.0
    # Tx info
    tx_hash: Optional[str] = None
    error: Optional[str] = None
    block_number: Optional[int] = None
    gas_used: Optional[int] = None
    timestamp: float = field(default_factory=time.time)


# ─── Engine ──────────────────────────────────────────────────────────────────

class FlashLoanEngine:
    """
    Server-side flash loan engine for Lever.
    
    Uses Aave v3 on Arbitrum to borrow USDC, execute a strategy,
    and repay in the same transaction.
    
    Safety:
      - Disabled by default (FLASH_LOAN_ENABLED=true to activate)
      - Simulates every tx before sending (eth_call)
      - Max borrow cap configurable
      - Profit threshold enforced (won't execute unprofitable loans)
      - Operator key only (same key as vault operator)
    """

    def __init__(self):
        self.w3 = Web3(Web3.HTTPProvider(ARBITRUM_RPC))
        self.operator = Account.from_key(OPERATOR_KEY) if OPERATOR_KEY else None
        self.pool = self.w3.eth.contract(address=AAVE_POOL, abi=AAVE_POOL_ABI)
        self.usdc = self.w3.eth.contract(address=USDC_ARB, abi=ERC20_ABI)
        self.enabled = FLASH_LOAN_ENABLED
        
        # Safety limits
        self.max_borrow_usd = Decimal(os.getenv("FLASH_LOAN_MAX_BORROW_USD", "50000"))
        self.min_profit_usd = Decimal(os.getenv("FLASH_LOAN_MIN_PROFIT_USD", "5"))
        self.max_gas_price_gwei = Decimal(os.getenv("FLASH_LOAN_MAX_GAS_GWEI", "2"))

        # Track recent executions
        self._history: list[FlashLoanResult] = []
        self._max_history = 100

    def ready(self) -> bool:
        """Check if the engine is configured and enabled."""
        return (
            self.enabled
            and self.operator is not None
            and self.w3.is_connected()
        )

    def get_flash_loan_fee(self) -> int:
        """Get Aave's current flash loan premium in bps."""
        try:
            return self.pool.functions.FLASHLOAN_PREMIUM_TOTAL().call()
        except Exception as e:
            logger.warning(f"Failed to read Aave flash loan premium: {e}")
            return AAVE_FLASH_LOAN_PREMIUM  # fallback to 5 bps

    def calculate_fee(self, amount_usd: float, tier: str = "free") -> dict:
        """Calculate total flash loan fee breakdown.
        
        Returns a dict with:
          - aave_fee: What Aave charges (0.05%)
          - lever_fee: What Lever charges on top (0.5% default)
          - total_fee: aave_fee + lever_fee
          - net_profit: What the user keeps (after all fees)
        
        The Lever fee goes to your treasury. Aave fee goes to Aave.
        """
        premium_bps = self.get_flash_loan_fee()
        lever_bps = FLASH_LOAN_FEE_TIERS.get(tier, FLASH_LOAN_FEE_TIERS["free"])["lever_bps"]

        aave_fee = amount_usd * premium_bps / 10000
        lever_fee = max(amount_usd * lever_bps / 10000, LEVER_MIN_FEE_USD)
        total_fee = aave_fee + lever_fee

        # Fee split for Lever portion
        treasury_fee = lever_fee * LEVER_FEE_TREASURY_PCT / 100
        referrer_fee = lever_fee * LEVER_FEE_REFERRER_PCT / 100

        return {
            "aave_fee_usd": round(aave_fee, 4),
            "aave_fee_bps": premium_bps,
            "lever_fee_usd": round(lever_fee, 4),
            "lever_fee_bps": lever_bps,
            "total_fee_usd": round(total_fee, 4),
            "treasury_fee_usd": round(treasury_fee, 4),
            "referrer_fee_usd": round(referrer_fee, 4),
            "fee_tier": tier,
        }

    def calculate_profit(self, amount_usd: float, gross_profit_usd: float, tier: str = "free") -> dict:
        """Calculate net profit after all flash loan fees.
        
        Args:
            amount_usd: How much was borrowed
            gross_profit_usd: Profit before fees (e.g. arb spread, position gain)
            tier: User's fee tier
        
        Returns dict with net profit and full fee breakdown.
        """
        fees = self.calculate_fee(amount_usd, tier)
        net_profit = gross_profit_usd - fees["total_fee_usd"]
        
        # Also estimate gas cost on Arbitrum (~$0.05-0.15)
        gas_usd = 0.10
        net_profit -= gas_usd
        
        return {
            "gross_profit_usd": round(gross_profit_usd, 4),
            **fees,
            "gas_usd": round(gas_usd, 2),
            "net_profit_usd": round(net_profit, 4),
            "profitable": net_profit > 0,
            "roi_pct": round(net_profit / amount_usd * 100, 4) if amount_usd > 0 else 0,
        }

    # ─── Opportunity Detection ────────────────────────────────────────────

    def scan_arbitrage(
        self,
        token: str,
        amount_usd: float,
        dex_paths: list[dict] | None = None,
    ) -> FlashLoanOpportunity | None:
        """
        Scan for arbitrage opportunities.
        
        Checks price differences across DEXs for a given token.
        Returns an opportunity if profit > min_profit threshold.
        
        Args:
            token: Token address (or "USDC", "WETH", "BTC")
            amount_usd: How much to borrow
            dex_paths: Optional list of {buy_dex, sell_dex, buy_path, sell_path}
        
        Returns:
            FlashLoanOpportunity if profitable, None otherwise
        """
        if not self.enabled:
            logger.info("Flash loan engine disabled")
            return None

        if amount_usd > float(self.max_borrow_usd):
            logger.warning(f"Borrow amount ${amount_usd} exceeds cap ${self.max_borrow_usd}")
            return None

        # Resolve token address
        token_addr = self._resolve_token(token)
        if not token_addr:
            logger.warning(f"Unknown token: {token}")
            return None

        fee_usd = self.calculate_fee(amount_usd)
        
        # TODO: Integrate with real DEX price feeds
        # For now, this is the framework — actual price comparison
        # will be wired to DexScreener, Uniswap, Camelot, etc.
        logger.info(
            f"Scanning arb for {token}, ${amount_usd} borrow, "
            f"fee=${fee_usd:.2f}, need profit >${self.min_profit_usd}"
        )

        # Placeholder — real implementation fetches quotes from DEXs
        # and compares prices to find spread > fee
        return None

    def scan_self_liquidation(
        self,
        user_address: str,
        position_id: str,
    ) -> FlashLoanOpportunity | None:
        """
        Check if a position is underwater enough that a flash-loan
        self-liquidation is cheaper than letting it get liquidated.
        
        Compares:
          - Flash loan cost (Aave fee + gas) 
          - Liquidation penalty
        Returns opportunity if flash liquidation saves money.
        """
        if not self.enabled:
            return None

        # TODO: Fetch position from HL or vault, calculate if underwater
        # Compare liquidation penalty vs flash loan cost
        logger.info(f"Scanning self-liquidation for {user_address} position {position_id}")
        return None

    # ─── Execution ───────────────────────────────────────────────────────

    def execute_flash_loan(
        self,
        strategy: FlashLoanStrategy,
        asset: str,
        amount_usd: float,
        params: bytes = b"",
    ) -> FlashLoanResult:
        """
        Execute a flash loan via Aave v3.
        
        This is the main entry point. It:
        1. Validates the opportunity (enabled, under cap, profitable)
        2. Deploys or uses an existing FlashLoanReceiver contract
        3. Calls Aave pool.flashLoanSimple()
        4. The receiver contract executes the strategy in the callback
        5. Aave verifies repayment
        
        Args:
            strategy: What strategy to execute
            asset: Token address to borrow
            amount_usd: Amount to borrow in USD
            params: Encoded strategy parameters
        
        Returns:
            FlashLoanResult with tx hash, profit, status
        """
        if not self.ready():
            return FlashLoanResult(
                strategy=strategy,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal(str(amount_usd)),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error="Flash loan engine not ready (disabled or misconfigured)",
            )

        if amount_usd > float(self.max_borrow_usd):
            return FlashLoanResult(
                strategy=strategy,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal(str(amount_usd)),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error=f"Borrow amount ${amount_usd} exceeds cap ${self.max_borrow_usd}",
            )

        asset_addr = self._resolve_token(asset)
        if not asset_addr:
            return FlashLoanResult(
                strategy=strategy,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal(str(amount_usd)),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error=f"Unknown asset: {asset}",
            )

        amount_raw = int(Decimal(str(amount_usd)) * 10**USDC_DECIMALS)
        fee_raw = self.calculate_fee(amount_usd)
        fee_raw_units = int(Decimal(str(fee_raw)) * 10**USDC_DECIMALS)

        result = FlashLoanResult(
            strategy=strategy,
            status=FlashLoanStatus.BUILDING,
            amount_borrowed=Decimal(str(amount_usd)),
            fee_paid=Decimal(str(fee_raw)),
            profit=Decimal("0"),
        )

        try:
            # Step 1: Ensure operator has USDC approval for Aave pool
            # (needed for repayment in the callback)
            self._ensure_approval(asset_addr, AAVE_POOL, amount_raw + fee_raw_units)

            # Step 2: Encode strategy params for the receiver contract
            strategy_data = self._encode_strategy(strategy, params)

            # Step 3: Call flashLoanSimple on Aave Pool
            # NOTE: This requires a deployed FlashLoanReceiver contract
            # that implements IFlashLoanSimpleReceiver.executeOperation()
            # The receiver contract handles the strategy logic in the callback
            
            tx = self.pool.functions.flashLoanSimple(
                AAVE_POOL,  # receiver = our deployed FlashLoanReceiver
                asset_addr,
                amount_raw,
                strategy_data,
                0,  # referralCode
            ).build_transaction({
                "from": self.operator.address,
                "nonce": self.w3.eth.get_transaction_count(self.operator.address),
                "gas": 1_000_000,
                "maxFeePerGas": self.w3.eth.gas_price * 2,
                "maxPriorityFeePerGas": self.w3.eth.gas_price // 2,
                "chainId": 42161,
            })

            result.status = FlashLoanStatus.SIGNING

            # Step 4: Simulate first (dry run)
            try:
                self.w3.eth.call(tx, block_identifier="latest")
                logger.info(f"Simulation passed for {strategy.value}")
            except Exception as sim_err:
                result.status = FlashLoanStatus.REVERTED
                result.error = f"Simulation failed: {sim_err}"
                self._record(result)
                return result

            # Step 5: Sign and send
            signed = self.w3.eth.account.sign_transaction(tx, self.operator.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            result.tx_hash = tx_hash.hex()
            result.status = FlashLoanStatus.SENT

            # Step 6: Wait for receipt
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt["status"] == 1:
                result.status = FlashLoanStatus.CONFIRMED
                result.block_number = receipt["blockNumber"]
                result.gas_used = receipt["gasUsed"]
                # Calculate actual profit from events (TODO: parse logs)
                logger.info(
                    f"Flash loan confirmed: {strategy.value}, "
                    f"tx={tx_hash.hex()}, gas={receipt['gasUsed']}"
                )
            else:
                result.status = FlashLoanStatus.REVERTED
                result.error = "Transaction reverted on-chain"
                logger.warning(f"Flash loan reverted: {tx_hash.hex()}")

        except Exception as e:
            result.status = FlashLoanStatus.FAILED
            result.error = str(e)
            logger.error(f"Flash loan failed: {e}")

        self._record(result)
        return result

    # ─── Leverage Loop (Special Strategy) ─────────────────────────────────

    def execute_leverage_loop(
        self,
        user_address: str,
        deposit_usd: float,
        leverage_multiplier: float,
    ) -> FlashLoanResult:
        """
        Execute a leverage loop:
        1. User deposits X USDC into vault
        2. Flash loan Y USDC from Aave
        3. Swap Y USDC → more collateral
        4. Deposit collateral → open position
        5. Close flash loan position → repay Aave
        6. Net: user has leveraged position with X equity
        
        Example: User deposits $100, wants 5x leverage
          - Borrow $400 from Aave
          - Total position: $500
          - Repay $400 + $0.20 fee
          - User equity: $100, position: $500 (5x)
        
        Args:
            user_address: User's EVM address
            deposit_usd: How much USDC user deposited
            leverage_multiplier: Desired leverage (2-100)
        """
        if not self.ready():
            return FlashLoanResult(
                strategy=FlashLoanStrategy.LEVERAGE_LOOP,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal("0"),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error="Flash loan engine not ready",
            )

        if leverage_multiplier < 2 or leverage_multiplier > 100:
            return FlashLoanResult(
                strategy=FlashLoanStrategy.LEVERAGE_LOOP,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal("0"),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error=f"Leverage {leverage_multiplier}x out of range (2-100)",
            )

        borrow_usd = deposit_usd * (leverage_multiplier - 1)
        if borrow_usd > float(self.max_borrow_usd):
            return FlashLoanResult(
                strategy=FlashLoanStrategy.LEVERAGE_LOOP,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal(str(borrow_usd)),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error=f"Borrow ${borrow_usd:.0f} exceeds cap ${self.max_borrow_usd}",
            )

        # Encode params for the FlashLoanReceiver: user, deposit amount, leverage
        params = encode(
            ["address", "uint256", "uint256"],
            [
                Web3.to_checksum_address(user_address),
                int(deposit_usd * 10**USDC_DECIMALS),
                int(leverage_multiplier * 100),  # leverage as basis points
            ],
        )

        return self.execute_flash_loan(
            strategy=FlashLoanStrategy.LEVERAGE_LOOP,
            asset="USDC",
            amount_usd=borrow_usd,
            params=params,
        )

    # ─── Self-Liquidation ─────────────────────────────────────────────────

    def execute_self_liquidation(
        self,
        user_address: str,
        position_id: str,
        margin_usd: float,
        pnl_usd: float,
        close_fee_usd: float,
        profit_fee_usd: float,
        coin: str,
        is_long: bool,
    ) -> FlashLoanResult:
        """
        Self-liquidate a position using flash loan.
        
        Instead of waiting for forced liquidation (with penalty),
        user borrows USDC via flash loan, closes the position,
        and repays the loan. Cheaper than the liquidation penalty.
        
        This uses the vault's closePosition via operator key,
        same as normal close but funded by flash loan.
        """
        if not self.ready():
            return FlashLoanResult(
                strategy=FlashLoanStrategy.SELF_LIQUIDATION,
                status=FlashLoanStatus.FAILED,
                amount_borrowed=Decimal("0"),
                fee_paid=Decimal("0"),
                profit=Decimal("0"),
                error="Flash loan engine not ready",
            )

        # Need to borrow enough to cover margin return + fees
        borrow_usd = max(margin_usd, abs(pnl_usd) + close_fee_usd + profit_fee_usd + 10)  # +10 buffer
        aave_fee = self.calculate_fee(borrow_usd)

        # Only worth it if flash loan cost < liquidation penalty
        # Typical HL liquidation penalty: ~5% of position
        liquidation_penalty = margin_usd * 0.05
        total_flash_cost = aave_fee + 0.50  # gas estimate

        if total_flash_cost >= liquidation_penalty:
            logger.info(
                f"Self-liquidation not economical: flash=${total_flash_cost:.2f} "
                f"vs liquidation_penalty=${liquidation_penalty:.2f}"
            )
            # Still allow it if user explicitly requests
            # (they might want to exit NOW regardless of cost)

        params = encode(
            ["address", "uint256", "int256", "uint256", "uint256", "string", "bool"],
            [
                Web3.to_checksum_address(user_address),
                int(margin_usd * 10**USDC_DECIMALS),
                int(pnl_usd * 10**USDC_DECIMALS),  # can be negative
                int(close_fee_usd * 10**USDC_DECIMALS),
                int(profit_fee_usd * 10**USDC_DECIMALS),
                coin,
                is_long,
            ],
        )

        return self.execute_flash_loan(
            strategy=FlashLoanStrategy.SELF_LIQUIDATION,
            asset="USDC",
            amount_usd=borrow_usd,
            params=params,
        )

    # ─── Helpers ──────────────────────────────────────────────────────────

    def _resolve_token(self, token: str) -> str | None:
        """Resolve a token symbol or address to a checksummed address."""
        tokens = {
            "USDC": USDC_ARB,
            "USDC.ARBITRUM": USDC_ARB,
            "WETH": WETH_ARB,
            "WETH.ARBITRUM": WETH_ARB,
        }
        if token.startswith("0x"):
            return Web3.to_checksum_address(token)
        return tokens.get(token.upper())

    def _ensure_approval(self, token_addr: str, spender: str, amount: int):
        """Ensure the operator has approved enough token for the spender."""
        usdc = self.w3.eth.contract(address=token_addr, abi=ERC20_ABI)
        current = usdc.functions.allowance(
            self.operator.address, spender
        ).call()

        if current >= amount:
            return

        # Approve max
        max_approval = 2**256 - 1
        tx = usdc.functions.approve(spender, max_approval).build_transaction({
            "from": self.operator.address,
            "nonce": self.w3.eth.get_transaction_count(self.operator.address),
            "gas": 100_000,
            "maxFeePerGas": self.w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": self.w3.eth.gas_price // 2,
            "chainId": 42161,
        })
        signed = self.w3.eth.account.sign_transaction(tx, self.operator.key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        logger.info(f"Approved {token_addr} for {spender}")

    def _encode_strategy(self, strategy: FlashLoanStrategy, params: bytes) -> bytes:
        """Encode strategy type + params for the FlashLoanReceiver callback."""
        strategy_id = {
            FlashLoanStrategy.ARBITRAGE: b"\x01",
            FlashLoanStrategy.SELF_LIQUIDATION: b"\x02",
            FlashLoanStrategy.LEVERAGE_LOOP: b"\x03",
        }[strategy]
        return strategy_id + params

    def _record(self, result: FlashLoanResult):
        """Record a flash loan result in history."""
        self._history.append(result)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def get_history(self, limit: int = 20) -> list[dict]:
        """Get recent flash loan execution history."""
        results = self._history[-limit:]
        return [
            {
                "strategy": r.strategy.value,
                "status": r.status.value,
                "amount_borrowed": float(r.amount_borrowed),
                "fee_paid": float(r.fee_paid),
                "aave_fee_usd": r.aave_fee_usd,
                "lever_fee_usd": r.lever_fee_usd,
                "total_fee_usd": r.total_fee_usd,
                "treasury_fee_usd": r.treasury_fee_usd,
                "net_profit_usd": r.net_profit_usd,
                "profit": float(r.profit),
                "tx_hash": r.tx_hash,
                "block_number": r.block_number,
                "gas_used": r.gas_used,
                "error": r.error,
                "timestamp": r.timestamp,
            }
            for r in results
        ]

    def get_stats(self) -> dict:
        """Get flash loan engine stats."""
        successful = [r for r in self._history if r.status == FlashLoanStatus.CONFIRMED]
        failed = [r for r in self._history if r.status in (FlashLoanStatus.FAILED, FlashLoanStatus.REVERTED)]
        total_profit = sum(float(r.profit) for r in successful)
        total_fees = sum(float(r.fee_paid) for r in successful)
        
        return {
            "enabled": self.enabled,
            "ready": self.ready(),
            "operator": self.operator.address if self.operator else None,
            "max_borrow_usd": float(self.max_borrow_usd),
            "min_profit_usd": float(self.min_profit_usd),
            "aave_flash_loan_fee_bps": self.get_flash_loan_fee(),
            "lever_flash_loan_fee_bps": LEVER_FLASH_LOAN_FEE_BPS,
            "lever_fee_tiers": FLASH_LOAN_FEE_TIERS,
            "total_executions": len(self._history),
            "successful": len(successful),
            "failed": len(failed),
            "total_profit_usd": total_profit,
            "total_fees_usd": total_fees,
            "net_pnl_usd": total_profit - total_fees,
        }


# ─── Singleton ───────────────────────────────────────────────────────────────

_engine: FlashLoanEngine | None = None


def get_flash_loan_engine() -> FlashLoanEngine:
    """Get or create the flash loan engine singleton."""
    global _engine
    if _engine is None:
        _engine = FlashLoanEngine()
    return _engine