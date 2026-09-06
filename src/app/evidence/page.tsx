"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CirclePlus,
  Link2,
  Send,
  Trash2,
} from "lucide-react";
import { useWallet, useWriteContract } from "@/lib/wallet";
import {
  explainContractError,
  getReadContract,
  isContractConfigured,
} from "@/lib/contract";
import type { EvidenceKind, Milestone, TxState } from "@/lib/types";
import { timeUntil } from "@/lib/money";
import {
  ConfigureNotice,
  ConnectGate,
  ListState,
  Panel,
  Spinner,
  StatusPill,
  TxTracker,
} from "@/components/ui";

interface EvidenceDraft {
  url: string;
  kind: EvidenceKind;
  note: string;
}

const KINDS: EvidenceKind[] = ["WEBSITE", "GITHUB", "DOCUMENTATION", "API", "OTHER"];

const KIND_LABEL: Record<EvidenceKind, string> = {
  WEBSITE: "Live site",
  GITHUB: "Repository",
  DOCUMENTATION: "Document",
  API: "API endpoint",
  OTHER: "Other link",
};

function EvidenceForm() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const wallet = useWallet();
  const write = useWriteContract();
  const configured = isContractConfigured();

  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EvidenceDraft[]>([
    { url: "", kind: "WEBSITE", note: "" },
  ]);
  const [statement, setStatement] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!configured || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const contract = getReadContract();
      const m = contract ? await contract.getMilestone(id) : null;
      setMilestone(m && m.id ? m : null);
    } finally {
      setLoading(false);
    }
  }, [configured, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isWorker = useMemo(
    () =>
      milestone &&
      wallet.address &&
      milestone.worker.toLowerCase() === wallet.address.toLowerCase(),
    [milestone, wallet.address]
  );

  const submittable =
    milestone &&
    ["FUNDED", "REJECTED", "INSUFFICIENT_EVIDENCE"].includes(milestone.status);

  const busy = ["signing", "pending"].includes(tx.phase);

  function validate(): string | null {
    const filled = items.filter((i) => i.url.trim().length > 0);
    if (filled.length === 0) return "Attach at least one proof link.";
    for (const i of filled) {
      if (!/^https?:\/\/\S+$/.test(i.url.trim()))
        return `The link “${i.url.slice(0, 60)}” must start with http:// or https:// and contain no spaces.`;
    }
    if (statement.trim().length < 10)
      return "Write a short statement (at least 10 characters) explaining how the proof satisfies the criteria.";
    return null;
  }

  async function handleSubmit() {
    setFormError(null);
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    if (!write || !milestone) return;
    const filled = items
      .filter((i) => i.url.trim().length > 0)
      .map((i) => ({ url: i.url.trim(), kind: i.kind, note: i.note.trim() }));
    try {
      setTx({ phase: "idle" });
      await write.submitEvidence(
        milestone.id,
        JSON.stringify(filled),
        statement.trim(),
        setTx
      );
      setDone(true);
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
    <section className="t-shell page-zone" aria-labelledby="evTitle">
      <div className="zone-head">
        <div>
          <div className="t-kicker">Worker console · proof round</div>
          <h1 id="evTitle">
            Submit <span>Proof</span>
          </h1>
          <p>
            Attach public links that demonstrate the work. The contract fetches
            them during adjudication — every criterion is judged against what
            it actually sees.
          </p>
        </div>
      </div>

      {!configured && <ConfigureNotice />}
      {configured && !id && (
        <div className="notice amber">
          <Link2 size={15} />
          <span>
            No milestone selected. Open a milestone and use its “submit proof”
            action, or browse the <Link href="/history" style={{ color: "inherit", textDecoration: "underline" }}>ledger</Link>.
          </span>
        </div>
      )}
      {configured && (!wallet.isConnected || !wallet.isCorrectNetwork) && id && (
        <ConnectGate action="submit proof for this milestone" />
      )}

      {configured && id && wallet.isConnected && wallet.isCorrectNetwork && (
        <>
          {loading ? (
            <ListState>
              <Spinner /> Loading milestone…
            </ListState>
          ) : !milestone ? (
            <ListState>Milestone {id} was not found on-chain.</ListState>
          ) : (
            <div style={{ display: "grid", gap: 26 }}>
              <Panel
                kicker={`Milestone #${milestone.id}`}
                right={<StatusPill status={milestone.status} />}
              >
                <h2
                  style={{
                    fontFamily: 'var(--font-syne), "Syne", sans-serif',
                    letterSpacing: "-0.04em",
                    fontSize: "clamp(24px, 3vw, 36px)",
                    margin: "0 0 10px",
                  }}
                >
                  {milestone.title}
                </h2>
                <p style={{ color: "var(--t-muted)", fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
                  {milestone.description}
                </p>
                <div className="pm-card-meta">
                  <span className="t-chip dim">due in {timeUntil(milestone.deadline_epoch)}</span>
                  {milestone.evidence_requirements && (
                    <span className="t-chip">client expects: {milestone.evidence_requirements}</span>
                  )}
                </div>
              </Panel>

              {!isWorker && (
                <div className="notice amber">
                  <Send size={15} />
                  <span>
                    The connected wallet is not the assigned worker. Switch to
                    the worker wallet for this milestone to submit proof.
                  </span>
                </div>
              )}
              {isWorker && !submittable && (
                <div className="notice">
                  <Send size={15} />
                  <span>
                    This milestone is not accepting proof in its current state.
                    Proof is accepted while the milestone is funded (before the
                    deadline) or while adjudication rounds remain after a
                    rejection.
                  </span>
                </div>
              )}

              {isWorker && submittable && !done && (
                <Panel kicker="Proof items — public URLs only">
                  <div className="pm-form-grid">
                    {items.map((item, i) => (
                      <div key={i} className="full" style={{ display: "grid", gridTemplateColumns: "2fr 150px 2fr auto", gap: 10 }}>
                        <div className="pm-field">
                          <label>Link {i + 1}</label>
                          <input
                            value={item.url}
                            onChange={(e) =>
                              setItems((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                            }
                            placeholder="https://…"
                            spellCheck={false}
                          />
                        </div>
                        <div className="pm-field">
                          <label>Kind</label>
                          <select
                            value={item.kind}
                            onChange={(e) =>
                              setItems((arr) => arr.map((x, j) => (j === i ? { ...x, kind: e.target.value as EvidenceKind } : x)))
                            }
                          >
                            {KINDS.map((k) => (
                              <option key={k} value={k}>{KIND_LABEL[k]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="pm-field">
                          <label>Note (optional)</label>
                          <input
                            value={item.note}
                            onChange={(e) =>
                              setItems((arr) => arr.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                            }
                            placeholder="What should the reviewer look at?"
                          />
                        </div>
                        <div className="pm-field">
                          <label>&nbsp;</label>
                          <button
                            type="button"
                            className="pm-btn pm-btn-ghost pm-btn-sm"
                            aria-label="Remove link"
                            disabled={items.length <= 1}
                            onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="full">
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-btn-sm"
                        disabled={items.length >= 5}
                        onClick={() => setItems((arr) => [...arr, { url: "", kind: "WEBSITE", note: "" }])}
                      >
                        <CirclePlus size={13} /> Add link
                      </button>
                    </div>
                    <div className="pm-field full">
                      <label htmlFor="ev-statement">Statement to the adjudicator</label>
                      <textarea
                        id="ev-statement"
                        value={statement}
                        onChange={(e) => setStatement(e.target.value)}
                        placeholder="Explain, in your own words, how each criterion is satisfied by the linked proof."
                      />
                    </div>

                    {formError && (
                      <div className="notice amber full">
                        <Send size={15} />
                        <span>{formError}</span>
                      </div>
                    )}
                    {tx.phase !== "idle" && (
                      <div className="full">
                        <TxTracker tx={tx} />
                      </div>
                    )}

                    <div className="full">
                      <button
                        type="button"
                        className="pm-btn pm-btn-hero"
                        disabled={busy}
                        onClick={() => void handleSubmit()}
                      >
                        Submit for adjudication <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </Panel>
              )}

              {done && (
                <div className="notice mint">
                  <Send size={15} />
                  <span style={{ flex: 1 }}>
                    Proof is on-chain. Either party can now start adjudication —
                    the contract fetches your links and validators re-run the
                    evaluation.
                  </span>
                  <Link href={`/milestone/${milestone.id}`} className="pm-btn pm-btn-sm">
                    Open milestone <ArrowRight size={13} />
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function EvidencePage() {
  return (
    <Suspense
      fallback={
        <section className="t-shell page-zone">
          <ListState>
            <Spinner /> Loading…
          </ListState>
        </section>
      }
    >
      <EvidenceForm />
    </Suspense>
  );
}
