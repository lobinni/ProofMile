# ProofMile Escrow — Deployment & operations

Target network: **GenLayer Studionet** (chain id **61999**)
RPC: `https://studio.genlayer.com/api` · Explorer:
`https://explorer-studio.genlayer.com` · Currency: GEN

## Current live deployment

| | |
| --- | --- |
| Address | [`0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0`](https://explorer-studio.genlayer.com/address/0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0) |
| Source | `contracts/proof_mile_escrow.py` (byte-identical — SHA-256 prefix `fae85a4a0e71577c`) |
| Schema | 18 public methods, verified via `gen_getContractSchema` |
| dApp binding | already set in `.env` (`NEXT_PUBLIC_CONTRACT_ADDRESS`) |

Verify it yourself without installing anything:

```bash
# schema (names, params, readonly/payable flags)
curl -s -X POST https://studio.genlayer.com/api \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"gen_getContractSchema","params":["0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0"],"id":1}'

# source code (base64) — decode and diff against the repo file
curl -s -X POST https://studio.genlayer.com/api \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"gen_getContractCode","params":["0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0"],"id":1}'
```

## 1. Deploy the Intelligent Contract

### Option A — Studio (browser)

1. Open GenLayer Studio against Studionet.
2. Paste the contents of `contracts/proof_mile_escrow.py`.
3. Run the built-in lint, then **Deploy** with no constructor arguments.
4. Copy the deployed contract address.

### Option B — programmatic

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python genlayer-py

export PROOFMILE_PRIVATE_KEY=0x...   # funded with Studionet GEN
.venv/bin/python scripts/deploy_studionet.py
```

The script deploys under full consensus, sanity-checks the read methods,
prints the address, and appends the record to
`docs/deployment_log.json`.

### Option C — smoke deploy (acceptance gate)

```bash
export PROOFMILE_PRIVATE_KEY=0x...
export PROOFMILE_WORKER_PRIVATE_KEY=0x...   # second party for the worker role
.venv/bin/python scripts/deploy_smoke_studionet.py
```

Runs determinism ×3, the negative case, response-window enforcement and
the rebuttal round, then logs every checkpoint.

## 2. Point the dApp at the contract

The contract address lives in exactly one place: `.env` (committed with
the live deployment above) or `.env.local` for local overrides:

```
NEXT_PUBLIC_CONTRACT_ADDRESS=0xd429Bcfc77aBBE478c00f86cb49F85dDd32427A0
```

Restart the dev server / rebuild the production bundle. Every page —
landing stats, dashboard, milestone detail, history — immediately reads
from the new deployment. **No code edits are needed to change the
address, ever.** If the variable is unset the app stays functional and
shows a configuration panel instead of on-chain data.

Optional network overrides (defaults are already Studionet):

```
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_EXPLORER=https://explorer-studio.genlayer.com
```

## 3. Connect with MetaMask

Users connect with MetaMask (EIP-1193). The dApp requests and enforces:

| Field            | Value                                      |
| ---------------- | ------------------------------------------ |
| Chain ID         | `61999` (`0xF1CF`)                         |
| Network name     | GenLayer Studionet                         |
| RPC URL          | `https://studio.genlayer.com/api`          |
| Currency symbol  | GEN (18 decimals)                          |
| Block explorer   | `https://explorer-studio.genlayer.com`     |

If the wallet is on another network, the app offers a one-click
"Switch to Studionet" action (`wallet_switchEthereumChain`, falling back
to `wallet_addEthereumChain` when the chain is unknown to the wallet).

## 4. End-to-end acceptance walkthrough

1. **Create** — client creates a milestone (criteria, worker, deadline,
   amount). Nothing is escrowed yet.
2. **Fund** — client funds the exact escrow amount; the record flips to
   FUNDED and the GEN is held by the contract.
3. **Submit** — worker submits public evidence URLs + statement before
   the deadline.
4. **Adjudicate** — either party triggers adjudication; the GenLayer
   consensus pipeline runs (watch the phase tracker in the UI move
   through proposing → revealing → accepted → finalized).
5. **Window** — the verdict locks escrow for the 3-day dispute window.
6. Either **finalize** (release / refund per the verdict) or **dispute**
   (fresh consensus round once the 24h response window closes, then
   immediate settlement).

## 5. Post-window dispute completion

Because the 24h response window is enforced on-chain, a live dispute
round completes a day after it opens. `scripts/post_window_resolution.py`:

1. re-reads the milestone and its dispute record;
2. calls `resolve_dispute` (the fresh consensus round + settlement);
3. appends the outcome to `docs/deployment_log.json`.

```bash
export PROOFMILE_PRIVATE_KEY=0x...
.venv/bin/python scripts/post_window_resolution.py 0xContractAddress 1
```

## 6. Redeploying / changing the address

A redeploy is a new contract with fresh state — old milestones do not
carry over. To switch the dApp:

1. deploy the new contract (section 1);
2. replace `NEXT_PUBLIC_CONTRACT_ADDRESS`;
3. restart/rebuild;
4. append the new address to `docs/deployment_log.json` (the deploy
   script does this automatically).

Previous addresses remain on-chain for audit; keep them in the log with
a `status` note such as `"superseded"`.
