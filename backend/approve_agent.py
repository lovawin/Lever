"""
Approve a specific Hyperliquid API wallet (agent) on behalf of the master account.

Usage:
  python approve_agent.py
"""

import os
import sys
import time
import json
import requests
from eth_account import Account
from hyperliquid.utils.signing import sign_agent, get_timestamp_ms

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

MASTER_KEY = os.getenv("HL_PRIVATE_KEY", "")
AGENT_ADDRESS = os.getenv("HL_AGENT_ADDRESS", "")
HL_API_URL = os.getenv("HL_API_URL", "https://api.hyperliquid.xyz")

if not MASTER_KEY or not AGENT_ADDRESS:
    print("ERROR: Set HL_PRIVATE_KEY and HL_AGENT_ADDRESS in .env")
    sys.exit(1)

if not MASTER_KEY.startswith("0x"):
    MASTER_KEY = "***" + MASTER_KEY

master_account = Account.from_key(MASTER_KEY)
is_mainnet = "hyperliquid.xyz" in HL_API_URL and "testnet" not in HL_API_URL

print(f"Master account: {master_account.address}")
print(f"Agent to approve: {AGENT_ADDRESS}")
print(f"API URL: {HL_API_URL} ({'mainnet' if is_mainnet else 'testnet'})")

nonce = get_timestamp_ms()

action = {
    "type": "approveAgent",
    "agentAddress": AGENT_ADDRESS,
    "agentName": "LeverBot",
    "nonce": nonce,
}

signature = sign_agent(master_account, action, is_mainnet)

payload = {
    "action": action,
    "nonce": nonce,
    "signature": signature,
}

print(f"\nApproving agent {AGENT_ADDRESS}...")
print(f"Nonce: {nonce}")

response = requests.post(
    f"{HL_API_URL}/exchange",
    json=payload,
    headers={"Content-Type": "application/json"},
    timeout=15,
)

print(f"\nResponse status: {response.status_code}")
result = response.json()
print(json.dumps(result, indent=2))

if response.status_code == 200:
    status = result.get("status", "")
    if status == "ok":
        print("\n✅ SUCCESS: Agent wallet approved!")
        print(f"  Master: {master_account.address}")
        print(f"  Agent:  {AGENT_ADDRESS}")
    else:
        print(f"\n⚠️  Status: {status}")
        if "insufficient" in str(result).lower():
            print("Master account needs USDC on HL first. Deposit via app.hyperliquid.xyz (use VPN).")
else:
    print(f"\n❌ HTTP error: {response.status_code}")

# Verify
print("\n--- Verifying account ---")
try:
    r = requests.post(f"{HL_API_URL}/info", json={
        "type": "clearinghouseState",
        "user": master_account.address,
    }, timeout=10)
    if r.status_code == 200:
        state = r.json()
        margin = state.get("marginSummary", {})
        total = float(margin.get("totalMarginValue", "0"))
        print(f"  Total margin on HL: ${total:,.2f}")
except Exception as e:
    print(f"  Could not verify: {e}")