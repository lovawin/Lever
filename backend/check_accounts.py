"""
Check Hyperliquid account status for the master wallet.
Also check Arbitrum USDC balance.

Usage:
  python check_accounts.py
"""

import os
import sys
import json
import requests
from web3 import Web3

# Load .env
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        print(f"ERROR: .env not found at {env_path}")
        sys.exit(1)
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

load_env()

HL_API_URL = os.getenv("HL_API_URL", "https://api.hyperliquid.xyz")
ARBITRUM_RPC = os.getenv("ARBITRUM_RPC", "https://arb1.arbitrum.io/rpc")
MASTER_KEY = os.getenv("HL_PRIVATE_KEY", "")
TREASURY = os.getenv("TREASURY_ADDRESS", "")

if MASTER_KEY and not MASTER_KEY.startswith("0x"):
    MASTER_KEY = "0x" + MASTER_KEY

from eth_account import Account
master = Account.from_key(MASTER_KEY) if MASTER_KEY else None

USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
USDC_ABI = [{"inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}]

print("=" * 60)
print("LEVER — Account Status")
print("=" * 60)

# Master account
if master:
    print(f"\nMaster account: {master.address}")
else:
    print("\nNo HL_PRIVATE_KEY set")

# Treasury
print(f"Treasury:        {TREASURY}")

# Check Arbitrum USDC balances
print("\n--- Arbitrum USDC Balances ---")
w3 = Web3(Web3.HTTPProvider(ARBITRUM_RPC))
usdc = w3.eth.contract(address=Web3.to_checksum_address(USDC_ARB), abi=USDC_ABI)

for label, addr in [
    ("Master", master.address if master else None),
    ("Treasury", TREASURY),
]:
    if not addr:
        continue
    try:
        bal = usdc.functions.balanceOf(Web3.to_checksum_address(addr)).call()
        print(f"  {label} ({addr[:10]}...{addr[-6:]}): {bal / 1e6:.2f} USDC")
    except Exception as e:
        print(f"  {label}: Error - {e}")

# Check ETH balances
print("\n--- Arbitrum ETH Balances ---")
for label, addr in [
    ("Master", master.address if master else None),
    ("Treasury", TREASURY),
]:
    if not addr:
        continue
    try:
        eth_bal = w3.eth.get_balance(Web3.to_checksum_address(addr))
        print(f"  {label} ({addr[:10]}...{addr[-6:]}): {eth_bal / 1e18:.6f} ETH")
    except Exception as e:
        print(f"  {label}: Error - {e}")

# Check HL account
if master:
    print("\n--- Hyperliquid Account ---")
    try:
        # Clearinghouse state (balances, positions)
        r = requests.post(f"{HL_API_URL}/info", json={
            "type": "clearinghouseState",
            "user": master.address,
        }, timeout=10)
        if r.status_code == 200:
            state = r.json()
            margin = state.get("marginSummary", {})
            total_value = float(margin.get("totalMarginValue", "0"))
            total_position = float(margin.get("totalNtlPos", "0"))
            available = float(margin.get("availableMargin", "0"))
            print(f"  Total margin:    ${total_value:,.2f}")
            print(f"  Total positions: ${total_position:,.2f}")
            print(f"  Available:       ${available:,.2f}")
            positions = state.get("assetPositions", [])
            if positions:
                print(f"  Open positions:  {len(positions)}")
                for p in positions:
                    pos = p.get("position", {})
                    print(f"    {pos.get('coin', '?')} {pos.get('side', '?')} {pos.get('szi', '0')} @ {pos.get('entryPx', '?')}")
            else:
                print("  No open positions")
        else:
            print(f"  API error: {r.status_code}")
    except Exception as e:
        print(f"  Error: {e}")
        print("  (May be geo-blocked — use VPN)")

    # Check open orders
    try:
        r = requests.post(f"{HL_API_URL}/info", json={
            "type": "openOrders",
            "user": master.address,
        }, timeout=10)
        if r.status_code == 200:
            orders = r.json()
            if orders:
                print(f"  Open orders: {len(orders)}")
            else:
                print("  No open orders")
    except Exception:
        pass

print("\n" + "=" * 60)
print("Next steps:")
print("  1. Send ETH to master account for gas (Arbitrum)")
print("  2. Send USDC to master account on Arbitrum")
print("  3. Bridge USDC from Arbitrum to Hyperliquid L1")
print("  4. Run: python approve_agent.py (with VPN)")
print("  5. Deploy LeverVault with these addresses")
print("=" * 60)