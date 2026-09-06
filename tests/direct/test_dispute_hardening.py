"""Dispute-hardening regression suite for ProofMile Escrow.

Covers: the 24h dispute response window and its boundaries, the optional
opening-evidence policy, both-party rebuttal access, fair fetch-budget
allocation between base and rebuttal evidence, order-independence, and
window interplay (open window vs response window).

Run:
    .venv/bin/python -m pytest tests/direct/test_dispute_hardening.py -v
"""
import json

import pytest

import helpers as H
from helpers import (
    CONTRACT, AMOUNT, PAGE_BODY, BIG_BODY, BIG_BODY_6K,
    addr_str, create_milestone, epoch_in_days, epoch_to_iso, fund,
    balance_of, llm_all_pass, llm_c1_fail, make_criteria, submit_evidence,
    open_dispute, add_rebuttal, dispute_with_rebuttal_ready,
)

D_OPEN = "https://northwind.example.com/d-open"
D_REB = "https://northwind.example.com/d-reb"


@pytest.fixture()
def deployed(direct_vm, direct_deploy, direct_alice, direct_bob):
    H.install_transfer_hook(direct_vm)
    contract = direct_deploy(CONTRACT)
    H.fund_contract(direct_vm)
    direct_vm.sender = direct_alice
    return contract


@pytest.fixture()
def disputed(deployed, direct_vm, direct_alice, direct_bob):
    dispute_with_rebuttal_ready(
        direct_vm, deployed, direct_alice, direct_bob)
    return deployed


def _decided(direct_vm, deployed, alice, bob, verdict=None):
    create_milestone(direct_vm, deployed, alice, bob)
    fund(direct_vm, deployed, alice, 1)
    submit_evidence(direct_vm, deployed, bob, 1, body=PAGE_BODY)
    direct_vm.mock_llm(".*", verdict or llm_all_pass())
    direct_vm.sender = alice
    deployed.start_adjudication(1)


# ---------------------------------------------------------------------------
# 1. Response window enforcement
# ---------------------------------------------------------------------------

