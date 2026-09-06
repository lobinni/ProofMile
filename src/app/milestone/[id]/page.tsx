"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Coins,
  ExternalLink,
  FileSearch,
  Flag,
  Gavel,
  Hourglass,
  Landmark,
  Link2,
  RefreshCcw,
  Scale,
  Timer,
  UploadCloud,
  X,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import {
  explainContractError,
  explorerAddress,
  getReadContract,
  getWriteContract,
  isContractConfigured,
} from "@/lib/contract";
import type {
  AdjudicationSnapshot,
  Criterion,
  DisputeRecord,
  Milestone,
  TxState,
} from "@/lib/types";
import {
  formatEpoch,
  formatWei,
  shortenAddress,
  timeUntil,
} from "@/lib/money";
import {
  ConfigureNotice,
  ConnectGate,
  CriterionMark,
  criterionClass,
  criterionWord,
  ListState,
  Panel,
  Spinner,
  StatusPill,
  TxTracker,
} from "@/components/ui";

const STEPS = [
  { key: "CREATED", title: "Created", sub: "brief on-chain" },
  { key: "FUNDED", title: "Funded", sub: "escrow locked" },
  { key: "SUBMITTED", title: "Proof in", sub: "ready to judge" },
  { key: "VERDICT", title: "Verdict", sub: "consensus round" },
  { key: "SETTLED", title: "Settled", sub: "funds moved" },
];

function stepState(m: Milestone, idx: number): "done" | "live" | "todo" {
  const flow = ["CREATED", "FUNDED", "SUBMITTED"];
  const decided = ["APPROVED", "REJECTED", "INSUFFICIENT_EVIDENCE", "DISPUTED"];
  const settled = ["RELEASED", "REFUNDED", "CANCELLED", "EXPIRED"];
  if (settled.includes(m.status)) return "done";
  if (decided.includes(m.status)) return idx <= 3 ? "done" : idx === 4 ? "live" : "todo";
  const at = flow.indexOf(m.status);
  if (idx <= at) return "done";
  if (idx === at + 1) return "live";
  if (idx > at && idx >= 3) return "todo";
  return "todo";
}

function friendlyRule(rule: string): string {
  if (!rule) return "—";
  if (rule.startsWith("all_mandatory_pass")) {
    return "Every mandatory criterion passed and the proof quality was strong enough.";
  }
  if (rule.startsWith("mandatory_fail:")) {
    const ids = rule.split(":")[1];
    return `Mandatory criterion ${ids} was judged as failed by reviewer consensus.`;
  }
  if (rule.startsWith("mandatory_insufficient:")) {
    const ids = rule.split(":")[1];
    return `Mandatory criterion ${ids} could not be proven from the submitted proof.`;
  }
  if (rule === "evidence_quality_low") {
    return "The criteria passed, but reviewer consensus rated the proof quality too thin to release funds.";
  }
  return "Derived deterministically from the per-criterion verdict.";
}

function friendlyTimeline(ev: string): string {
  const [head, tail] = ev.split(":");
  switch (head) {
    case "created": return "Milestone created";
    case "funded": return "Escrow funded in full";
    case "cancelled": return "Milestone cancelled";
    case "expired": return "Milestone expired";
    case "evidence_submitted": return "Proof submitted";
    case "adjudicated": return `Verdict reached — ${tail?.replaceAll("_", " ").toLowerCase()}`;
    case "finalized": return `Settlement executed — ${tail?.toLowerCase()}`;
    case "dispute_opened": return "Dispute opened";
    case "dispute_evidence_added": return "Rebuttal proof attached";
    case "dispute_resolved": return `Dispute resolved — ${tail?.replaceAll("_", " ").toLowerCase()}`;
    case "escrow_released": return "Escrow released to the worker";
    case "escrow_refunded": return "Escrow refunded to the client";
    default: return ev.replaceAll("_", " ");
  }
}

