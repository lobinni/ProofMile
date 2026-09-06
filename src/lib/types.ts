"use client";

// ---------------------------------------------------------------------------
// ProofMile domain types — mirrors the Intelligent Contract's storage
// records exactly (contracts/proof_mile_escrow.py).
// ---------------------------------------------------------------------------

export type MilestoneStatus =
  | "CREATED"
  | "FUNDED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "INSUFFICIENT_EVIDENCE"
  | "DISPUTED"
  | "RELEASED"
  | "REFUNDED"
  | "CANCELLED"
  | "EXPIRED";

export type CriterionStatus = "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE";
export type EvidenceQuality = "HIGH" | "MEDIUM" | "LOW";

export type EvidenceKind =
  | "GITHUB"
  | "WEBSITE"
  | "DOCUMENTATION"
  | "API"
  | "OTHER";

export interface Criterion {
  id: string;
  text: string;
  mandatory: boolean;
}

export interface EvidenceItem {
  url: string;
  kind: EvidenceKind | string;
  note: string;
  /** actor/at may be absent on legacy records — treat as optional */
  at?: string;
  actor?: string;
  /** ORIGINAL = worker base proof; DISPUTE = dispute/rebuttal round */
  source?: "ORIGINAL" | "DISPUTE" | string;
}

export interface Verdict {
  decision: "APPROVED" | "REJECTED" | "INSUFFICIENT_EVIDENCE" | string;
  rule: string;
  evidence_quality: EvidenceQuality | string;
  summary: string;
  statuses: {
    id: string;
    status: CriterionStatus;
    evidence: string;
    reason: string;
  }[];
  round: number;
}

export interface TimelineEvent {
  t: number;
  actor: string;
  event: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  client: string;
  worker: string;
  criteria: string; // JSON string — parse before rendering
  evidence_requirements: string;
  evidence_urls_client: string[];
  evidence: EvidenceItem[];
  worker_statement: string;
  deadline_epoch: string;
  amount_wei: string;
  balance_wei: string;
  status: MilestoneStatus;
  created_at: string;
  submitted_at: string;
  adjudicated_at: string;
  dispute_deadline: string;
  resolved_at: string;
  adjudication_count: string;
  verdict: Verdict | Record<string, never>;
  released: boolean;
  refunded: boolean;
  timeline: TimelineEvent[];
}

export interface AdjudicationSnapshot {
  round: number;
  at: number;
  trigger: "adjudication" | "dispute" | string;
  decision: string;
  rule: string;
  evidence_quality: EvidenceQuality | string;
  summary: string;
  statuses: {
    id: string;
    status: CriterionStatus;
    evidence: string;
    reason: string;
  }[];
  evidence_refs: { url: string; kind: string; source?: string }[];
}

export interface DisputeRecord {
  milestone_id: string;
  opened_by: string;
  reason: string;
  evidence: EvidenceItem[];
  original_decision: string;
  original_round: number;
  opened_at: string;
  /** epoch seconds — resolve_dispute is blocked on-chain until this */
  response_deadline: string;
  status: "OPEN" | "RESOLVED" | string;
  resolution: { decision?: string; at?: string; round?: number };
}

export interface ContractStats {
  total_milestones: number;
  counts: Record<string, number>;
  locked_wei: string;
  contract_balance_wei: string;
}

export interface MilestoneRef {
  id: string;
  role: "client" | "worker";
}

// ---------------------------------------------------------------------------
// Transaction lifecycle (GenLayer consensus phases surfaced verbatim)
// ---------------------------------------------------------------------------

export type TxPhase =
  | "idle"
  | "signing"
  | "pending"
  | "proposing"
  | "committing"
  | "revealing"
  | "accepted"
  | "finalized"
  | "undetermined"
  | "failed";

export interface TxState {
  phase: TxPhase;
  hash?: string;
  error?: string;
  consensus?: string;
}
