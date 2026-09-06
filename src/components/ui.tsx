"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileWarning,
  Landmark,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Milestone, MilestoneStatus, TxState } from "@/lib/types";
import { formatWei, shortenAddress, timeUntil } from "@/lib/money";
import { explorerTx } from "@/lib/contract";
import { useWallet } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<
  MilestoneStatus,
  { tone: string; label: string }
> = {
  CREATED: { tone: "s-idle", label: "Awaiting funding" },
  FUNDED: { tone: "s-live", label: "Escrow funded" },
  SUBMITTED: { tone: "s-wait", label: "Proof submitted" },
  APPROVED: { tone: "s-good", label: "Approved" },
  REJECTED: { tone: "s-bad", label: "Rejected" },
  INSUFFICIENT_EVIDENCE: { tone: "s-wait", label: "More proof needed" },
  DISPUTED: { tone: "s-wait", label: "Under dispute" },
  RELEASED: { tone: "s-good", label: "Paid out" },
  REFUNDED: { tone: "s-idle", label: "Refunded" },
  CANCELLED: { tone: "s-idle", label: "Cancelled" },
  EXPIRED: { tone: "s-bad", label: "Expired" },
};

export function StatusPill({ status }: { status: MilestoneStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.CREATED;
  return (
    <span className={`status-pill ${tone.tone}`}>
      <i aria-hidden="true" className={status === "SUBMITTED" || status === "DISPUTED" ? "pulse-dot" : undefined} />
      {tone.label}
    </span>
  );
}

export function CriterionMark({ status }: { status: string }) {
  if (status === "PASS")
    return <span className="criterion-mark"><CircleCheck size={15} /></span>;
  if (status === "FAIL")
    return <span className="criterion-mark"><X size={15} /></span>;
  return <span className="criterion-mark"><Clock3 size={15} /></span>;
}

export function criterionClass(status: string): string {
  if (status === "PASS") return "pass";
  if (status === "FAIL") return "fail";
  return "hold";
}

export function criterionWord(status: string): string {
  if (status === "PASS") return "Passed";
  if (status === "FAIL") return "Failed";
  if (status === "INSUFFICIENT_EVIDENCE") return "Not proven";
  return "Unscored";
}

// ---------------------------------------------------------------------------
// Milestone card (grid item)
// ---------------------------------------------------------------------------

export function MilestoneCard({ m, role }: { m: Milestone; role?: string }) {
  const amount = formatWei(m.amount_wei);
  return (
    <Link
      href={`/milestone/${m.id}`}
      className="pm-card"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div className="pm-card-head">
        <span className="t-kicker">Milestone #{m.id}</span>
        <StatusPill status={m.status} />
      </div>
      <h3>{m.title}</h3>
      <p className="lede">{m.description}</p>
      <div className="pm-card-meta">
        <span className="t-chip">{amount} GEN</span>
        {role && <span className="t-chip dim">You are the {role}</span>}
        {m.status === "FUNDED" && (
          <span className="t-chip amber">due in {timeUntil(m.deadline_epoch)}</span>
        )}
        {m.status === "CREATED" && (
          <span className="t-chip dim">funding pending</span>
        )}
      </div>
      <div className="pm-card-foot">
        <span className="mono-note">
          {shortenAddress(m.client)} → {shortenAddress(m.worker)}
        </span>
        <ArrowRight size={15} color="var(--t-accent-dark)" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Transaction phase tracker (consensus pipeline)
// ---------------------------------------------------------------------------

const PIPELINE = [
  "signing",
  "pending",
  "proposing",
  "committing",
  "revealing",
  "accepted",
  "finalized",
];

const PHASE_LABEL: Record<string, string> = {
  signing: "Sign",
  pending: "Broadcast",
  proposing: "Proposing",
  committing: "Committing",
  revealing: "Revealing",
  accepted: "Accepted",
  finalized: "Finalized",
};

export function TxTracker({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;
  const failed = tx.phase === "failed";
  const currentIdx = PIPELINE.indexOf(tx.phase);
  return (
    <div className="tx-tracker fade-up" role="status" aria-live="polite">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {failed ? (
          <CircleAlert size={15} color="#ff9b85" />
        ) : tx.phase === "finalized" ? (
          <CircleCheck size={15} color="var(--t-accent)" />
        ) : (
          <LoaderCircle size={15} className="spin" color="var(--t-accent)" />
        )}
        <strong style={{ font: "600 12px/1 var(--font-manrope), sans-serif" }}>
          {failed
            ? "The transaction did not finalize"
            : tx.phase === "finalized"
              ? "Finalized on Studionet"
              : "Working through validator consensus…"}
        </strong>
      </div>
      <div className="tx-phases">
        {PIPELINE.map((p, i) => {
          let cls = "tx-phase";
          if (failed && p === tx.phase) cls += " err";
          else if (!failed && i < currentIdx) cls += " ok";
          else if (!failed && i === currentIdx) cls += " hot";
          return (
            <span key={p} className={cls}>
              {PHASE_LABEL[p] ?? p}
            </span>
          );
        })}
      </div>
      {tx.hash && (
        <div className="tx-hash" style={{ marginTop: 10 }}>
          <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">
            {shortenAddress(tx.hash, 14, 10)} ↗
          </a>
        </div>
      )}
      {tx.error && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#ff9b85" }}>
          {tx.error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gates + empty states
// ---------------------------------------------------------------------------

export function ListState({ children }: { children: React.ReactNode }) {
  return <div className="list-state">{children}</div>;
}

export function Spinner({ size = 26 }: { size?: number }) {
  return (
    <LoaderCircle size={size} className="spin" color="var(--t-accent-dark)" />
  );
}

/** Shown instead of on-chain data when no contract address is configured. */
export function ConfigureNotice() {
  return (
    <div className="notice amber">
      <FileWarning size={16} />
      <span>
        <b>Contract address not configured.</b> The dApp is ready, but it is
        not bound to a deployment yet. Set{" "}
        <strong>NEXT_PUBLIC_CONTRACT_ADDRESS</strong> in the environment to
        the deployed escrow address (see <strong>docs/deployment.md</strong>)
        and restart — every page will read live Studionet data.
      </span>
    </div>
  );
}

/** Shown when an action requires a connected wallet on the right network. */
export function ConnectGate({ action }: { action: string }) {
  const wallet = useWallet();
  return (
    <div className="notice mint">
      <Landmark size={16} />
      <span style={{ flex: 1 }}>
        Connect MetaMask on <b>GenLayer Studionet (chain 61999)</b> to{" "}
        {action}.
      </span>
      {!wallet.isConnected ? (
        <button
          type="button"
          className="pm-btn pm-btn-sm"
          onClick={() => void wallet.connect()}
        >
          Connect wallet
        </button>
      ) : !wallet.isCorrectNetwork ? (
        <button
          type="button"
          className="pm-btn pm-btn-sm"
          onClick={() => void wallet.switchToStudionet()}
        >
          Switch network
        </button>
      ) : null}
    </div>
  );
}

/** Panel shell */
export function Panel({
  kicker,
  right,
  children,
}: {
  kicker: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="pm-panel">
      <div className="pm-panel-head">
        <span className="t-kicker">{kicker}</span>
        {right}
      </div>
      <div className="pm-panel-body">{children}</div>
    </section>
  );
}
