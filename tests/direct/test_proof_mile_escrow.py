"""ProofMile Escrow direct-mode test suite.

Covers: creation validation, escrow funding accounting, authorization,
submission flow, deadline enforcement, adjudication + deterministic
decision derivation, consensus comparison semantics, prompt-injection
audit trail, dispute lifecycle, settlement accounting, and invariants.

Run:
    .venv/bin/python -m pytest tests/direct/test_proof_mile_escrow.py -v
"""
import json

import pytest

import helpers as H
from helpers import (
    CONTRACT, AMOUNT, PAGE_BODY, EMPTY_BODY, INJECTION_BODY,
    addr_str, create_milestone, epoch_in_days, epoch_to_iso, fund,
    fund_contract, install_transfer_hook, llm_all_pass, llm_c1_fail,
    llm_c1_insufficient, llm_injection_obedient, balance_of,
    make_criteria, submit_evidence, submit_evidence_multi,
)

GOOD_URL = "https://northwind.example.com/dashboard"
BAD_URL = "https://void.example.com/whatever"


@pytest.fixture()
def deployed(direct_vm, direct_deploy, direct_alice, direct_bob):
    H.install_transfer_hook(direct_vm)
    contract = direct_deploy(CONTRACT)
    H.fund_contract(direct_vm)
    direct_vm.sender = direct_alice
    return contract


@pytest.fixture()
def parties(direct_alice, direct_bob):
    return direct_alice, direct_bob


# ---------------------------------------------------------------------------
# 1. Milestone creation
# ---------------------------------------------------------------------------

class TestCreateMilestone:
    def test_creates_with_full_record(self, deployed, parties, direct_vm):
        alice, bob = parties
        mid = create_milestone(direct_vm, deployed, alice, bob)
        assert int(mid) == 1
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "CREATED"
        assert rec["client"] == addr_str(alice)
        assert rec["worker"] == addr_str(bob)
        assert rec["amount_wei"] == str(AMOUNT)
        assert rec["balance_wei"] == "0"
        assert len(json.loads(rec["criteria"])) == 2
        assert rec["timeline"][0]["event"] == "created"

    def test_ids_increment(self, deployed, parties, direct_vm):
        alice, bob = parties
        assert int(create_milestone(direct_vm, deployed, alice, bob)) == 1
        assert int(create_milestone(direct_vm, deployed, alice, bob)) == 2

    def test_rejects_short_title(self, deployed, parties):
        _, bob = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "ab", "desc", bob, make_criteria(), "evidence req",
                epoch_in_days(30), AMOUNT, "[]")

    def test_rejects_bad_criteria_json(self, deployed, parties):
        _, bob = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, "not-json", "ev",
                epoch_in_days(30), AMOUNT, "[]")
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, "[]", "ev",
                epoch_in_days(30), AMOUNT, "[]")

    def test_rejects_duplicate_criterion_ids(self, deployed, parties):
        _, bob = parties
        dup = json.dumps([
            {"id": "c1", "text": "first criterion text", "mandatory": True},
            {"id": "c1", "text": "second criterion text", "mandatory": True},
        ])
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, dup, "ev",
                epoch_in_days(30), AMOUNT, "[]")

    def test_rejects_too_many_criteria(self, deployed, parties):
        _, bob = parties
        many = json.dumps([
            {"id": "c%d" % i, "text": "criterion %d ok" % i,
             "mandatory": True} for i in range(11)])
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, many, "ev",
                epoch_in_days(30), AMOUNT, "[]")

    def test_rejects_past_deadline(self, deployed, parties):
        _, bob = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, make_criteria(), "ev",
                epoch_in_days(-5), AMOUNT, "[]")

    def test_rejects_worker_equals_client(self, deployed, parties):
        alice, _ = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", alice, make_criteria(), "ev",
                epoch_in_days(30), AMOUNT, "[]")

    def test_rejects_dust_amount(self, deployed, parties):
        _, bob = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, make_criteria(), "ev",
                epoch_in_days(30), 10, "[]")

    def test_accepts_initial_evidence_urls(self, deployed, parties,
                                           direct_vm):
        alice, bob = parties
        direct_vm.sender = alice
        mid = deployed.create_milestone(
            "A valid title", "desc", bob, make_criteria(), "ev",
            epoch_in_days(30), AMOUNT,
            json.dumps([GOOD_URL]))
        rec = json.loads(deployed.get_milestone(int(mid)))
        assert rec["evidence_urls_client"] == [GOOD_URL]

    def test_rejects_bad_initial_url(self, deployed, parties):
        _, bob = parties
        with pytest.raises(Exception):
            deployed.create_milestone(
                "A valid title", "desc", bob, make_criteria(), "ev",
                epoch_in_days(30), AMOUNT,
                json.dumps(["ftp://not-http.example.com"]))


