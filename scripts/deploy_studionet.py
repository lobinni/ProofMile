#!/usr/bin/env python3
"""Deploy the ProofMile Escrow Intelligent Contract to GenLayer Studionet.

Runs a full-consensus deployment, waits for the transaction to be
ACCEPTED, verifies the contract answers its read methods, and appends the
deployment record to docs/deployment_log.json.

Prerequisites (Python 3.12):

    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python genlayer-py

Usage:

    # a fresh ephemeral account is generated unless PROOFMILE_PRIVATE_KEY
    # is set; fund it with Studionet GEN before running either way
    .venv/bin/python scripts/deploy_studionet.py

The printed contract address is the ONLY value you need afterwards:
paste it into NEXT_PUBLIC_CONTRACT_ADDRESS (see .env.example).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "proof_mile_escrow.py"
LOG_PATH = ROOT / "docs" / "deployment_log.json"


def build_client():
    """Create a Studionet client (genlayer-py mirrors genlayer-js)."""
    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet

    private_key = os.environ.get("PROOFMILE_PRIVATE_KEY")
    if private_key:
        account = create_account(private_key)
        print("account : %s (from PROOFMILE_PRIVATE_KEY)" % account.address)
    else:
        account = create_account()
        print("account : %s (ephemeral - keep the key if you need it)"
              % account.address)
        print("warning : set PROOFMILE_PRIVATE_KEY to reuse this account")
    client = create_client(chain=studionet, account=account)
    return client, account


def deploy(client) -> tuple[str, str]:
    from genlayer_py.types import TransactionStatus

    code = CONTRACT_PATH.read_text(encoding="utf-8")
    print("deploying %s (%d bytes) to Studionet..."
          % (CONTRACT_PATH.name, len(code)))

    client.initialize_consensus_smart_contract()
    tx_hash = client.deploy_contract(code=code, args=[], leader_only=False)
    print("tx hash : %s" % tx_hash)

    receipt = client.wait_for_transaction_receipt(
        hash=tx_hash, status=TransactionStatus.ACCEPTED,
        interval=5000, retries=60)

    address = None
    data = getattr(receipt, "data", None) or {}
    if isinstance(receipt, dict):
        address = (receipt.get("data", {}) or {}).get("contract_address") \
            or receipt.get("contract_address")
    else:
        address = data.get("contract_address") \
            or getattr(receipt, "contract_address", None)
    if not address:
        raise RuntimeError(
            "deployment accepted but no contract address found in receipt: %r"
            % (receipt,))
    return str(tx_hash), str(address)


def smoke_read(client, address: str) -> dict:
    """Verify the fresh deployment answers its view methods."""
    params = client.read_contract(
        address=address, function_name="get_params", args=[])
    stats = client.read_contract(
        address=address, function_name="get_stats", args=[])
    return {
        "params_legible": isinstance(params, str) and "dispute" in params,
        "stats_legible": stats is not None,
        "params": json.loads(params) if isinstance(params, str) else params,
    }


def append_log(entry: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = {"network": "studionet", "chain_id": 61999, "deployments": [],
           "runs": []}
    if LOG_PATH.exists():
        try:
            log = json.loads(LOG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    log.setdefault("deployments", []).append(entry)
    LOG_PATH.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")
    print("log     : %s updated" % LOG_PATH.relative_to(ROOT))


def main() -> None:
    client, _account = build_client()
    tx_hash, address = deploy(client)
    time.sleep(2)
    checks = smoke_read(client, address)

    entry = {
        "network": "studionet",
        "chain_id": 61999,
        "contract": CONTRACT_PATH.name,
        "tx_hash": tx_hash,
        "address": address,
        "deployed_at_utc": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "explorer": ("https://explorer-studio.genlayer.com/address/"
                     + address),
        "post_deploy_checks": {
            "params_legible": checks["params_legible"],
            "stats_legible": checks["stats_legible"],
        },
    }
    append_log(entry)

    print("\n=== ProofMile Escrow deployed ===")
    print("address : %s" % address)
    print("explorer: %s" % entry["explorer"])
    print("\nNext step: set NEXT_PUBLIC_CONTRACT_ADDRESS=%s" % address)
    print("in .env.local / .env, then restart the dApp.")


if __name__ == "__main__":
    main()
