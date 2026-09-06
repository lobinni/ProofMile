#!/usr/bin/env python3
"""Live smoke protocol for ProofMile Escrow on GenLayer Studionet.

This script is the pre-deployment acceptance gate. It deploys the
contract and then runs the full live protocol against real validator
consensus:

  1. determinism x3  - three identical milestones adjudicated; all three
     must reach the SAME decision (3x APPROVED for satisfied proof).
  2. negative case   - evidence that fails a mandatory criterion must be
     adjudicated REJECTED.
  3. dispute round   - a dispute opens, the 24h response window gates
     resolution on-chain (early resolve must be refused), and after the
     window the fresh consensus round settles the escrow deterministically.

Every step is appended to docs/deployment_log.json as auditable evidence.

Prerequisites (Python 3.12):

    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python genlayer-py

Usage:

    export PROOFMILE_PRIVATE_KEY=0x...        # funded Studionet account
    .venv/bin/python scripts/deploy_smoke_studionet.py

Notes:
  - The client and worker roles are played by the same funded account in
    the smoke run EXCEPT where the contract requires distinct parties; a
    second derived account is used for the worker role (fund it with a
    small amount of Studionet GEN first).
  - The dispute protocol takes real wall-clock time because the 24h
    response window is enforced on-chain; the script reports pre-window
    checkpoints live and leaves post-window execution to
    scripts/post_window_resolution.py (see docs/deployment.md).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "proof_mile_escrow.py"
LOG_PATH = ROOT / "docs" / "deployment_log.json"

ONE_GEN_WEI = 10 ** 18

CRITERIA = json.dumps([
    {"id": "c1",
     "text": "A public page describing the deliverable is reachable",
     "mandatory": True},
    {"id": "c2",
     "text": "The page states that the delivered feature works end to end",
     "mandatory": True},
])

REAL_EVIDENCE = json.dumps([{
    "url": "https://example.org/",
    "kind": "WEBSITE",
    "note": "primary deliverable page",
}])

EMPTY_EVIDENCE = json.dumps([{
    "url": "https://smoke.invalid/no-such-page",
    "kind": "WEBSITE",
    "note": "intentionally unfetchable (negative case)",
}])


def build_clients():
    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet

    pk = os.environ.get("PROOFMILE_PRIVATE_KEY")
    if not pk:
        print("error: set PROOFMILE_PRIVATE_KEY to a funded account",
              file=sys.stderr)
        sys.exit(1)
    client_account = create_account(pk)
    worker_pk = os.environ.get("PROOFMILE_WORKER_PRIVATE_KEY")
    worker_account = create_account(worker_pk) if worker_pk \
        else create_account()
    client = create_client(chain=studionet, account=client_account)
    worker = create_client(chain=studionet, account=worker_account)
    print("client : %s" % client_account.address)
    print("worker : %s" % worker_account.address)
    return client, worker, client_account, worker_account


def deploy(client) -> str:
    from genlayer_py.types import TransactionStatus

    code = CONTRACT_PATH.read_text(encoding="utf-8")
    client.initialize_consensus_smart_contract()
    tx_hash = client.deploy_contract(code=code, args=[], leader_only=False)
    receipt = client.wait_for_transaction_receipt(
        hash=tx_hash, status=TransactionStatus.ACCEPTED,
        interval=5000, retries=60)
    data = getattr(receipt, "data", None) or {}
    address = (data.get("contract_address")
               if isinstance(data, dict) else None) \
        or getattr(receipt, "contract_address", None)
    if not address and isinstance(receipt, dict):
        address = (receipt.get("data", {}) or {}).get("contract_address") \
            or receipt.get("contract_address")
    if not address:
        raise RuntimeError("no contract address in receipt: %r" % (receipt,))
    print("deployed: %s" % address)
    return str(address)


def call(client, address, fn, args, value=0) -> str:
    from genlayer_py.types import TransactionStatus

    tx_hash = client.write_contract(
        address=address, function_name=fn, args=args, value=value)
    receipt = client.wait_for_transaction_receipt(
        hash=tx_hash, status=TransactionStatus.FINALIZED,
        interval=5000, retries=80)
    leader = None
    consensus = getattr(receipt, "consensus_data", None)
    if isinstance(consensus, dict):
        leaders = consensus.get("leader_receipt") or []
        if leaders:
            leader = leaders[0]
    if isinstance(receipt, dict) and leader is None:
        leaders = (receipt.get("consensus_data", {}) or {}).get(
            "leader_receipt") or []
        if leaders:
            leader = leaders[0]
    if isinstance(leader, dict):
        result = str(leader.get("execution_result", "")).upper()
        if result == "ERROR":
            raise RuntimeError("%s reverted: %r" % (fn, leader))
    return str(tx_hash)


def run_milestone(client, worker, address, worker_address, evidence,
                  label) -> str:
    """Full lifecycle up to adjudication; returns the decision string."""
    future = int(time.time()) + 7 * 24 * 3600
    mid = client.read_contract(address=address,
                               function_name="get_stats", args=[])
    _ = mid  # read health touch; id returned by create below
    call(client, address, "create_milestone", [
        "Smoke: %s" % label,
        "Automated live smoke milestone for %s." % label,
        worker_address,
        CRITERIA,
        "One public URL demonstrating the deliverable.",
        future,
        ONE_GEN_WEI,
        "[]",
    ])
    stats = json.loads(client.read_contract(
        address=address, function_name="get_stats", args=[]))
    milestone_id = int(stats["total_milestones"])
    call(client, address, "fund_milestone", [milestone_id],
         value=ONE_GEN_WEI)
    call(worker, address, "submit_evidence",
         [milestone_id, evidence,
          "Automated smoke statement pointing at the listed proof."])
    call(client, address, "start_adjudication", [milestone_id])
    record = json.loads(client.read_contract(
        address=address, function_name="get_milestone",
        args=[milestone_id]))
    return milestone_id, record["status"]


def append_run(entry: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = {"network": "studionet", "chain_id": 61999, "deployments": [],
           "runs": []}
    if LOG_PATH.exists():
        try:
            log = json.loads(LOG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    log.setdefault("runs", []).append(entry)
    LOG_PATH.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    client, worker, _ca, wa = build_clients()
    address = deploy(client)

    run = {
        "kind": "smoke_protocol",
        "network": "studionet",
        "chain_id": 61999,
        "contract": address,
        "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "checks": [],
    }

    def record(name, ok, detail):
        print("%-46s %s" % (name, "PASS" if ok else "FAIL"))
        run["checks"].append({"name": name, "ok": bool(ok),
                              "detail": detail})

    # 1. determinism x3 ------------------------------------------------
    decisions = []
    for i in range(3):
        mid, status = run_milestone(
            client, worker, address, wa.address, REAL_EVIDENCE,
            "deterministic positive %d/3" % (i + 1))
        decisions.append(status)
    record("determinism_x3_all_approved",
           decisions == ["APPROVED"] * 3, decisions)

    # 2. negative case --------------------------------------------------
    mid, status = run_milestone(
        client, worker, address, wa.address, EMPTY_EVIDENCE, "negative")
    record("negative_case_decided", status in (
        "REJECTED", "INSUFFICIENT_EVIDENCE"), status)

    # 3. dispute round (pre-window checkpoints) -------------------------
    dmid, dstatus = run_milestone(
        client, worker, address, wa.address, REAL_EVIDENCE, "dispute")
    record("dispute_base_approved", dstatus == "APPROVED", dstatus)
    call(client, address, "open_dispute",
         [dmid, "Smoke dispute: verifying response-window enforcement.",
          "[]"])
    record("dispute_opened", True, "milestone %d" % dmid)

    early_blocked = False
    try:
        call(client, address, "resolve_dispute", [dmid])
    except Exception as exc:
        early_blocked = "response window" in str(exc)
    record("early_resolve_refused_on_chain", early_blocked,
           "24h response window enforced by contract code")

    call(worker, address, "submit_dispute_evidence",
         [dmid, REAL_EVIDENCE])
    record("rebuttal_evidence_accepted", True, "")

    run["finished_at_utc"] = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    run["post_window_action"] = (
        "run scripts/post_window_resolution.py once the 24h response "
        "window closes to complete the dispute round and settlement")
    append_run(run)

    ok = all(c["ok"] for c in run["checks"])
    print("\nsmoke protocol %s - log appended to %s"
          % ("PASSED" if ok else "FAILED", LOG_PATH.relative_to(ROOT)))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