class TestResponseWindow:
    def test_resolve_blocked_while_window_open(self, disputed):
        with pytest.raises(Exception) as exc:
            disputed.resolve_dispute(1)
        assert "response window" in str(exc.value)

    def test_resolve_allowed_after_window(self, disputed, direct_vm,
                                          direct_bob):
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        decision = disputed.resolve_dispute(1)
        assert str(decision) in ("APPROVED", "REJECTED",
                                 "INSUFFICIENT_EVIDENCE")

    def test_window_boundary_minus_one_second(self, disputed, direct_vm):
        disp = json.loads(disputed.get_dispute(1))
        deadline = int(disp["response_deadline"])
        H.set_time(direct_vm, epoch_to_iso(deadline - 1))
        with pytest.raises(Exception):
            disputed.resolve_dispute(1)

    def test_window_boundary_exact_deadline(self, disputed, direct_vm):
        disp = json.loads(disputed.get_dispute(1))
        deadline = int(disp["response_deadline"])
        H.set_time(direct_vm, epoch_to_iso(deadline))
        decision = disputed.resolve_dispute(1)
        assert str(decision) == "APPROVED"

    def test_open_dispute_sets_response_deadline(self, deployed, direct_vm,
                                                 direct_alice, direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        open_dispute(direct_vm, deployed, direct_alice, 1,
                     "Client contests the automated verdict", "[]")
        disp = json.loads(deployed.get_dispute(1))
        opened = int(disp["opened_at"])
        assert int(disp["response_deadline"]) == opened + 24 * 3600


# ---------------------------------------------------------------------------
# 2. Opening-evidence policy
# ---------------------------------------------------------------------------

class TestOpeningEvidence:
    def test_empty_opening_evidence_accepted(self, deployed, direct_vm,
                                             direct_alice, direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        direct_vm.sender = direct_bob
        deployed.open_dispute(1, "Reason alone, no links attached", "[]")
        disp = json.loads(deployed.get_dispute(1))
        assert disp["status"] == "OPEN"
        assert disp["evidence"] == []

    def test_opening_evidence_records_provenance(self, deployed, direct_vm,
                                                 direct_alice, direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        direct_vm.sender = direct_bob
        deployed.open_dispute(
            1, "Worker believes the fetch misread the page",
            json.dumps([{"url": D_OPEN, "kind": "WEBSITE", "note": "retry"}]))
        disp = json.loads(deployed.get_dispute(1))
        assert disp["evidence"][0]["actor"] == addr_str(direct_bob)
        assert disp["evidence"][0]["source"] == "DISPUTE"
        assert disp["evidence"][0]["at"] != ""

    def test_only_one_dispute_allowed(self, deployed, direct_vm,
                                      direct_alice, direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        direct_vm.sender = direct_alice
        deployed.open_dispute(1, "First dispute rests on its reason", "[]")
        with pytest.raises(Exception):
            deployed.open_dispute(1, "Second dispute must not open", "[]")

    def test_open_window_enforced(self, deployed, direct_vm, direct_alice,
                                  direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(4)))
        with pytest.raises(Exception):
            deployed.open_dispute(1, "Too late to dispute this now", "[]")

    def test_cannot_dispute_undecided_milestone(self, deployed, direct_vm,
                                                direct_alice, direct_bob):
        create_milestone(direct_vm, deployed, direct_alice, direct_bob)
        fund(direct_vm, deployed, direct_alice, 1)
        with pytest.raises(Exception):
            deployed.open_dispute(1, "Nothing has been decided yet", "[]")

    def test_third_party_cannot_dispute(self, deployed, direct_vm,
                                        direct_alice, direct_bob,
                                        direct_charlie):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        direct_vm.sender = direct_charlie
        with pytest.raises(Exception):
            deployed.open_dispute(1, "An outsider tries to interfere", "[]")

    def test_short_reason_rejected(self, deployed, direct_vm, direct_alice,
                                   direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        with pytest.raises(Exception):
            deployed.open_dispute(1, "bad", "[]")


# ---------------------------------------------------------------------------
# 3. Rebuttal access (both parties)
# ---------------------------------------------------------------------------

class TestRebuttalAccess:
    def test_client_and_worker_can_both_add(self, disputed, direct_vm,
                                            direct_alice):
        direct_vm.sender = direct_alice
        disputed.submit_dispute_evidence(
            1, json.dumps([{"url": D_OPEN + "/2"}]))
        disp = json.loads(disputed.get_dispute(1))
        actors = {e["actor"] for e in disp["evidence"]}
        assert len(actors) == 2

    def test_third_party_rebuttal_rejected(self, disputed, direct_vm,
                                           direct_charlie):
        direct_vm.sender = direct_charlie
        with pytest.raises(Exception):
            disputed.submit_dispute_evidence(
                1, json.dumps([{"url": D_OPEN + "/3"}]))

    def test_empty_rebuttal_submission_rejected(self, disputed, direct_vm,
                                                direct_alice):
        direct_vm.sender = direct_alice
        with pytest.raises(Exception):
            disputed.submit_dispute_evidence(1, "[]")

    def test_rebuttal_count_capped(self, disputed, direct_vm, direct_bob):
        batch = json.dumps(
            [{"url": D_REB + "/bulk-%d" % n} for n in range(5)])
        direct_vm.sender = direct_bob
        for _ in range(3):
            disputed.submit_dispute_evidence(1, batch)
        with pytest.raises(Exception) as exc:
            disputed.submit_dispute_evidence(1, batch)
        assert "limit" in str(exc.value)

    def test_post_window_rebuttal_still_accepted(self, disputed, direct_vm,
                                                 direct_alice):
        # The response window is a guaranteed MINIMUM rebuttal period, not
        # a maximum cut-off: while the dispute is OPEN, both parties keep
        # symmetric append rights (provenance-tagged, auditable).
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_alice
        disputed.submit_dispute_evidence(
            1, json.dumps([{"url": D_OPEN + "/late"}]))
        disp = json.loads(disputed.get_dispute(1))
        urls = [e["url"] for e in disp["evidence"]]
        assert D_OPEN + "/late" in urls


# ---------------------------------------------------------------------------
# 4. Resolution semantics
# ---------------------------------------------------------------------------

class TestResolution:
    def test_resolution_preserves_original_decision(self, disputed,
                                                    direct_vm, direct_bob):
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        disputed.resolve_dispute(1)
        disp = json.loads(disputed.get_dispute(1))
        assert disp["status"] == "RESOLVED"
        assert disp["original_decision"] == "APPROVED"
        assert disp["resolution"]["decision"] == "APPROVED"
        assert disp["resolution"]["round"] == 2

    def test_dispute_round_appends_new_snapshot(self, disputed, direct_vm,
                                                direct_bob):
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        disputed.resolve_dispute(1)
        history = json.loads(disputed.get_adjudications(1))
        assert len(history) == 2
        assert history[1]["trigger"] == "dispute"

    def test_resolution_settles_escrow(self, disputed, direct_vm,
                                       direct_bob):
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        worker_before = balance_of(direct_vm, direct_bob)
        direct_vm.sender = direct_bob
        decision = disputed.resolve_dispute(1)
        assert str(decision) == "APPROVED"
        assert balance_of(direct_vm, direct_bob) == worker_before + AMOUNT
        rec = json.loads(disputed.get_milestone(1))
        assert rec["status"] == "RELEASED"
        assert rec["balance_wei"] == "0"

    def test_flipped_resolution_refunds_client(self, deployed, direct_vm,
                                               direct_alice, direct_bob):
        _decided(direct_vm, deployed, direct_alice, direct_bob)
        direct_vm.sender = direct_alice
        deployed.open_dispute(
            1, "On review, the deployment was not reachable", "[]")
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.mock_llm(".*", llm_c1_fail())
        client_before = balance_of(direct_vm, direct_alice)
        direct_vm.sender = direct_alice
        decision = deployed.resolve_dispute(1)
        assert str(decision) == "REJECTED"
        assert balance_of(direct_vm, direct_alice) == client_before + AMOUNT
        assert json.loads(deployed.get_milestone(1))["status"] == "REFUNDED"

    def test_cannot_resolve_twice(self, disputed, direct_vm, direct_bob):
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        disputed.resolve_dispute(1)
        with pytest.raises(Exception):
            disputed.resolve_dispute(1)

    def test_finalize_blocked_while_dispute_open(self, disputed):
        with pytest.raises(Exception):
            disputed.finalize_milestone(1)

    def test_dispute_evidence_feeds_resolution(self, disputed, direct_vm,
                                               direct_bob):
        H.mock_body(direct_vm, D_OPEN, PAGE_BODY)
        H.mock_body(direct_vm, D_REB, PAGE_BODY)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        disputed.resolve_dispute(1)
        history = json.loads(disputed.get_adjudications(1))
        refs = [r["url"] for r in history[1]["evidence_refs"]]
        assert D_OPEN in refs and D_REB in refs
        by_url = {r["url"]: r["source"] for r in history[1]["evidence_refs"]}
        assert by_url[D_OPEN] == "DISPUTE"
        assert by_url[D_REB] == "DISPUTE"


# ---------------------------------------------------------------------------
# 5. Fair fetch budget + order independence
# ---------------------------------------------------------------------------

class TestFairBudget:
    def _resolve_with_bodies(self, direct_vm, deployed, alice, bob,
                             base_bodies, dispute_bodies):
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        urls = [("https://northwind.example.com/base-%d" % i, b)
                for i, b in enumerate(base_bodies)]
        H.submit_evidence_multi(direct_vm, deployed, bob, 1, urls)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        deployed.start_adjudication(1)
        open_dispute(
            direct_vm, deployed, alice, 1,
            "Client attaches large rebuttal payloads",
            json.dumps([{"url": "https://northwind.example.com/reb-%d" % i}
                        for i, _ in enumerate(dispute_bodies)]))
        for i, b in enumerate(dispute_bodies):
            H.mock_body(direct_vm,
                        "https://northwind.example.com/reb-%d" % i, b)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = bob
        deployed.resolve_dispute(1)

    def test_rebuttal_budget_survives_base_pressure(self, deployed,
                                                    direct_vm, direct_alice,
                                                    direct_bob):
        # 5 fat base URLs + 4 fat rebuttal URLs: resolution must succeed
        # and every ref must be recorded regardless of array order.
        self._resolve_with_bodies(
            direct_vm, deployed, direct_alice, direct_bob,
            [BIG_BODY_6K] * 5, [BIG_BODY_6K] * 4)
        history = json.loads(deployed.get_adjudications(1))
        final = history[-1]
        assert len(final["evidence_refs"]) == 9
        sources = [r["source"] for r in final["evidence_refs"]]
        assert sources.count("DISPUTE") == 4
        assert sources.count("ORIGINAL") == 5

    def test_empty_categories_degrade_safely(self, disputed, direct_vm,
                                             direct_bob):
        # No fetchable rebuttal content at all -> still resolvable.
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(3)))
        direct_vm.sender = direct_bob
        decision = disputed.resolve_dispute(1)
        assert str(decision) in ("APPROVED", "REJECTED",
                                 "INSUFFICIENT_EVIDENCE")

    def test_verdict_matches_across_evidence_orders(self, deployed,
                                                    direct_vm, direct_alice,
                                                    direct_bob):
        # Submitting the same URLs in a different order must not change the
        # decision (equal-share allocation is order-insensitive).
        outcomes = []
        for ordered in ([BIG_BODY, BIG_BODY_6K], [BIG_BODY_6K, BIG_BODY]):
            create_milestone(direct_vm, deployed, direct_alice, direct_bob)
            fund(direct_vm, deployed, direct_alice,
                 len(outcomes) + 1)
            urls = [("https://northwind.example.com/o-%d-%d"
                     % (len(outcomes), i), b)
                    for i, b in enumerate(ordered)]
            H.submit_evidence_multi(
                direct_vm, deployed, direct_bob, len(outcomes) + 1, urls)
            direct_vm.mock_llm(".*", llm_all_pass())
            direct_vm.sender = direct_alice
            outcomes.append(str(deployed.start_adjudication(
                len(outcomes) + 1)))
        assert outcomes[0] == outcomes[1] == "APPROVED"
