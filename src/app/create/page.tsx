"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CirclePlus,
  Coins,
  ListChecks,
  Trash2,
} from "lucide-react";
import { useWallet, useWriteContract } from "@/lib/wallet";
import { explainContractError, isContractConfigured } from "@/lib/contract";
import { parseGenToWei } from "@/lib/money";
import type { TxState } from "@/lib/types";
import {
  ConfigureNotice,
  ConnectGate,
  TxTracker,
} from "@/components/ui";

interface CriterionDraft {
  text: string;
  mandatory: boolean;
}

const IDLE: TxState = { phase: "idle" };

export default function CreatePage() {
  const router = useRouter();
  const wallet = useWallet();
  const write = useWriteContract();
  const configured = isContractConfigured();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [worker, setWorker] = useState("");
  const [requirements, setRequirements] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([
    { text: "", mandatory: true },
  ]);
  const [days, setDays] = useState("14");
  const [amount, setAmount] = useState("1");
  const [initialUrls, setInitialUrls] = useState("");
  const [tx, setTx] = useState<TxState>(IDLE);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const amountWei = useMemo(() => {
    try {
      return parseGenToWei(amount || "0");
    } catch {
      return null;
    }
  }, [amount]);

  const busy = ["signing", "pending"].includes(tx.phase);
  const ready =
    configured &&
    wallet.isConnected &&
    wallet.isCorrectNetwork &&
    write !== null;

  function validate(): string | null {
    if (title.trim().length < 3) return "Give the milestone a title of at least 3 characters.";
    if (!/^0x[0-9a-fA-F]{40}$/.test(worker.trim()))
      return "Enter a valid worker wallet address (0x followed by 40 hex characters).";
    if (wallet.address && worker.trim().toLowerCase() === wallet.address.toLowerCase())
      return "The worker must be a different wallet than the client.";
    const filled = criteria.filter((c) => c.text.trim().length > 0);
    if (filled.length === 0) return "Add at least one acceptance criterion.";
    if (filled.some((c) => c.text.trim().length < 5))
      return "Each criterion needs at least 5 characters of plain language.";
    if (!days || Number(days) < 1) return "Set a deadline of at least 1 day out.";
    if (amountWei === null || amountWei < 1000000n)
      return "Enter an escrow amount of at least 0.000000000001 GEN.";
    const urls = initialUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 5) return "At most 5 reference links can be attached.";
    for (const u of urls) {
      if (!/^https?:\/\/\S+$/.test(u)) return `The link “${u.slice(0, 60)}” must start with http:// or https:// and contain no spaces.`;
    }
    return null;
  }

  async function handleCreate() {
    setFormError(null);
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    if (!write) return;
    const filled = criteria
      .map((c, i) => ({
        id: `c${i + 1}`,
        text: c.text.trim(),
        mandatory: c.mandatory,
      }))
      .filter((c) => c.text.length > 0);
    const urls = initialUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    const deadlineEpoch = BigInt(
      Math.floor(Date.now() / 1000) + Math.round(Number(days) * 86400)
    );
    try {
      setTx(IDLE);
      await write.createMilestone(
        {
          title: title.trim(),
          description: description.trim(),
          worker: worker.trim(),
          criteriaJson: JSON.stringify(filled),
          evidenceRequirements: requirements.trim(),
          deadlineEpoch,
          amountWei: amountWei!,
          initialUrlsJson: JSON.stringify(urls),
        },
        setTx
      );
      // Discover the new id from the sender's index.
      const { getReadContract } = await import("@/lib/contract");
      const contract = getReadContract();
      if (contract && wallet.address) {
        const refs = await contract.getMilestonesFor(wallet.address);
        const mine = refs
          .filter((r) => r.role === "client")
          .map((r) => Number(r.id));
        if (mine.length > 0) {
          const id = String(Math.max(...mine));
          setCreatedId(id);
          return;
        }
      }
      router.push("/dashboard");
    } catch (err) {
      setTx({
        phase: "failed",
        error: explainContractError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }

  async function handleFund() {
    if (!write || !createdId || amountWei === null) return;
    try {
      setTx(IDLE);
      await write.fundMilestone(createdId, amountWei, setTx);
      router.push(`/milestone/${createdId}`);
    } catch (err) {
      setTx({
        phase: "failed",
        error: explainContractError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }

  return (
    <section className="t-shell page-zone" aria-labelledby="createTitle">
      <div className="zone-head">
        <div>
          <div className="t-kicker">Client console · two moves: create, then fund</div>
          <h1 id="createTitle">
            Open a <span>Milestone</span>
          </h1>
          <p>
            Describe the work in plain language, lock the escrow, let the
            protocol do the judging. Nothing moves until the verdict is
            reproduced by validators.
          </p>
        </div>
      </div>

      {!configured && <ConfigureNotice />}
      {configured && (!wallet.isConnected || !wallet.isCorrectNetwork) && (
        <ConnectGate action="create and fund a milestone" />
      )}

      {configured && ready && (
        <div
          className="pm-form-grid"
          style={{ borderTop: "1px solid var(--t-line)", paddingTop: 40 }}
        >
          <div className="pm-field full">
            <label htmlFor="f-title">Milestone title</label>
            <input
              id="f-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch the community rewards page"
              maxLength={120}
            />
          </div>

          <div className="pm-field full">
            <label htmlFor="f-desc">What is being delivered?</label>
            <textarea
              id="f-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the deliverable in a few sentences — what exists when this milestone is truly done."
            />
          </div>

          <div className="pm-field">
            <label htmlFor="f-worker">Worker wallet</label>
            <input
              id="f-worker"
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
              placeholder="0x… the wallet that will submit proof"
              spellCheck={false}
            />
            <div className="hint">
              Only this wallet can submit proof and receive the payout.
            </div>
          </div>

          <div className="pm-field">
            <label htmlFor="f-req">Proof you expect to see</label>
            <input
              id="f-req"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="e.g. a live URL plus a public repository"
            />
          </div>

          <div className="pm-field full">
            <label>
              <ListChecks size={12} style={{ verticalAlign: "-2px" }} />{" "}
              Acceptance criteria — each one is judged independently
            </label>
            <div style={{ display: "grid", gap: 10 }}>
              {criteria.map((c, i) => (
                <div
                  key={i}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}
                >
                  <input
                    value={c.text}
                    onChange={(e) =>
                      setCriteria((cs) =>
                        cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                      )
                    }
                    placeholder={`Criterion ${i + 1}, in words a reviewer can check`}
                  />
                  <button
                    type="button"
                    className={"pm-btn pm-btn-sm " + (c.mandatory ? "" : "pm-btn-ghost")}
                    onClick={() =>
                      setCriteria((cs) =>
                        cs.map((x, j) => (j === i ? { ...x, mandatory: !x.mandatory } : x))
                      )
                    }
                  >
                    {c.mandatory ? "Mandatory" : "Advisory"}
                  </button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost pm-btn-sm"
                    aria-label="Remove criterion"
                    disabled={criteria.length <= 1}
                    onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="pm-btn pm-btn-ghost pm-btn-sm"
                disabled={criteria.length >= 10}
                onClick={() => setCriteria((cs) => [...cs, { text: "", mandatory: true }])}
              >
                <CirclePlus size={13} /> Add criterion
              </button>
            </div>
            <div className="hint">
              Advisory criteria inform the reviewer but never block approval. Up to 10 criteria.
            </div>
          </div>

          <div className="pm-field">
            <label htmlFor="f-deadline">Deadline (days from now)</label>
            <input
              id="f-deadline"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>

          <div className="pm-field">
            <label htmlFor="f-amount">Escrow amount (GEN)</label>
            <input
              id="f-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 2.5"
              inputMode="decimal"
            />
            <div className="hint">
              Funded in full by your wallet in the next step — the contract
              accepts only the exact amount.
            </div>
          </div>

          <div className="pm-field full">
            <label htmlFor="f-urls">Reference links (optional, one per line)</label>
            <textarea
              id="f-urls"
              value={initialUrls}
              onChange={(e) => setInitialUrls(e.target.value)}
              placeholder={"https://… brief, designs, spec — up to 5 links"}
              style={{ minHeight: 80 }}
            />
          </div>

          {formError && (
            <div className="notice amber full">
              <Coins size={15} />
              <span>{formError}</span>
            </div>
          )}

          {tx.phase !== "idle" && (
            <div className="full">
              <TxTracker tx={tx} />
            </div>
          )}

          <div className="full" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {!createdId ? (
              <button
                type="button"
                className="pm-btn pm-btn-hero"
                disabled={busy}
                onClick={() => void handleCreate()}
              >
                Create milestone <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <div className="notice mint" style={{ flex: 1, minWidth: 260 }}>
                  <Coins size={15} />
                  <span>
                    Milestone <b>#{createdId}</b> is on-chain. Fund the escrow
                    now to arm it — the worker can submit proof as soon as the
                    funding finalizes.
                  </span>
                </div>
                <button
                  type="button"
                  className="pm-btn pm-btn-mint pm-btn-hero"
                  disabled={busy}
                  onClick={() => void handleFund()}
                >
                  Fund {amount} GEN <ArrowRight size={14} />
                </button>
                <Link href={`/milestone/${createdId}`} className="pm-btn pm-btn-ghost pm-btn-hero">
                  Fund later
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
