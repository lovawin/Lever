#!/usr/bin/env python3
"""
Lever Flash Loan Test Script

Tests the flash loan system without executing real transactions.
Run: python3 test_flash_loan.py

What this tests:
1. Fee calculations (are the numbers right?)
2. Price oracle (can we get real prices from DEXs?)
3. Arb scanner (can we find price differences?)
4. Simulation (what would a flash loan look like?)
5. Strategy math (leverage loops, self-liquidation savings)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from backend.app.flash_loan import (
    get_flash_loan_engine, FlashLoanStrategy, FLASH_LOAN_FEE_TIERS,
    LEVER_FLASH_LOAN_FEE_BPS, AAVE_FLASH_LOAN_FEE_BPS,
)
from backend.app.price_oracle import get_price_oracle


def print_header(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


def test_fee_calculations():
    """Test 1: Are fee calculations correct?"""
    print_header("1. Fee Calculations")
    engine = get_flash_loan_engine()
    
    amounts = [100, 1000, 10000, 100000]
    
    for amount in amounts:
        for tier in ["free", "iron", "silver", "gold", "diamond"]:
            fees = engine.calculate_fee(amount, tier)
            profit = engine.calculate_profit(amount, amount * 0.01, tier)  # 1% gross profit
            
            print(f"  ${amount:>7,} ({tier:7s}): "
                  f"Aave ${fees['aave_fee_usd']:>6.2f} + "
                  f"Lever ${fees['lever_fee_usd']:>6.2f} = "
                  f"Total ${fees['total_fee_usd']:>6.2f}  "
                  f"| Net on 1% gain: ${profit['net_profit_usd']:>7.2f} "
                  f"({'✅ profit' if profit['profitable'] else '❌ loss'})")
    
    print(f"\n  Aave fee: {AAVE_FLASH_LOAN_FEE_BPS} bps (0.05%)")
    print(f"  Lever fee: {LEVER_FLASH_LOAN_FEE_BPS} bps (0.50%)")
    print(f"  Min profitable spread: {engine.min_profit_usd}")


def test_leverage_loop_math():
    """Test 2: Leverage loop math — how much does it cost to 5x?"""
    print_header("2. Leverage Loop Math")
    engine = get_flash_loan_engine()
    
    print("  How it works:")
    print("  User deposits $100 → borrows $400 from Aave → trades $500")
    print("  Total cost = Aave fee (0.05%) + Lever fee (0.5%)\n")
    
    scenarios = [
        (100, 5),    # $100 deposit, 5x leverage
        (500, 10),   # $500 deposit, 10x leverage
        (1000, 3),   # $1000 deposit, 3x leverage
        (5000, 50),  # $5000 deposit, 50x leverage
    ]
    
    for deposit, leverage in scenarios:
        borrow = deposit * (leverage - 1)
        position = deposit * leverage
        fees = engine.calculate_fee(borrow, "free")
        
        print(f"  Deposit ${deposit:,} × {leverage}x leverage:")
        print(f"    Borrow from Aave: ${borrow:,}")
        print(f"    Total position:   ${position:,}")
        print(f"    Aave fee:         ${fees['aave_fee_usd']:.2f}")
        print(f"    Lever fee:        ${fees['lever_fee_usd']:.2f}")
        print(f"    Total cost:       ${fees['total_fee_usd']:.2f}")
        print(f"    Cost as % of equity: {fees['total_fee_usd']/deposit*100:.2f}%")
        print()


def test_self_liquidation_savings():
    """Test 3: Self-liquidation — is it cheaper than forced liquidation?"""
    print_header("3. Self-Liquidation Savings")
    engine = get_flash_loan_engine()
    
    print("  HL liquidation penalty: ~5% of position")
    print("  Flash loan total cost: 0.55% of position (Aave + Lever)\n")
    
    positions = [100, 500, 1000, 5000, 10000]
    
    for margin in positions:
        hl_penalty = margin * 0.05
        fees = engine.calculate_fee(margin, "free")
        savings = hl_penalty - fees['total_fee_usd']
        
        print(f"  Position ${margin:>6,}: "
              f"HL penalty ${hl_penalty:>6.2f} vs "
              f"Flash loan ${fees['total_fee_usd']:>6.2f} → "
              f"Save ${savings:>6.2f} ({'✅' if savings > 0 else '❌'})")


async def test_price_oracle():
    """Test 4: Can we get real prices?"""
    print_header("4. Price Oracle (DexScreener)")
    oracle = get_price_oracle()
    
    tokens = ["WETH", "WBTC", "ARB"]
    
    for token in tokens:
        print(f"  Fetching USDC/{token} prices...")
        try:
            quotes = await oracle.get_prices("USDC", token, amount=1000)
            if quotes:
                for dex, q in quotes.items():
                    print(f"    {dex:>20s}: {q.price:.6f} USDC/{token} "
                          f"(confidence: {q.confidence:.1f})")
            else:
                print(f"    No quotes found for {token}")
        except Exception as e:
            print(f"    Error: {e}")
        print()


async def test_arb_scanner():
    """Test 5: Can we find arbitrage opportunities?"""
    print_header("5. Arbitrage Scanner")
    oracle = get_price_oracle()
    
    tokens = ["WETH", "WBTC", "ARB"]
    
    for token in tokens:
        print(f"  Scanning {token}...")
        try:
            opportunities = await oracle.find_arbitrage(token, amount_usd=10000)
            if opportunities:
                for opp in opportunities[:3]:  # top 3
                    print(f"    {opp.buy_dex:>15s} → {opp.sell_dex:>15s}: "
                          f"spread {opp.spread_bps:.1f} bps "
                          f"(${opp.spread_usd:.2f}) "
                          f"profit ${opp.estimated_profit_usd:.2f} "
                          f"{'✅' if opp.profitable else '❌'}")
            else:
                print(f"    No arb opportunities found (good — markets are efficient)")
        except Exception as e:
            print(f"    Error: {e}")
        print()


def test_engine_status():
    """Test 6: Engine status check."""
    print_header("6. Engine Status")
    engine = get_flash_loan_engine()
    
    stats = engine.get_stats()
    for k, v in stats.items():
        print(f"  {k}: {v}")


async def run_all_tests():
    print("\n" + "⚡" * 30)
    print("  LEVER FLASH LOAN TEST SUITE")
    print("  All tests are simulations — NO REAL TRANSACTIONS")
    print("⚡" * 30)
    
    # Sync tests
    test_fee_calculations()
    test_leverage_loop_math()
    test_self_liquidation_savings()
    test_engine_status()
    
    # Async tests (need network)
    await test_price_oracle()
    await test_arb_scanner()
    
    print_header("Done!")
    print("  To enable real flash loans, set these env vars:")
    print("    FLASH_LOAN_ENABLED=true")
    print("    FLASH_LOAN_MAX_BORROW_USD=50000")
    print("    FLASH_LOAN_MIN_PROFIT_USD=5")
    print()
    print("  To test the API endpoints, start the server:")
    print("    cd backend && uvicorn app.main:app --reload")
    print()
    print("  Then try:")
    print("    curl http://localhost:8000/api/flash-loan/status")
    print("    curl http://localhost:8000/api/flash-loan/fee-tiers")
    print("    curl -X POST http://localhost:8000/api/flash-loan/simulate")
    print()


if __name__ == "__main__":
    asyncio.run(run_all_tests())