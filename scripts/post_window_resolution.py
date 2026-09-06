#!/usr/bin/env python3
"""Complete a dispute round after the 24h response window has closed.

Reads the dispute record on-chain, resolves the dispute through a fresh
validator-consensus adjudication, and appends the settlement outcome to
docs/deployment_log.json.

Usage:

    export PROOFMILE_PRIVATE_KEY=0x...          # either party's key
    .venv/bin/python scripts/post_window_resolution.py <contract> <milestone_id>
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = ROOT / "docs" / "deployment_log.json"


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: post_window_resolution.py <contract_address> "
              "<milestone_id>", file=sys.stderr)
        sys.exit(2)

    address, milestone_id = sys.argv[1], int(sys.argv[2])

    pk = os.environ.get("PROOFMILE_PRIVATE_KEY")
    if not pk:
        print("error: set PROOFMILE_PRIVATE_KEY", file=sys.stderr)
        sys.exit(1)

    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionStatus

    account = create_account(pk)
    client = create_client(chain=studionet, account=account)

    dispute = json.loads(client.read_contract(
        address=address, function_name="get_dispute",
        args=[milestone_id]))
    if "error" in dispute:
        print("no dispute on milestone %d" % milestone_id)
        sys.exit(1)
    if dispute["status"] != "OPEN":
        print("dispute is %s - nothing to resolve" % dispute["status"])
        sys.exit(0)

    remaining = int(dispute["response_deadline"]) - int(time.time())
    if remaining > 0:
        print("response window still open: %d seconds remain" % remaining)
        sys.exit(1)

    tx_hash = client.write_contract(
        address=address, function_name="resolve_dispute",
        args=[milestone_id])
    receipt = client.wait_for_transaction_receipt(
        hash=tx_hash, status=TransactionStatus.FINALIZED,
        interval=5000, retries=80)

    record = json.loads(client.read_contract(
        address=address, function_name="get_milestone",
        args=[milestone_id]))

    entry = {
        "kind": "post_window_resolution",
        "network": "studionet",
        "chain_id": 61999,
        "contract": address,
        "milestone_id": milestone_id,
        "tx_hash": str(tx_hash),
        "finished_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                         time.gmtime()),
        "final_status": record["status"],
        "final_decision": record.get("verdict", {}).get("decision"),
    }

    log = {"network": "studionet", "chain_id": 61999, "deployments": [],
           "runs": []}
    if LOG_PATH.exists():
        try:
            log = json.loads(LOG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    log.setdefault("runs", []).append(entry)
    LOG_PATH.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")

    print("resolved: %s -> %s" % (tx_hash, record["status"]))
    print("log     : docs/deployment_log.json updated")


if __name__ == "__main__":
    main()
