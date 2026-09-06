"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CirclePlus,
  Flag,
  Scale,
  Trash2,
} from "lucide-react";
import { useWallet, useWriteContract } from "@/lib/wallet";
import {
  explainContractError,
  getReadContract,
  isContractConfigured,
} from "@/lib/contract";
import type { DisputeRecord, Milestone, TxState } from "@/lib/types";
import { formatEpoch, timeUntil } from "@/lib/money";
import {
  ConfigureNotice,
  ConnectGate,
  ListState,
  Panel,
  Spinner,
  StatusPill,
  TxTracker,
} from "@/components/ui";

interface UrlDraft {
  url: string;
  note: string;
}

function DisputeForm() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const wallet = useWallet();
  const write = useWriteContract();
  const configured = isContractConfigured();

  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [dispute, setDispute] = useState<DisputeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [urls, setUrls] = useState<UrlDraft[]>([{ url: "", note: "" }]);
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
      if (!contract) return;
      const m = await contract.getMilestone(id);
      setMilestone(m && m.id ? m : null);
      const d = await contract.getDispute(id);
      setDispute(d);
    } finally {
      setLoading(false);
    }
  }, [configured, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isParty = useMemo(
    () =>
      milestone &&
      wallet.address &&
      [milestone.client.toLowerCase(), milestone.worker.toLowerCase()].includes(
        wallet.address.toLowerCase()
      ),
    [milestone, wallet.address]
  );

  const decided = milestone
    ? ["APPROVED", "REJECTED", "INSUFFICIENT_EVIDENCE"].includes(milestone.status)
    : false;
  const windowOpen = milestone
    ? Number(milestone.dispute_deadline || "0") > Math.floor(Date.now() / 1000)
    : false;
  const disputeOpen = dispute?.status === "OPEN";
  const busy = ["signing", "pending"].includes(tx.phase);

  function validateUrls(allowEmpty: boolean): UrlDraft[] | string {
    const filled = urls.filter((u) => u.url.trim().length > 0);
    for (const u of filled) {
      if (!/^https?:\/\/\S+$/.test(u.url.trim()))
        return `The link “${u.url.slice(0, 60)}” must start with http:// or https:// and contain no spaces.`;
    }
    if (!allowEmpty && filled.length === 0)
      return "Attach at least one rebuttal link.";
    return filled;
  }

  async function handleOpen() {
    setFormError(null);
    if (reason.trim().length < 10) {
      setFormError("Write the reason for the dispute in at least 10 characters.");
      return;
    }
    const filled = validateUrls(true);
    if (typeof filled === "string") {
      setFormError(filled);
      return;
    }
    if (!write || !milestone) return;
    try {
      setTx({ phase: "idle" });
      await write.openDispute(
        milestone.id,
        reason.trim(),
        JSON.stringify(
          filled.map((u) => ({ url: u.url.trim(), kind: "WEBSITE", note: u.note.trim() }))
        ),
        setTx
      );
      setDone(true);
      await load();
    } catch (err) {
      setTx({
        phase: "failed",
        error: explainContractError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }

  async function handleRebuttal() {
    setFormError(null);
    const filled = validateUrls(false);
    if (typeof filled === "string") {
      setFormError(filled);
      return;
    }
    if (!write || !milestone) return;
    try {
      setTx({ phase: "idle" });
      await write.submitDisputeEvidence(
        milestone.id,
        JSON.stringify(
          filled.map((u) => ({ url: u.url.trim(), kind: "WEBSITE", note: u.note.trim() }))
        ),
        setTx
      );
      setDone(true);
      await load();
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
    <section className="t-shell page-zone" aria-labelledby="dispTitle">
      <div className="zone-head">
        <div>
          <div className="t-kicker">Objection console · one dispute per milestone</div>
          <h1 id="dispTitle">
            Contest a <span>Verdict</span>
          </h1>
          <p>
            A dispute does not overturn a verdict by itself — it starts a fresh
            consensus round. The other side gets a guaranteed 24-hour window to
            answer before resolution can run.
          </p>
        </div>
      </div>

      {!configured && <ConfigureNotice />}
      {configured && !id && (
        <div className="notice amber">
          <Scale size={15} />
          <span>
            No milestone selected. Open a decided milestone and choose
            “dispute”, or browse the{" "}
            <Link href="/history" style={{ color: "inherit", textDecoration: "underline" }}>ledger</Link>.
          </span>
        </div>
      )}
      {configured && id && (!wallet.isConnected || !wallet.isCorrectNetwork) && (
        <ConnectGate action="open or answer a dispute" />
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
                    fontSize: "clamp(22px, 3vw, 32px)",
                    margin: "0 0 8px",
                  }}
                >
                  {milestone.title}
                </h2>
                {"decision" in (milestone.verdict ?? {}) && (
                  <div className="pm-card-meta" style={{ marginTop: 10 }}>
                    <span className="t-chip">
                      current verdict: {(milestone.verdict as { decision?: string }).decision}
                    </span>
                    <span className="t-chip dim">
                      dispute window {windowOpen ? `closes in ${timeUntil(milestone.dispute_deadline)}` : "closed"}
                    </span>
                  </div>
                )}
              </Panel>

              {!isParty && (
                <div className="notice amber">
                  <Flag size={15} />
                  <span>
                    Only the client or the worker wallet tied to this milestone
                    can act here.
                  </span>
                </div>
              )}

              {isParty && !decided && !disputeOpen && (
                <div className="notice">
                  <Flag size={15} />
                  <span>
                    There is nothing to dispute yet — a milestone can only be
                    contested after an adjudication verdict, inside its 3-day
                    dispute window ({windowOpen ? "currently open" : "currently closed"}).
                  </span>
                </div>
              )}

              {/* ------------------------------------------- open dispute */}
              {isParty && decided && windowOpen && !disputeOpen && !dispute && (
                <Panel kicker="Open the dispute">
                  <div className="pm-form-grid">
                    <div className="pm-field full">
                      <label htmlFor="d-reason">Why is the verdict wrong?</label>
                      <textarea
                        id="d-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="State your objection clearly. This text is treated as a claim, not as proof."
                      />
                    </div>
                    <div className="full">
                      <span className="mono-note">
                        Opening links are optional — the original proof is always re-judged.
                      </span>
                    </div>
                    {urls.map((u, i) => (
                      <div key={i} className="full" style={{ display: "grid", gridTemplateColumns: "2fr 2fr auto", gap: 10 }}>
                        <div className="pm-field">
                          <label>Link {i + 1}</label>
                          <input
                            value={u.url}
                            onChange={(e) =>
                              setUrls((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                            }
                            placeholder="https://…"
                            spellCheck={false}
                          />
                        </div>
                        <div className="pm-field">
                          <label>Note (optional)</label>
                          <input
                            value={u.note}
                            onChange={(e) =>
                              setUrls((arr) => arr.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                            }
                            placeholder="What does this link change?"
                          />
                        </div>
                        <div className="pm-field">
                          <label>&nbsp;</label>
                          <button
                            type="button"
                            className="pm-btn pm-btn-ghost pm-btn-sm"
                            aria-label="Remove link"
                            disabled={urls.length <= 1}
                            onClick={() => setUrls((arr) => arr.filter((_, j) => j !== i))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="full" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-btn-sm"
                        disabled={urls.length >= 5}
                        onClick={() => setUrls((arr) => [...arr, { url: "", note: "" }])}
                      >
                        <CirclePlus size={13} /> Add link
                      </button>
                    </div>

                    {formError && (
                      <div className="notice amber full">
                        <Flag size={15} />
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
                        onClick={() => void handleOpen()}
                      >
                        Open dispute <Flag size={14} />
                      </button>
                    </div>
                  </div>
                </Panel>
              )}

              {/* ------------------------------------------ rebuttal flow */}
              {isParty && disputeOpen && (
                <Panel
                  kicker="Dispute is open"
                  right={
                    <span className="t-chip amber">
                      resolvable in {timeUntil(dispute!.response_deadline)}
                    </span>
                  }
                >
                  <p style={{ color: "var(--t-muted)", fontSize: 13.5, lineHeight: 1.7, marginTop: 0 }}>
                    Opened by the party that contested the verdict. Resolution
                    stays locked until the 24-hour rebuttal window closes
                    (ends {formatEpoch(dispute!.response_deadline)} UTC). Both
                    parties may keep attaching rebuttal links in the meantime.
                  </p>
                  <div className="pm-form-grid" style={{ marginTop: 18 }}>
                    {urls.map((u, i) => (
                      <div key={i} className="full" style={{ display: "grid", gridTemplateColumns: "2fr 2fr auto", gap: 10 }}>
                        <div className="pm-field">
                          <label>Rebuttal link {i + 1}</label>
                          <input
                            value={u.url}
                            onChange={(e) =>
                              setUrls((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                            }
                            placeholder="https://…"
                            spellCheck={false}
                          />
                        </div>
                        <div className="pm-field">
                          <label>Note (optional)</label>
                          <input
                            value={u.note}
                            onChange={(e) =>
                              setUrls((arr) => arr.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                            }
                          />
                        </div>
                        <div className="pm-field">
                          <label>&nbsp;</label>
                          <button
                            type="button"
                            className="pm-btn pm-btn-ghost pm-btn-sm"
                            aria-label="Remove link"
                            disabled={urls.length <= 1}
                            onClick={() => setUrls((arr) => arr.filter((_, j) => j !== i))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {formError && (
                      <div className="notice amber full">
                        <Flag size={15} />
                        <span>{formError}</span>
                      </div>
                    )}
                    {tx.phase !== "idle" && (
                      <div className="full">
                        <TxTracker tx={tx} />
                      </div>
                    )}
                    <div className="full" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-btn-sm"
                        disabled={urls.length >= 5}
                        onClick={() => setUrls((arr) => [...arr, { url: "", note: "" }])}
                      >
                        <CirclePlus size={13} /> Add link
                      </button>
                      <button
                        type="button"
                        className="pm-btn"
                        disabled={busy}
                        onClick={() => void handleRebuttal()}
                      >
                        Attach rebuttal <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </Panel>
              )}

              {done && (
                <div className="notice mint">
                  <Flag size={15} />
                  <span style={{ flex: 1 }}>
                    Recorded on-chain. Follow the round from the milestone page.
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

export default function DisputePage() {
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
      <DisputeForm />
    </Suspense>
  );
}