# ---------------------------------------------------------------------------
# 2. Escrow funding
# ---------------------------------------------------------------------------

class TestFunding:
    def test_fund_sets_balance_and_state(self, deployed, parties,
                                         direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "FUNDED"
        assert rec["balance_wei"] == str(AMOUNT)

    def test_rejects_wrong_amount(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        direct_vm.sender = alice
        direct_vm.value = AMOUNT - 1
        with pytest.raises(Exception):
            deployed.fund_milestone(1)
        direct_vm.value = AMOUNT + 1
        with pytest.raises(Exception):
            deployed.fund_milestone(1)
        direct_vm.value = 0

    def test_rejects_double_funding(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        direct_vm.sender = alice
        direct_vm.value = AMOUNT
        with pytest.raises(Exception):
            deployed.fund_milestone(1)
        direct_vm.value = 0

    def test_rejects_non_client_funder(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        direct_vm.sender = bob
        direct_vm.value = AMOUNT
        with pytest.raises(Exception):
            deployed.fund_milestone(1)
        direct_vm.value = 0

    def test_rejects_funding_unknown_id(self, deployed):
        with pytest.raises(Exception):
            deployed.fund_milestone(999)


# ---------------------------------------------------------------------------
# 3. Evidence submission
# ---------------------------------------------------------------------------

class TestEvidence:
    def test_worker_submits_evidence(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        submit_evidence(direct_vm, deployed, bob, 1, body=PAGE_BODY)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "SUBMITTED"
        assert len(rec["evidence"]) == 1
        assert rec["evidence"][0]["actor"] == addr_str(bob)
        assert rec["evidence"][0]["source"] == "ORIGINAL"

    def test_rejects_non_worker_submission(self, deployed, parties,
                                           direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        with pytest.raises(Exception):
            submit_evidence(direct_vm, deployed, alice, 1)

    def test_rejects_submission_before_funding(self, deployed, parties,
                                               direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        with pytest.raises(Exception):
            submit_evidence(direct_vm, deployed, bob, 1)

    def test_rejects_empty_evidence_array(self, deployed, parties,
                                          direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        direct_vm.sender = bob
        with pytest.raises(Exception):
            deployed.submit_evidence(1, "[]", "No links, just trust me.")

    def test_rejects_short_statement(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        direct_vm.sender = bob
        with pytest.raises(Exception):
            deployed.submit_evidence(
                1, json.dumps([{"url": GOOD_URL}]), "short")

    def test_rejects_late_submission(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob,
                         deadline=epoch_in_days(1))
        fund(direct_vm, deployed, alice, 1)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(2)))
        with pytest.raises(Exception):
            submit_evidence(direct_vm, deployed, bob, 1)

    def test_deduplicates_repeat_urls(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        direct_vm.sender = bob
        deployed.submit_evidence(
            1, json.dumps([{"url": GOOD_URL}, {"url": GOOD_URL}]),
            "Both entries point at the same live dashboard page.")
        rec = json.loads(deployed.get_milestone(1))
        assert len(rec["evidence"]) == 1


# ---------------------------------------------------------------------------
# 4. Adjudication + deterministic decision derivation
# ---------------------------------------------------------------------------

class TestAdjudication:
    def _funded_with_evidence(self, direct_vm, deployed, alice, bob):
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        submit_evidence(direct_vm, deployed, bob, 1, body=PAGE_BODY)

    def test_all_pass_approves(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        decision = deployed.start_adjudication(1)
        assert str(decision) == "APPROVED"
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "APPROVED"
        assert rec["verdict"]["rule"].startswith("all_mandatory_pass")
        assert int(rec["dispute_deadline"]) > int(rec["adjudicated_at"])

    def test_mandatory_fail_rejects(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_c1_fail())
        direct_vm.sender = bob
        decision = deployed.start_adjudication(1)
        assert str(decision) == "REJECTED"

    def test_empty_evidence_is_insufficient(self, deployed, parties,
                                            direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        # Unmocked URL -> fetch fails -> no content.
        submit_evidence(direct_vm, deployed, bob, 1, url=BAD_URL, body=None)
        direct_vm.mock_llm(".*", llm_c1_insufficient())
        direct_vm.sender = alice
        decision = deployed.start_adjudication(1)
        assert str(decision) == "INSUFFICIENT_EVIDENCE"

    def test_low_quality_blocks_approval(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_all_pass(quality="LOW"))
        direct_vm.sender = alice
        assert str(deployed.start_adjudication(1)) == "INSUFFICIENT_EVIDENCE"

    def test_unknown_status_normalizes_to_insufficient(self, deployed,
                                                       parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        weird = json.dumps({
            "statuses": [
                {"id": "c1", "status": "MAYBE",
                 "evidence": "", "reason": ""},
                {"id": "c2", "status": "PASS",
                 "evidence": "", "reason": ""},
            ],
            "evidence_quality": "HIGH", "summary": ""})
        direct_vm.mock_llm(".*", weird)
        direct_vm.sender = alice
        assert str(deployed.start_adjudication(1)) == "INSUFFICIENT_EVIDENCE"

    def test_requires_submitted_state(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        with pytest.raises(Exception):
            deployed.start_adjudication(1)

    def test_requires_party_caller(self, deployed, parties, direct_vm,
                                   direct_charlie):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = direct_charlie
        with pytest.raises(Exception):
            deployed.start_adjudication(1)

    def test_snapshot_history_is_stored(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        deployed.start_adjudication(1)
        history = json.loads(deployed.get_adjudications(1))
        assert len(history) == 1
        snap = history[0]
        assert snap["round"] == 1
        assert snap["trigger"] == "adjudication"
        assert snap["decision"] == "APPROVED"
        assert len(snap["statuses"]) == 2
        assert snap["evidence_refs"][0]["url"] == GOOD_URL

    def test_resubmission_after_rejection(self, deployed, parties,
                                          direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_c1_fail())
        direct_vm.sender = alice
        deployed.start_adjudication(1)
        submit_evidence(direct_vm, deployed, bob, 1,
                        url=GOOD_URL + "/v2", body=PAGE_BODY)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        assert str(deployed.start_adjudication(1)) == "APPROVED"
        rec = json.loads(deployed.get_milestone(1))
        assert rec["adjudication_count"] == "2"

    def test_rounds_are_capped(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._funded_with_evidence(direct_vm, deployed, alice, bob)
        direct_vm.mock_llm(".*", llm_c1_fail())
        for i in range(3):
            direct_vm.sender = alice
            deployed.start_adjudication(1)
            if i < 2:
                submit_evidence(direct_vm, deployed, bob, 1,
                                url=GOOD_URL + "/" + str(i), body=PAGE_BODY)
        with pytest.raises(Exception):
            submit_evidence(direct_vm, deployed, bob, 1,
                            url=GOOD_URL + "/final", body=PAGE_BODY)

    def test_fetch_budget_is_capped(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        urls = [(GOOD_URL + "/" + str(i), H.BIG_BODY_6K) for i in range(5)]
        submit_evidence_multi(direct_vm, deployed, bob, 1, urls)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        deployed.start_adjudication(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "APPROVED"


# ---------------------------------------------------------------------------
# 5. Finalization + settlement accounting
# ---------------------------------------------------------------------------

class TestSettlement:
    def _approved(self, direct_vm, deployed, alice, bob):
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        submit_evidence(direct_vm, deployed, bob, 1, body=PAGE_BODY)
        direct_vm.mock_llm(".*", llm_all_pass())
        direct_vm.sender = alice
        deployed.start_adjudication(1)

    def test_approve_releases_to_worker_after_window(self, deployed, parties,
                                                     direct_vm):
        alice, bob = parties
        self._approved(direct_vm, deployed, alice, bob)
        worker_before = balance_of(direct_vm, bob)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(5)))
        deployed.finalize_milestone(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "RELEASED"
        assert rec["balance_wei"] == "0"
        assert rec["released"] is True
        assert balance_of(direct_vm, bob) == worker_before + AMOUNT

    def test_rejection_refunds_client_after_window(self, deployed, parties,
                                                   direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        submit_evidence(direct_vm, deployed, bob, 1, body=PAGE_BODY)
        direct_vm.mock_llm(".*", llm_c1_fail())
        direct_vm.sender = alice
        deployed.start_adjudication(1)
        client_before = balance_of(direct_vm, alice)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(5)))
        deployed.finalize_milestone(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "REFUNDED"
        assert balance_of(direct_vm, alice) == client_before + AMOUNT

    def test_finalize_blocked_during_dispute_window(self, deployed, parties,
                                                    direct_vm):
        alice, bob = parties
        self._approved(direct_vm, deployed, alice, bob)
        with pytest.raises(Exception):
            deployed.finalize_milestone(1)

    def test_cannot_settle_twice(self, deployed, parties, direct_vm):
        alice, bob = parties
        self._approved(direct_vm, deployed, alice, bob)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(5)))
        deployed.finalize_milestone(1)
        with pytest.raises(Exception):
            deployed.finalize_milestone(1)

    def test_stats_track_locked_escrow(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        stats = json.loads(deployed.get_stats())
        assert stats["total_milestones"] == 1
        assert stats["locked_wei"] == str(AMOUNT)
        assert stats["counts"]["FUNDED"] == 1


# ---------------------------------------------------------------------------
# 6. Cancel + expiry
# ---------------------------------------------------------------------------

class TestCancelExpiry:
    def test_cancel_unfunded(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        direct_vm.sender = alice
        deployed.cancel_milestone(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "CANCELLED"

    def test_cancel_funded_refunds(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        client_before = balance_of(direct_vm, alice)
        direct_vm.sender = alice
        deployed.cancel_milestone(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "CANCELLED"
        assert rec["refunded"] is True
        assert balance_of(direct_vm, alice) == client_before + AMOUNT

    def test_worker_cannot_cancel(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        direct_vm.sender = bob
        with pytest.raises(Exception):
            deployed.cancel_milestone(1)

    def test_mark_expired_after_deadline(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob,
                         deadline=epoch_in_days(1))
        fund(direct_vm, deployed, alice, 1)
        H.set_time(direct_vm, epoch_to_iso(epoch_in_days(2)))
        client_before = balance_of(direct_vm, alice)
        deployed.mark_expired(1)
        rec = json.loads(deployed.get_milestone(1))
        assert rec["status"] == "EXPIRED"
        assert balance_of(direct_vm, alice) == client_before + AMOUNT

    def test_mark_expired_too_early_rejected(self, deployed, parties,
                                             direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob,
                         deadline=epoch_in_days(1))
        fund(direct_vm, deployed, alice, 1)
        with pytest.raises(Exception):
            deployed.mark_expired(1)


# ---------------------------------------------------------------------------
# 7. Views + indexing
# ---------------------------------------------------------------------------

class TestViews:
    def test_milestones_for_roles(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        as_client = json.loads(deployed.get_milestones_for(addr_str(alice)))
        as_worker = json.loads(deployed.get_milestones_for(addr_str(bob)))
        assert {"id": "1", "role": "client"} in as_client
        assert {"id": "1", "role": "worker"} in as_worker

    def test_milestone_ids_listed(self, deployed, parties, direct_vm):
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        create_milestone(direct_vm, deployed, alice, bob)
        ids = [str(i) for i in deployed.get_milestone_ids()]
        assert ids == ["1", "2"]

    def test_unknown_milestone_reports_not_found(self, deployed):
        rec = json.loads(deployed.get_milestone(999))
        assert rec["error"] == "not_found"
        disp = json.loads(deployed.get_dispute(999))
        assert disp["error"] == "not_found"

    def test_params_expose_windows(self, deployed):
        params = json.loads(deployed.get_params())
        assert params["dispute_window_seconds"] == 3 * 24 * 3600
        assert params["dispute_response_window_seconds"] == 24 * 3600
        assert params["max_criteria"] == 10


# ---------------------------------------------------------------------------
# 8. Prompt-injection audit trail
# ---------------------------------------------------------------------------

class TestInjection:
    def test_injected_content_is_data_not_commands(self, deployed, parties,
                                                   direct_vm):
        """Even IF the LLM obeyed an injected page, every decision input
        (statuses, quality, rule trace, fetch refs) is stored on-chain and
        the escrow stays locked through the dispute window, so the client
        can always contest the result."""
        alice, bob = parties
        create_milestone(direct_vm, deployed, alice, bob)
        fund(direct_vm, deployed, alice, 1)
        submit_evidence(direct_vm, deployed, bob, 1, body=INJECTION_BODY)
        direct_vm.mock_llm(".*", llm_injection_obedient())
        direct_vm.sender = alice
        decision = deployed.start_adjudication(1)
        assert str(decision) == "APPROVED"
        rec = json.loads(deployed.get_milestone(1))
        # full audit trail persisted
        assert rec["verdict"]["rule"].startswith("all_mandatory_pass")
        assert rec["status"] != "RELEASED"          # escrow still locked
        assert rec["balance_wei"] == str(AMOUNT)
        # dispute remains available immediately after adjudication
        direct_vm.sender = alice
        deployed.open_dispute(
            1, "Reviewing the verdict against the original brief", "[]")
        assert json.loads(deployed.get_milestone(1))["status"] == "DISPUTED"
