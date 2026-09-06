# ProofMile Escrow — Architecture

ProofMile Escrow is a trustless milestone escrow for digital work, built
on GenLayer. A single Intelligent Contract (`contracts/proof_mile_escrow.py`)
holds the escrow, drives the state machine, runs AI adjudication under
validator consensus, and settles funds deterministically. A Next.js dApp
(the repository root) provides the full user experience on top.

```
contracts/
  proof_mile_escrow.py      the Intelligent Contract (single deployable unit;
                            validation / adjudication engine / state machine
                            separated into documented sections)
tests/
  direct/
  conftest.py               path setup
  helpers.py                direct-mode helpers (transfer hook, time warp,
                            LLM/web mock builders, dict-format web mocks)
  test_proof_mile_escrow.py core suite (state machine, auth, escrow
                            accounting, adjudication, disputes, deadlines,
                            prompt-injection audit, invariants)
  test_dispute_hardening.py response-window + fairness regressions
app layout (repository root is the dApp):
  src/app/                  pages: / /dashboard /create /evidence /dispute
                            /history /milestone/[id] + /api/health
  src/lib/                  genlayer-js contract binding, wallet provider,
                            BigInt money utils, domain types
  src/components/           NavBar + shared UI (badges, tx tracker, cards)
scripts/
  deploy_studionet.py       full-consensus deploy + address log
  deploy_smoke_studionet.py live smoke: determinism x3 + negative case +
                            window enforcement, logged as evidence
  post_window_resolution.py completes a dispute round after the 24h window
docs/                       this documentation set
```

## State machine

```
CREATED ──fund──▶ FUNDED ──submit (before deadline)──▶ SUBMITTED
   │                 │                                    │
   │cancel           │cancel (refunds)                    │ start_adjudication
   ▼                 ▼                                    ▼
CANCELLED        CANCELLED                  APPROVED / REJECTED / INSUFFICIENT
                                                │   ▲                │
            resubmit (rounds left, before deadline) │                │
                                                │                    │
              open_dispute (within 3-day window) ▼                    │
                                          DISPUTED ──resolve (after 24h
                                                │     response window)
                                                ▼
                          APPROVE→ RELEASED      otherwise→ REFUNDED
                                                ▲
              finalize_milestone (after dispute window closes, no
              dispute open) ────────────────────┘
FUNDED/CREATED ──mark_expired (deadline passed, no submission)──▶ EXPIRED
```

Terminal states: `RELEASED`, `REFUNDED`, `CANCELLED`, `EXPIRED`.
Money only ever moves into `RELEASED`/`REFUNDED` via the deterministic
`_release` / `_refund` helpers, and never twice (`released` / `refunded`
flags + zeroed balance are enforced on every path).

## Storage schema

Uniform `TreeMap[str, str]` maps with canonical JSON values
(`separators=(",", ":")`, `sort_keys=True`), a `u256` id counter, wei
amounts as decimal strings:

| Map            | Key                          | Value                                             |
| -------------- | ---------------------------- | ------------------------------------------------- |
| `milestones`   | milestone id (decimal str)   | full milestone record (see below)                 |
| `client_index` | checksummed address          | JSON array of milestone ids                       |
| `worker_index` | checksummed address          | JSON array of milestone ids                       |
| `adjudications`| milestone id                 | JSON array of adjudication snapshots (append-only)|
| `disputes`     | milestone id                 | dispute record (at most one per milestone)        |
| `params`       | — (scalar str)               | protocol parameters JSON, written in `__init__`   |

Milestone record fields: `id, title, description, client, worker,
criteria (JSON str), evidence_requirements, evidence_urls_client[],
evidence[] (provenance-tagged items), worker_statement, deadline_epoch,
amount_wei, balance_wei, status, created_at, submitted_at,
adjudicated_at, dispute_deadline, resolved_at, adjudication_count,
verdict {}, released, refunded, timeline[] (capped at 40 entries)`.

Dispute record fields: `milestone_id, opened_by, reason, evidence[],
original_decision, original_round, opened_at, response_deadline,
status (OPEN|RESOLVED), resolution {}`.

## Value flow

