"""
Approve a Hyperliquid API wallet (agent wallet) on behalf of the master account.

This allows the agent wallet to sign trades on HL without exposing the master key.

Usage:
  python approve_agent.py

Requires .env with:
  HL_PRIVATE_KEY — master account private key
  HL_AGENT_ADDRESS — agent wallet address to approve
  HL_API_URL — https://api.hyperliquid.xyz (or testnet)
"""

import os
import sys
import time
import json
import struct
from eth_account import Account
from eth_account.messages import encode_structured_data
import requests

# Load .env manually
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
MASTER_KEY = os.getenv("HL_PRIVATE_KEY", "")
AGENT_ADDRESS = os.getenv("HL_AGENT_ADDRESS", "")

if not MASTER_KEY or not AGENT_ADDRESS:
    print("ERROR: Set HL_PRIVATE_KEY and HL_AGENT_ADDRESS in .env")
    sys.exit(1)

if not MASTER_KEY.startswith("0x"):
    MASTER_KEY = "0x" + MASTER_KEY

master_account = Account.from_key(MASTER_KEY)
print(f"Master account: {master_account.address}")
print(f"Agent to approve: {AGENT_ADDRESS}")


# ─── Msgpack-ish encoder (minimal, for HL actions) ──────────────────────────

def encode_action(action: dict) -> bytes:
    """Encode an HL action to msgpack-like format using msgpack library."""
    try:
        import msgpack
        return msgpack.packb(action)
    except ImportError:
        print("ERROR: msgpack not installed. Run: pip install msgpack")
        sys.exit(1)


def sign_action(action: dict, nonce: int, private_key: str) -> dict:
    """Sign an HL L1 action with EIP-712."""
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    action_bytes = encode_action(action)

    # EIP-712 structured data for Hyperliquid
    # Domain: { name: "Exchange", version: "1", chainId: 1337 }
    structured_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
            ],
            "Action": [
                {"name": "action", "type": "bytes"},
                {"name": "nonce", "type": "uint256"},
            ],
        },
        "primaryType": "Action",
        "domain": {
            "name": "Exchange",
            "version": "1",
            "chainId": 1337,
        },
        "message": {
            "action": action_bytes.hex(),
            "nonce": nonce,
        },
    }

    account = Account.from_key(private_key)
    signed = account.sign_message(encode_structured_data(structured_data))

    return {
        "action": action,
        "nonce": nonce,
        "signature": {
            "r": hex(signed.r),
            "s": hex(signed.s),
            "v": signed.v,
        },
    }


def approve_agent():
    """Approve an API/agent wallet on Hyperliquid."""
    nonce = int(time.time() * 1000)

    action = {
        "type": "approveAgent",
        "agentAddress": AGENT_ADDRESS,
        "agentName": "LeverBot",
    }

    payload = sign_action(action, nonce, MASTER_KEY)

    print(f"\nApproving agent {AGENT_ADDRESS} on {HL_API_URL}...")
    print(f"Nonce: {nonce}")

    response = requests.post(
        f"{HL_API_URL}/exchange",
        json=payload,
        headers={"Content-Type": "application/json"},
    )

    print(f"\nResponse status: {response.status_code}")
    result = response.json()
    print(json.dumps(result, indent=2))

    if response.status_code == 200 and result.get("status") == "ok":
        print("\nSUCCESS: Agent wallet approved!")
        print(f"Master: {master_account.address}")
        print(f"Agent:  {AGENT_ADDRESS}")
    else:
        print("\nFAILED. Check the error above.")
        print("Common issues:")
        print("  - Master account has no USDC on HL")
        print("  - Need to use VPN (geo-blocked)")
        print("  - Wrong network (use testnet first)")


if __name__ == "__main__":
    approve_agent()