"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type {
  AdjudicationSnapshot,
  ContractStats,
  DisputeRecord,
  Milestone,
  MilestoneRef,
  TxState,
} from "./types";

// ---------------------------------------------------------------------------
// Single source of truth for the deployment address + network settings.
// To point the dApp at a different deployment, change ONLY the environment
// variable NEXT_PUBLIC_CONTRACT_ADDRESS (see .env.example) and restart.
// No other file references a contract address.
// ---------------------------------------------------------------------------

export const CHAIN_ID = parseInt(
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61999",
  10
);
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER ||
  "https://explorer-studio.genlayer.com";

export const NETWORK_NAME = "GenLayer Studionet";
export const CURRENCY_SYMBOL = "GEN";

export function getContractAddress(): string {
  return (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").trim();
}

export function isContractConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(getContractAddress());
}

function makeClient(account?: string) {
  const config: Record<string, unknown> = { chain: studionet };
  const rpc = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL;
  if (rpc) config.endpoint = rpc;
  if (account) config.account = account;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient(config as any);
}

function parseJsonOr<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return (raw as T) ?? fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Contract binding
// ---------------------------------------------------------------------------

export class ProofMileContract {
  readonly address: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private account: string | null;

  constructor(address: string, account?: string | null) {
    this.address = address as `0x${string}`;
    this.account = account ?? null;
    this.client = makeClient(account ?? undefined);
  }

  updateAccount(account: string | null) {
    this.account = account;
    this.client = makeClient(account ?? undefined);
  }

  hasAccount(): boolean {
    return this.account !== null;
  }

  // ------------------------------------------------------------- reads

  async getMilestone(id: string | number): Promise<Milestone> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_milestone",
      args: [BigInt(id)],
    });
    return parseJsonOr<Milestone>(raw, { error: "unreadable" } as never);
  }

  async getMilestoneIds(): Promise<string[]> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_milestone_ids",
      args: [],
    });
    if (Array.isArray(raw)) return raw.map(String);
    return [];
  }

  async getMilestonesFor(addr: string): Promise<MilestoneRef[]> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_milestones_for",
      args: [addr],
    });
    return parseJsonOr<MilestoneRef[]>(raw, []);
  }

  async getAdjudications(
    id: string | number
  ): Promise<AdjudicationSnapshot[]> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_adjudications",
      args: [BigInt(id)],
    });
    return parseJsonOr<AdjudicationSnapshot[]>(raw, []);
  }

  async getDispute(id: string | number): Promise<DisputeRecord | null> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_dispute",
      args: [BigInt(id)],
    });
    const rec = parseJsonOr<DisputeRecord>(raw, {
      error: "not_found",
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!rec || (rec as any).error) return null;
    return rec;
  }

  async getParams(): Promise<Record<string, unknown>> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_params",
      args: [],
    });
    return parseJsonOr<Record<string, unknown>>(raw, {});
  }

  async getContractBalance(): Promise<bigint> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_contract_balance",
      args: [],
    });
    return BigInt(raw as string | bigint);
  }

  async getStats(): Promise<ContractStats> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: "get_stats",
      args: [],
    });
    return parseJsonOr<ContractStats>(raw, {
      total_milestones: 0,
      counts: {},
      locked_wei: "0",
      contract_balance_wei: "0",
    });
  }

  // ------------------------------------------------------------- writes

  /**
   * Runs a write through the full GenLayer lifecycle with phase callbacks.
   * Returns the FINALIZED receipt (or throws a user-facing error).
   */
  async write(
    functionName: string,
    args: unknown[],
    onPhase: (state: TxState) => void,
    value?: bigint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    onPhase({ phase: "signing" });
    const hash = await this.client.writeContract({
      address: this.address,
      functionName,
      args,
      value: value ?? 0n,
    });
    onPhase({ phase: "pending", hash: String(hash) });

    // Poll through the consensus pipeline (PROPOSING → COMMITTING →
    // REVEALING → ACCEPTED → FINALIZED).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt: any = await this.client.waitForTransactionReceipt({
      hash,
      status: "FINALIZED",
      interval: 3000,
      retries: 120,
    });

    const status = String(receipt?.status ?? receipt?.tx_status ?? "FINALIZED");
    onPhase({ phase: "finalized", hash: String(hash), consensus: status });

    // A FINALIZED consensus can still carry a failed execution — surface it.
    const leader = receipt?.consensus_data?.leader_receipt?.[0];
    const execResult = leader?.execution_result;
    if (execResult && String(execResult).toUpperCase() === "ERROR") {
      const msg = String(leader?.result?.payload ?? "execution failed");
      onPhase({ phase: "failed", hash: String(hash), error: msg });
      throw new Error(explainContractError(msg));
    }
    return receipt;
  }

  async createMilestone(
    p: {
      title: string;
      description: string;
      worker: string;
      criteriaJson: string;
      evidenceRequirements: string;
      deadlineEpoch: bigint;
      amountWei: bigint;
      initialUrlsJson: string;
    },
    onPhase: (s: TxState) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    return this.write(
      "create_milestone",
      [
        p.title,
        p.description,
        p.worker,
        p.criteriaJson,
        p.evidenceRequirements,
        p.deadlineEpoch,
        p.amountWei,
        p.initialUrlsJson,
      ],
      onPhase
    );
  }

  async fundMilestone(
    id: string | number,
    amountWei: bigint,
    onPhase: (s: TxState) => void
  ) {
    return this.write("fund_milestone", [BigInt(id)], onPhase, amountWei);
  }

  async cancelMilestone(id: string | number, onPhase: (s: TxState) => void) {
    return this.write("cancel_milestone", [BigInt(id)], onPhase);
  }

  async markExpired(id: string | number, onPhase: (s: TxState) => void) {
    return this.write("mark_expired", [BigInt(id)], onPhase);
  }

  async submitEvidence(
    id: string | number,
    evidenceJson: string,
    statement: string,
    onPhase: (s: TxState) => void
  ) {
    return this.write(
      "submit_evidence",
      [BigInt(id), evidenceJson, statement],
      onPhase
    );
  }

  async startAdjudication(id: string | number, onPhase: (s: TxState) => void) {
    return this.write("start_adjudication", [BigInt(id)], onPhase);
  }

  async finalizeMilestone(id: string | number, onPhase: (s: TxState) => void) {
    return this.write("finalize_milestone", [BigInt(id)], onPhase);
  }

  async openDispute(
    id: string | number,
    reason: string,
    evidenceJson: string,
    onPhase: (s: TxState) => void
  ) {
    return this.write(
      "open_dispute",
      [BigInt(id), reason, evidenceJson],
      onPhase
    );
  }

  async submitDisputeEvidence(
    id: string | number,
    evidenceJson: string,
    onPhase: (s: TxState) => void
  ) {
    return this.write(
      "submit_dispute_evidence",
      [BigInt(id), evidenceJson],
      onPhase
    );
  }

  async resolveDispute(id: string | number, onPhase: (s: TxState) => void) {
    return this.write("resolve_dispute", [BigInt(id)], onPhase);
  }
}