1. `fund_milestone` is `payable` and requires `gl.message.value` to equal
   the escrow amount **exactly** (over/under-funding and double funding
   are rejected). The funds stay on the contract's balance.
2. Settlement uses checks-effects-interactions: the record is zeroed and
   persisted first, then `emit_transfer(value, on="finalized")` performs
   the actual value movement as a child transaction bound to protocol
   finality.
3. Destinations are fixed by state: `APPROVED → worker`,
   `REJECTED / INSUFFICIENT_EVIDENCE → client`,
   `cancel / expire → client`. Crank methods (`finalize_milestone`,
   `mark_expired`) are permissionless by design.

## Time

All time arithmetic uses node-assigned ISO-8601 timestamps from
`gl.message_raw["datetime"]`, parsed with Howard Hinnant's integer-only
`days_from_civil` algorithm — no floats, no `datetime` module, identical
on every validator.

Windows:

* `MIN_DEADLINE_AHEAD` — 1 hour minimum lead time for new milestones.
* `DISPUTE_WINDOW_SECONDS` — 3 days after each adjudication to open a
  dispute.
* `DISPUTE_RESPONSE_WINDOW_SECONDS` — 24 hours after a dispute opens
  before it can be resolved (enforced on-chain in `resolve_dispute`).

## Frontend ↔ contract binding

The dApp talks to Studionet (GenLayer studio network, chain id **61999**)
through `genlayer-js`:

* reads: `client.readContract` against the view methods;
* writes: `client.writeContract` + `waitForTransactionReceipt` polling
  to `FINALIZED`, surfacing the raw GenLayer consensus phases
  (`PROPOSING / COMMITTING / REVEALING / ACCEPTED / FINALIZED`) to the UI;
* the contract address lives in exactly one place —
  `NEXT_PUBLIC_CONTRACT_ADDRESS` in the environment — and nowhere in
  code. `src/lib/contract.ts` reads it on every access, so replacing the
  deployment means editing one line and restarting the app.

### Page ↔ contract method map

Every dApp workflow terminates in a contract call — the UI holds no
off-chain business state of its own:

| Page | Contract methods used |
| ---- | --------------------- |
| `/` (landing) | `get_stats`, `get_milestone_ids`, `get_milestone` |
| `/dashboard` | `get_milestones_for`, `get_milestone` |
| `/history` | `get_milestone_ids`, `get_milestone` |
| `/create` | `create_milestone` → `get_milestones_for` (id lookup) → `fund_milestone` (payable) |
| `/evidence` | `get_milestone` → `submit_evidence` |
| `/dispute` | `get_milestone`, `get_dispute` → `open_dispute` / `submit_dispute_evidence` |
| `/milestone/[id]` | `get_milestone`, `get_dispute`, `get_adjudications` + `fund_milestone`, `cancel_milestone`, `start_adjudication`, `finalize_milestone`, `mark_expired`, `resolve_dispute` |

The frontend mirrors every contract guard before enabling an action
(state gates, role checks, window countdowns, exact-amount funding,
evidence/cardinality limits). If a stale UI still fires a transaction,
the contract reverts and the error is translated into plain language —
the contract remains the single source of truth for all transitions.

### Workflow state integrity checklist

* **Fund** — payable call must carry exactly `amount_wei`; the UI reads
  the amount from the on-chain record, never from form state, at the
  moment of the call.
* **Submit** — UI enables only in `FUNDED` / `REJECTED` /
  `INSUFFICIENT_EVIDENCE` and before the deadline; the contract
  re-checks both plus the worker identity and the 3-round cap.
* **Adjudicate** — UI enables only in `SUBMITTED` for a party; the
  contract re-checks state + caller, and the nondet block is the only
  place where AI evaluation happens.
* **Finalize** — UI disables with a live countdown until
  `dispute_deadline` passes; the contract enforces node-time anyway.
* **Dispute** — UI enables only for decided milestones inside the window
  with no existing dispute; resolution stays UI-disabled until
  `response_deadline`, which `resolve_dispute` enforces on-chain.
* **Cancel / expire** — client-only and permissionless crank
  respectively; both refund through the same deterministic `_refund`.
