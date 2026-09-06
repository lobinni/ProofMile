# ProofMile Escrow

**Trustless milestone escrow with proof adjudication under validator consensus.**

A GenLayer project: a decentralized escrow and dispute-resolution
platform for digital work, implemented as a GenLayer Intelligent Contract
(`contracts/proof_mile_escrow.py`) with a production Next.js dApp on top.

Network: **GenLayer Studionet — chain id 61999** · proof-adjudicated by
independent validators · every verdict and evidence reference auditable
on-chain.

**Live deployment (Studionet):** contract
[`0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0`](https://explorer-studio.genlayer.com/address/0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0)
— schema verified on-chain against this repository (18 public methods,
byte-identical source, see `docs/deployment_log.json`).

---

## What it does

1. A **client** creates a milestone: acceptance criteria in plain
   language, a worker address, a deadline, and an escrow amount in GEN.
2. The client **funds** the escrow — real GEN, held by the Intelligent
   Contract (exact-amount funding; no over/under/double funding).
3. The **worker** submits public evidence URLs (deployments, repositories,
   docs, APIs) plus a statement of how the evidence proves completion.
4. **Adjudication** runs *inside* the contract: it fetches the evidence,
   an LLM evaluates every acceptance criterion independently (PASS /
   FAIL / INSUFFICIENT_EVIDENCE), and GenLayer validators independently
   re-run the same evaluation and vote on the result — consensus compares
   the **semantic decision** (per-criterion statuses), never raw prose.
5. Only **after consensus**, deterministic contract code derives the
   verdict and executes the escrow rules: release to the worker, or
   protect/refund the client. The LLM never moves money.
6. Either party can **dispute** within the 3-day dispute window; the
   original decision is preserved and a fresh consensus round
   re-adjudicates all evidence with the dispute context — but only after
   a guaranteed 24-hour **response window** lets the other party attach
   rebuttal evidence.

## Repository layout

```
contracts/
  proof_mile_escrow.py      the Intelligent Contract (single deployable unit)
tests/
  direct/                   direct-mode gltest suites + helpers
scripts/
  deploy_studionet.py       full-consensus deploy + address log
  deploy_smoke_studionet.py live smoke: determinism x3, negative case,
                            response-window enforcement, rebuttal round
  post_window_resolution.py completes a dispute after the 24h window
docs/
  architecture.md           state machine, storage schema, value flow
  adjudication.md           full adjudication design + consensus
  security.md               threat model, nondet/det split, injection defense
  testing.md                test coverage + how to run everything
  deployment.md             step-by-step deploy + operations
  deployment_log.json       deployment + protocol-run records
src/                        the dApp (Next.js + TypeScript + Tailwind)
  app/                      pages: / /dashboard /create /evidence /dispute
                            /history /milestone/[id] + /api/health
  lib/                      genlayer-js binding, wallet provider, BigInt
                            money utils, domain types
  components/               NavBar + shared UI
```

## Quick start

### Contract

```bash
# Python 3.12 required
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python genlayer-test genlayer-py pytest eth_utils

# lint the Intelligent Contract
GENVMROOT=/tmp/genvmroot genvm-lint check contracts/proof_mile_escrow.py

# run the direct-mode suites (76 tests)
.venv/bin/python -m pytest tests/direct/ -v
```

### dApp

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_CONTRACT_ADDRESS after deploy
npm run dev                    # http://localhost:3000
```

No database is used anywhere: the dApp reads and writes the Intelligent
Contract on Studionet directly through MetaMask / `genlayer-js`.

### Deploy on Vercel (no database, no server-side secrets)

1. Push this repository to GitHub (see commands below).
2. In Vercel: **Add New → Project → Import** the repository. Framework,
   build command (`next build`), and output are auto-detected — no
   overrides needed.
3. Add environment variables (from `.env.example`):

   | Name | Value |
   | ---- | ----- |
   | `NEXT_PUBLIC_CONTRACT_ADDRESS` | `0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0` (or your deployment) |
   | `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` |
   | `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
   | `NEXT_PUBLIC_GENLAYER_EXPLORER` | `https://explorer-studio.genlayer.com` |

4. Deploy. Users connect MetaMask on Studionet (chain 61999) — nothing
   else to provision.

### Push to GitHub

```bash
git init
git add .
git commit -m "ProofMile Escrow: GenLayer intelligent contract + dApp"
git branch -M main
git remote add origin https://github.com/<your-username>/proofmile-escrow.git
git push -u origin main
```

`.env*` files are git-ignored; only `.env.example` ships with the repo.

### Deploy

See `docs/deployment.md` — Studio (browser),
`scripts/deploy_studionet.py` (programmatic), or
`scripts/deploy_smoke_studionet.py` (deploy + live acceptance protocol,
logged to `docs/deployment_log.json`).

## The contract at a glance

| | |
| -------------- | ----------------------------------------------------------------- |
| Client methods | `create_milestone`, `fund_milestone` (payable, exact amount), `cancel_milestone` |
| Worker methods | `submit_evidence` (public URLs + statement, pre-deadline) |
| Adjudication   | `start_adjudication` (either party) — bounded web fetch → strict prompt → per-criterion LLM labels inside consensus; `_derive_decision` maps labels to the verdict deterministically |
| Settlement     | `finalize_milestone` (permissionless crank, post-window) — `emit_transfer(value, on="finalized")` with checks-effects-interactions |
| Disputes       | `open_dispute` (either party, 3-day window, once; opening evidence optional) → `submit_dispute_evidence` (both parties, append-only, capped) → `resolve_dispute` (blocked until the 24h response window passes; fresh consensus round; original decision preserved) |
| Views          | `get_milestone`, `get_milestone_ids`, `get_milestones_for`, `get_adjudications`, `get_dispute`, `get_params`, `get_contract_balance`, `get_stats` |
| Storage        | uniform `TreeMap[str, str]` JSON records, `u256` counter, node-assigned timestamps (integer-only math), wei as decimal strings |

## Configuration: changing the contract address

The dApp binds to exactly one environment variable:

```
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
```

Replace the value and restart — every page follows. Nothing else in the
codebase references a deployment address.