// ---------------------------------------------------------------------------
// Error translation — keep raw contract strings out of the UI
// ---------------------------------------------------------------------------

export function explainContractError(raw: string): string {
  const msg = raw || "Something went wrong";
  const lower = msg.toLowerCase();
  const table: [string, string][] = [
    ["milestone not found", "This milestone could not be found on-chain."],
    ["not awaiting funding", "This milestone is not waiting to be funded."],
    ["only the client can fund", "Only the client wallet can fund this escrow."],
    ["send exactly the escrow", "The funding amount must match the escrow exactly."],
    ["only the assigned worker", "Only the assigned worker wallet can submit proof."],
    ["deadline has passed", "The deadline has passed; late submissions are not accepted."],
    ["requires submitted state", "Proof must be submitted before adjudication can run."],
    ["only client or worker", "Only the client or worker wallet can perform this action."],
    ["only the client can cancel", "Only the client wallet can cancel this milestone."],
    ["title must be", "Enter a title between 3 and 200 characters."],
    ["description too long", "The description is too long — shorten it and retry."],
    ["evidence_requirements too long", "The expected-proof text is too long — shorten it and retry."],
    ["statement too long", "The statement is too long — shorten it and retry."],
    ["dispute reason too long", "The dispute reason is too long — shorten it and retry."],
    ["dispute reason must be at least", "Write a dispute reason of at least 10 characters."],
    ["statement must explain", "Write a statement of at least 10 characters explaining the proof."],
    ["worker must differ", "The worker must be a different wallet than the client."],
    ["escrow amount below dust", "The escrow amount is below the minimum allowed."],
    ["deadline must be at least 1h", "The deadline must be at least one hour in the future."],
    ["too many criteria", "A milestone can have at most 10 acceptance criteria."],
    ["criterion ids must be unique", "Acceptance criterion ids must be unique."],
    ["too many evidence items", "At most 5 proof links per submission."],
    ["evidence must contain at least one", "Attach at least one valid proof link."],
    ["evidence array is empty", "Attach at least one proof link."],
    ["invalid evidence url", "One of the proof links is invalid — use full http(s) URLs."],
    ["can only cancel before", "Cancellation is only possible before proof is submitted."],
    ["dispute window is still open", "The dispute window is still open — settlement comes after it closes."],
    ["dispute window has closed", "The dispute window has already closed."],
    ["already disputed", "This milestone has already been disputed once."],
    ["response window is still open", "The 24h rebuttal window is still open — resolution unlocks after it."],
    ["not an expirable state", "This milestone cannot be marked expired in its current state."],
    ["deadline has not passed", "The deadline has not passed yet."],
    ["adjudication rounds exhausted", "All adjudication rounds have been used."],
    ["escrow already settled", "The escrow for this milestone was already settled."],
    ["dispute evidence limit", "The dispute evidence limit has been reached."],
    ["user rejected", "The transaction was rejected in the wallet."],
    ["insufficient", "The wallet does not have enough GEN for this action."],
  ];
  for (const [needle, friendly] of table) {
    if (lower.includes(needle)) return friendly;
  }
  return "The action could not be completed on-chain. Please review the milestone state and try again.";
}

// ---------------------------------------------------------------------------
// Singleton access for read-only + account-bound usage
// ---------------------------------------------------------------------------

let readInstance: ProofMileContract | null = null;

export function getReadContract(): ProofMileContract | null {
  const addr = getContractAddress();
  if (!isContractConfigured()) return null;
  if (!readInstance || readInstance.address !== addr) {
    readInstance = new ProofMileContract(addr);
  }
  return readInstance;
}

export function getWriteContract(account: string): ProofMileContract {
  const addr = getContractAddress();
  if (!isContractConfigured()) {
    throw new Error("NEXT_PUBLIC_CONTRACT_ADDRESS is not configured");
  }
  return new ProofMileContract(addr, account);
}

export function explorerAddress(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