export default function MilestoneDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const wallet = useWallet();
  const configured = isContractConfigured();

  const [m, setM] = useState<Milestone | null>(null);
  const [dispute, setDispute] = useState<DisputeRecord | null>(null);
  const [rounds, setRounds] = useState<AdjudicationSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const contract = getReadContract();
      if (!contract) return;
      const [mm, dd, rr] = await Promise.all([
        contract.getMilestone(id),
        contract.getDispute(id),
        contract.getAdjudications(id),
      ]);
      setM(mm && mm.id ? mm : null);
      setDispute(dd);
      setRounds(rr);
    } catch {
      setM(null);
    } finally {
      setLoading(false);
    }
  }, [configured, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const role = useMemo(() => {
    if (!m || !wallet.address) return null;
    const a = wallet.address.toLowerCase();
    if (m.client.toLowerCase() === a) return "client";
    if (m.worker.toLowerCase() === a) return "worker";
    return null;
  }, [m, wallet.address]);

  const now = Math.floor(Date.now() / 1000);
  const criteria: Criterion[] = useMemo(() => {
    try {
      return JSON.parse(m?.criteria ?? "[]");
    } catch {
      return [];
    }
  }, [m]);

  const verdict = (m?.verdict ?? {}) as {
    decision?: string;
    rule?: string;
    evidence_quality?: string;
    summary?: string;
    statuses?: { id: string; status: string; evidence: string; reason: string }[];
    round?: number;
  };
  const statusById = useMemo(() => {
    const map: Record<string, { status: string; reason: string; evidence: string }> = {};
    for (const s of verdict.statuses ?? []) map[s.id] = s;
    return map;
  }, [verdict]);

  const busy = ["signing", "pending"].includes(tx.phase);

  async function act(
    name: string,
    fn: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c: any,
      onPhase: (s: TxState) => void
    ) => Promise<unknown>
  ) {
    if (!wallet.address) return;
    setActing(name);
    setTx({ phase: "idle" });
    try {
      const contract = getWriteContract(wallet.address);
      await fn(contract, setTx);
      await load();
    } catch (err) {
      setTx({
        phase: "failed",
        error: explainContractError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    } finally {
      setActing(null);
    }
  }

  const decided = ["APPROVED", "REJECTED", "INSUFFICIENT_EVIDENCE"].includes(m?.status ?? "");
  const disputeWindowOpen = decided && Number(m?.dispute_deadline ?? 0) > now;
  const responseWindowOpen = dispute?.status === "OPEN" && Number(dispute?.response_deadline ?? 0) > now;

  const actions: { key: string; label: string; icon: React.ReactNode; run: () => void; primary?: boolean; disabled?: boolean; note?: string }[] = [];
  if (m && role && wallet.isCorrectNetwork) {
    if (m.status === "CREATED" && role === "client") {
      actions.push({
        key: "fund",
        label: `Fund ${formatWei(m.amount_wei)} GEN`,
        icon: <Coins size={14} />,
        primary: true,
        run: () => void act("fund", (c, p) => c.fundMilestone(id, BigInt(m.amount_wei), p)),
      });
      actions.push({
        key: "cancel",
        label: "Cancel milestone",
        icon: <X size={14} />,
        run: () => void act("cancel", (c, p) => c.cancelMilestone(id, p)),
      });
    }
    if (m.status === "FUNDED" && role === "client") {
      actions.push({
        key: "cancel",
        label: "Cancel & refund",
        icon: <X size={14} />,
        run: () => void act("cancel", (c, p) => c.cancelMilestone(id, p)),
      });
    }
    if (["FUNDED", "REJECTED", "INSUFFICIENT_EVIDENCE"].includes(m.status) && role === "worker" && now <= Number(m.deadline_epoch)) {
      actions.push({
        key: "submit",
        label: "Submit proof",
        icon: <UploadCloud size={14} />,
        primary: true,
        run: () => {
          window.location.href = `/evidence?id=${id}`;
        },
      });
    }
    if (m.status === "SUBMITTED") {
      actions.push({
        key: "adjudicate",
        label: "Start adjudication",
        icon: <Gavel size={14} />,
        primary: true,
        run: () => void act("adjudicate", (c, p) => c.startAdjudication(id, p)),
      });
    }
    if (decided && disputeWindowOpen && !dispute) {
      actions.push({
        key: "dispute",
        label: "Dispute the verdict",
        icon: <Flag size={14} />,
        run: () => {
          window.location.href = `/dispute?id=${id}`;
        },
      });
      actions.push({
        key: "finalize",
        label: "Finalize settlement",
        icon: <Landmark size={14} />,
        disabled: true,
        note: `unlocks in ${timeUntil(m.dispute_deadline)}`,
        run: () => undefined,
      });
    }
    if (decided && !disputeWindowOpen && !dispute) {
      actions.push({
        key: "finalize",
        label: m.status === "APPROVED" ? "Release escrow to worker" : "Refund escrow to client",
        icon: <Landmark size={14} />,
        primary: true,
        run: () => void act("finalize", (c, p) => c.finalizeMilestone(id, p)),
      });
    }
    if (dispute?.status === "OPEN") {
      actions.push({
        key: "rebuttal",
        label: "Attach rebuttal proof",
        icon: <Link2 size={14} />,
        run: () => {
          window.location.href = `/dispute?id=${id}`;
        },
      });
      actions.push({
        key: "resolve",
        label: "Resolve dispute",
        icon: <Scale size={14} />,
        primary: !responseWindowOpen,
        disabled: Boolean(responseWindowOpen),
        note: responseWindowOpen ? `unlocks in ${timeUntil(dispute.response_deadline)}` : undefined,
        run: () => void act("resolve", (c, p) => c.resolveDispute(id, p)),
      });
    }
  }
  if (m && ["CREATED", "FUNDED"].includes(m.status) && now > Number(m.deadline_epoch) && wallet.isCorrectNetwork && wallet.isConnected) {
    actions.push({
      key: "expire",
      label: "Mark expired",
      icon: <Hourglass size={14} />,
      run: () => void act("expire", (c, p) => c.markExpired(id, p)),
    });
  }

  return (
    <section className="t-shell page-zone" aria-labelledby="msTitle">
      {!configured && <ConfigureNotice />}

      {configured && (
        <>
          {loading ? (
            <ListState>
              <Spinner /> Reading milestone #{id}…
            </ListState>
          ) : !m ? (
            <div className="section-band" style={{ padding: "60px 8%", textAlign: "center" }}>
              <FileSearch size={26} color="var(--t-accent-dark)" />
              <h1
                style={{
                  fontFamily: 'var(--font-syne), "Syne", sans-serif',
                  letterSpacing: "-0.04em",
                  fontSize: 30,
                  margin: "14px 0 8px",
                }}
              >
                Milestone #{id} not found
              </h1>
              <p style={{ color: "var(--t-muted)", margin: "0 auto 22px", maxWidth: 400, fontSize: 13.5 }}>
                It may have been written to a different deployment. Check the contract address and try again.
              </p>
              <Link href="/history" className="pm-btn pm-btn-ghost">
                Back to the ledger
              </Link>
            </div>
          ) : (
            <>
              {/* ---------------------------------------------- header */}
              <div className="zone-head">
                <div>
                  <div className="t-kicker">Milestone #{m.id} · {role ? `you are the ${role}` : "public view"}</div>
                  <h1 id="msTitle" style={{ fontSize: "clamp(34px, 4.6vw, 62px)" }}>
                    {m.title}
                  </h1>
                  <p>{m.description}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
                  <StatusPill status={m.status} />
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost pm-btn-sm"
                    onClick={() => void load()}
                  >
                    <RefreshCcw size={12} className={loading ? "spin" : undefined} /> Refresh
                  </button>
                </div>
              </div>

              {/* ---------------------------------------------- stepper */}
              <div className="pm-steps" style={{ marginBottom: 34 }}>
                {STEPS.map((s, i) => {
                  const st = stepState(m, i);
                  return (
                    <div key={s.key} className={`pm-step ${st}`}>
                      <span className="pm-step-num">
                        {st === "done" ? <BadgeCheck size={13} /> : i + 1}
                      </span>
                      <span>
                        <b>{s.title}</b>
                        <small>{s.sub}</small>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 26, alignItems: "start" }} className="ms-cols">
                {/* ------------------------------------- left column */}
                <div style={{ display: "grid", gap: 26 }}>
                  <Panel kicker="Acceptance criteria" right={<span className="mono-note">{criteria.length} checks</span>}>
                    <div>
                      {criteria.map((c) => {
                        const s = statusById[c.id];
                        return (
                          <div key={c.id} className={`criterion ${s ? criterionClass(s.status) : ""}`}>
                            <CriterionMark status={s?.status ?? ""} />
                            <div>
                              <p>
                                {c.text}{" "}
                                {!c.mandatory && (
                                  <span className="t-chip dim" style={{ marginLeft: 6 }}>advisory</span>
                                )}
                              </p>
                              {s && (
                                <p className="why">
                                  <b>{criterionWord(s.status)}</b>
                                  {s.reason ? ` — ${s.reason}` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Panel>

                  {"decision" in verdict && (
                    <Panel
                      kicker={`Verdict · round ${verdict.round ?? rounds.length}`}
                      right={
                        <span className="t-chip">
                          proof quality: {String(verdict.evidence_quality ?? "").toLowerCase()}
                        </span>
                      }
                    >
                      <p style={{ fontSize: 14.5, lineHeight: 1.7, marginTop: 0 }}>
                        {friendlyRule(verdict.rule ?? "")}
                      </p>
                      {verdict.summary && (
                        <p style={{ color: "var(--t-muted)", fontSize: 13, lineHeight: 1.7 }}>
                          {verdict.summary}
                        </p>
                      )}
                    </Panel>
                  )}

                  {m.evidence.length > 0 && (
                    <Panel kicker="Submitted proof" right={<span className="mono-note">{m.evidence.length} items</span>}>
                      <div>
                        {m.evidence.map((e, i) => (
                          <div key={i} className="evidence-item">
                            <Link2 size={14} style={{ flex: "none", marginTop: 3 }} color="var(--t-accent-dark)" />
                            <div>
                              <div className="evidence-kicker">
                                <span className="t-chip">{String(e.kind).toLowerCase()}</span>
                                {e.source === "DISPUTE" && <span className="t-chip amber">rebuttal</span>}
                                {e.actor && <span className="mono-note">by {shortenAddress(e.actor)}</span>}
                              </div>
                              <a href={e.url} target="_blank" rel="noreferrer">
                                {e.url} <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                              </a>
                              {e.note && <p style={{ color: "var(--t-muted)", margin: "6px 0 0", fontSize: 12.5 }}>{e.note}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {m.worker_statement && (
                        <p style={{ color: "var(--t-muted)", fontSize: 13, lineHeight: 1.7, borderTop: "1px solid var(--t-line-soft)", paddingTop: 14, marginBottom: 0 }}>
                          <b style={{ color: "var(--t-ink)" }}>Worker statement — </b>
                          {m.worker_statement}
                        </p>
                      )}
                    </Panel>
                  )}

                  {dispute && (
                    <Panel
                      kicker="Dispute record"
                      right={
                        <span className={"t-chip" + (dispute.status === "OPEN" ? " amber" : "")}>
                          {dispute.status === "OPEN" ? "open" : "resolved"}
                        </span>
                      }
                    >
                      <p style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: 0 }}>
                        <b>Contested verdict:</b> {String(dispute.original_decision).replaceAll("_", " ").toLowerCase()} ·
                        opened by {shortenAddress(dispute.opened_by)}
                      </p>
                      <p style={{ color: "var(--t-muted)", fontSize: 13, lineHeight: 1.7 }}>
                        {dispute.reason}
                      </p>
                      {dispute.status === "OPEN" && (
                        <div className="notice amber" style={{ marginTop: 12 }}>
                          <Timer size={15} />
                          <span>
                            The 24-hour rebuttal window
                            {responseWindowOpen
                              ? ` closes in ${timeUntil(dispute.response_deadline)} — resolution unlocks then.`
                              : " has closed — either party may resolve the dispute now."}
                          </span>
                        </div>
                      )}
                      {dispute.status === "RESOLVED" && dispute.resolution?.decision && (
                        <div className="notice mint" style={{ marginTop: 12 }}>
                          <Scale size={15} />
                          <span>
                            Resolved to <b>{String(dispute.resolution.decision).replaceAll("_", " ").toLowerCase()}</b> in round {dispute.resolution.round}; the escrow settled immediately.
                          </span>
                        </div>
                      )}
                      {dispute.evidence.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          {dispute.evidence.map((e, i) => (
                            <div key={i} className="evidence-item">
                              <Link2 size={14} style={{ flex: "none", marginTop: 3 }} color="var(--t-accent-dark)" />
                              <div>
                                <div className="evidence-kicker">
                                  <span className="t-chip amber">rebuttal</span>
                                  {e.actor && <span className="mono-note">by {shortenAddress(e.actor)}</span>}
                                </div>
                                <a href={e.url} target="_blank" rel="noreferrer">
                                  {e.url} <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                                </a>
                                {e.note && <p style={{ color: "var(--t-muted)", margin: "6px 0 0", fontSize: 12.5 }}>{e.note}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>
                  )}

                  {rounds.length > 1 && (
                    <Panel kicker="Adjudication history" right={<span className="mono-note">{rounds.length} rounds</span>}>
                      <ul className="pm-timeline">
                        {[...rounds].reverse().map((r) => (
                          <li key={r.round}>
                            <b>
                              Round {r.round} · {r.trigger === "dispute" ? "dispute round" : "initial round"} →{" "}
                              {String(r.decision).replaceAll("_", " ").toLowerCase()}
                            </b>
                            <small>{formatEpoch(r.at)} UTC · proof quality {String(r.evidence_quality).toLowerCase()}</small>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                  )}
                </div>

                {/* ------------------------------------- right column */}
                <div style={{ display: "grid", gap: 26 }}>
                  <Panel kicker="Escrow terms">
                    <dl style={{ margin: 0 }}>
                      <div className="data-row"><dt>Escrow amount</dt><dd><b>{formatWei(m.amount_wei)} GEN</b></dd></div>
                      <div className="data-row"><dt>Locked now</dt><dd>{formatWei(m.balance_wei)} GEN</dd></div>
                      <div className="data-row">
                        <dt>Client</dt>
                        <dd><a href={explorerAddress(m.client)} target="_blank" rel="noreferrer" style={{ color: "var(--t-accent-dark)" }}>{shortenAddress(m.client)}</a></dd>
                      </div>
                      <div className="data-row">
                        <dt>Worker</dt>
                        <dd><a href={explorerAddress(m.worker)} target="_blank" rel="noreferrer" style={{ color: "var(--t-accent-dark)" }}>{shortenAddress(m.worker)}</a></dd>
                      </div>
                      <div className="data-row"><dt>Deadline</dt><dd>{formatEpoch(m.deadline_epoch)} UTC</dd></div>
                      <div className="data-row"><dt>Created</dt><dd>{formatEpoch(m.created_at)} UTC</dd></div>
                      {m.submitted_at && <div className="data-row"><dt>Proof in</dt><dd>{formatEpoch(m.submitted_at)} UTC</dd></div>}
                      {m.adjudicated_at && <div className="data-row"><dt>Verdict at</dt><dd>{formatEpoch(m.adjudicated_at)} UTC</dd></div>}
                      {decided && <div className="data-row"><dt>Dispute window</dt><dd>{disputeWindowOpen ? `closes in ${timeUntil(m.dispute_deadline)}` : "closed"}</dd></div>}
                      {m.resolved_at && <div className="data-row"><dt>Settled at</dt><dd>{formatEpoch(m.resolved_at)} UTC</dd></div>}
                      <div className="data-row"><dt>Consensus rounds</dt><dd>{m.adjudication_count}</dd></div>
                    </dl>
                  </Panel>

                  {(!wallet.isConnected || !wallet.isCorrectNetwork) && (
                    <ConnectGate action="take actions on this milestone" />
                  )}

                  {actions.length > 0 && (
                    <Panel kicker="Available actions">
                      <div style={{ display: "grid", gap: 10 }}>
                        {actions.map((a) => (
                          <div key={a.key}>
                            <button
                              type="button"
                              className={"pm-btn" + (a.primary ? "" : " pm-btn-ghost")}
                              style={{ width: "100%" }}
                              disabled={busy || a.disabled}
                              onClick={a.run}
                            >
                              {acting === a.key ? <RefreshCcw size={13} className="spin" /> : a.icon}
                              {a.label}
                            </button>
                            {a.note && (
                              <p className="mono-note" style={{ margin: "6px 2px 0" }}>{a.note}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </Panel>
                  )}

                  {tx.phase !== "idle" && <TxTracker tx={tx} />}

                  <Panel kicker="Timeline">
                    <ul className="pm-timeline">
                      {[...m.timeline].reverse().map((t, i) => (
                        <li key={i}>
                          <b>{friendlyTimeline(t.event)}</b>
                          <small>
                            {formatEpoch(t.t)} UTC · {shortenAddress(t.actor)}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>
              </div>
              <style>{`@media (max-width: 940px) { .ms-cols { grid-template-columns: 1fr !important; } }`}</style>
            </>
          )}
        </>
      )}
    </section>
  );
}
