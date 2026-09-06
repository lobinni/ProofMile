# ProofMile Escrow — Testing guide

All tests run in **gltest direct mode**: the contract executes against a
local GenVM test harness with mocked web fetches and mocked LLM answers,
so the suite is fast, fully deterministic, and CI-friendly. Live
validator consensus is exercised separately on Studionet (see
`docs/deployment.md`).

## Setup (Python 3.12 required)

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python \
    genlayer-test genlayer-py pytest eth_utils
```

## Lint the contract

```bash
GENVMROOT=/tmp/genvmroot genvm-lint check contracts/proof_mile_escrow.py
```

Expected: lint and schema validation pass with 18 public methods.

## Run the suites

```bash
# everything
.venv/bin/python -m pytest tests/direct/ -v

# core suite only
.venv/bin/python -m pytest tests/direct/test_proof_mile_escrow.py -v

# dispute-hardening regressions only
.venv/bin/python -m pytest tests/direct/test_dispute_hardening.py -v
```

Expected: **76 passed** — 49 core (`test_proof_mile_escrow.py`) +
27 dispute-hardening regressions (`test_dispute_hardening.py`).

## What the suites cover

### test_proof_mile_escrow.py — core behaviour

| Area | Examples |
|------|----------|
| Creation | full record written; id increments; rejects short titles, bad/empty criteria JSON, duplicate criterion ids, >10 criteria, past deadlines, worker == client, dust amounts, non-http(s) initial URLs |
| Funding | exact-amount enforcement; rejects ±1 wei, double funding, non-client funders, unknown ids |
| Evidence | worker-only; requires FUNDED; rejects empty arrays, short statements, late submissions; URL deduplication; provenance tags stored |
| Adjudication | all-PASS → APPROVED; mandatory FAIL → REJECTED; empty/unfetchable evidence → INSUFFICIENT_EVIDENCE; LOW quality blocks approval; unknown LLM status normalizes; requires SUBMITTED + party caller; snapshot history stored; resubmission after rejection; 3-round cap; 20 000-char fetch cap respected |
| Settlement | APPROVED releases to worker after the window; REJECTED refunds client; finalize blocked inside window; double-settle impossible; stats track locked escrow |
| Cancel/Expiry | cancel unfunded; cancel funded refunds; worker cannot cancel; mark_expired refunds after deadline; too-early expiry rejected |
| Views | role-tagged indexes; id listing; not-found sentinels; params expose both windows |
| Prompt injection | an injected page + obedient LLM still leaves a complete audit trail, locked escrow, and an immediately openable dispute |

### test_dispute_hardening.py — regressions

| Area | Examples |
|------|----------|
| Response window | resolve blocked while open; allowed after; boundary −1s blocked; boundary +0 allowed; response deadline recorded at open |
| Opening-evidence policy | empty `[]` opening evidence accepted; provenance recorded; one dispute per milestone; open-window enforcement; no disputing undecided milestones; third parties blocked; reason length enforced |
| Rebuttal access | both parties append; third parties blocked; empty rebuttal batch rejected; 20-item cap; post-window appends still accepted (window is a minimum, not a cut-off) |
| Resolution semantics | original decision preserved; new snapshot appended with `trigger = dispute`; escrow settles to the right side at once; flipped verdict refunds the client; no double resolution; finalize blocked while open; dispute evidence included with DISPUTE source tags |
| Fair fetch budget | 5 fat base + 4 fat rebuttal URLs all adjudicated with refs recorded; empty categories degrade safely; identical verdict across evidence orderings |

## Writing new tests

Direct-mode essentials are packaged in `tests/direct/helpers.py`:

* `install_transfer_hook(vm)` — mirrors `emit_transfer` value movement in
  `vm._balances`; call it before `direct_deploy`.
* `fund_contract(vm)` — deals the contract a bankroll so payouts have a
  balance to draw from.
* `set_time(vm, iso)` — warps VM time **and** patches the loaded
  contract's cached `gl.message_raw["datetime"]` (warp alone is not
  enough).
* `mock_body(vm, url, body)` — registers web mocks in the dict format
  this gltest build needs (`{"status": 200, "body": ...}`; plain-string
  mocks are silently swallowed).
* `vm.mock_llm(pattern, payload)` — routes LLM prompts to a canned
  normalized verdict.
* Lifecycle builders: `create_milestone`, `fund`, `submit_evidence`,
  `open_dispute`, `add_rebuttal`, `dispute_with_rebuttal_ready`.

## Live protocol (post-deployment)

`scripts/deploy_smoke_studionet.py` runs the live acceptance gate on
Studionet: determinism ×3, a negative case, on-chain response-window
enforcement, and a rebuttal round — appended to
`docs/deployment_log.json`. Post-window completion is done by
`scripts/post_window_resolution.py`.
