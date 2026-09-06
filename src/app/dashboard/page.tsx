"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Briefcase, UserRound } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { getReadContract, isContractConfigured } from "@/lib/contract";
import type { Milestone, MilestoneRef } from "@/lib/types";
import { formatWei } from "@/lib/money";
import {
  ConfigureNotice,
  ConnectGate,
  ListState,
  MilestoneCard,
  Spinner,
} from "@/components/ui";

type Filter = "all" | "client" | "worker" | "action";

const ACTION_STATES = new Set(["CREATED", "FUNDED", "SUBMITTED", "DISPUTED"]);

export default function DashboardPage() {
  const wallet = useWallet();
  const [refs, setRefs] = useState<(MilestoneRef & { m: Milestone })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const configured = isContractConfigured();

  const load = useCallback(async () => {
    if (!configured || !wallet.address) {
      setRefs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const contract = getReadContract();
      if (!contract) throw new Error("unavailable");
      const mine = await contract.getMilestonesFor(wallet.address);
      const enriched = await Promise.all(
        mine.map(async (r) => ({ ...r, m: await contract.getMilestone(r.id) }))
      );
      enriched.sort((a, b) => Number(b.id) - Number(a.id));
      setRefs(enriched.filter((r) => r.m && r.m.id));
    } catch {
      setError(
        "Could not reach Studionet right now. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, [configured, wallet.address]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return refs;
    if (filter === "action")
      return refs.filter((r) => ACTION_STATES.has(r.m.status));
    return refs.filter((r) => r.role === filter);
  }, [refs, filter]);

  const totals = useMemo(() => {
    let asClient = 0n;
    let asWorker = 0n;
    let live = 0;
    for (const r of refs) {
      if (r.role === "client") asClient += BigInt(r.m.amount_wei || "0");
      else asWorker += BigInt(r.m.amount_wei || "0");
      if (ACTION_STATES.has(r.m.status)) live += 1;
    }
    return { asClient, asWorker, live, count: refs.length };
  }, [refs]);

  return (
    <section className="t-shell page-zone" aria-labelledby="dashTitle">
      <div className="zone-head">
        <div>
          <div className="t-kicker">
            Your ledger · {wallet.address ? "wallet bound" : "wallet off"}
          </div>
          <h1 id="dashTitle">
            Mission <span>Control</span>
          </h1>
          <p>
            Every milestone where your wallet is the client or the worker —
            live from Studionet, with the exact escrow state at each step.
          </p>
        </div>
        <Link href="/create" className="pm-btn">
          New milestone <ArrowRight size={13} />
        </Link>
      </div>

      {!configured && <ConfigureNotice />}

      {configured && !wallet.isConnected && (
        <ConnectGate action="view your personal escrow ledger" />
      )}

      {configured && wallet.isConnected && !wallet.isCorrectNetwork && (
        <ConnectGate action="read your milestones from Studionet" />
      )}

      {configured && wallet.isConnected && wallet.isCorrectNetwork && (
        <>
          <div className="stat-band" style={{ marginBottom: 42 }}>
            <div className="stat-cell">
              <b>{totals.count}</b>
              <span className="stat-label">Milestones touching you</span>
            </div>
            <div className="stat-cell">
              <b>{totals.live}</b>
              <span className="stat-label">Waiting on an action</span>
            </div>
            <div className="stat-cell">
              <b>
                <em>{formatWei(totals.asClient)}</em>
              </b>
              <span className="stat-label">GEN escrowed as client</span>
            </div>
            <div className="stat-cell">
              <b>{formatWei(totals.asWorker)}</b>
              <span className="stat-label">GEN engaged as worker</span>
            </div>
          </div>

          <div className="task-controls">
            <div className="filter-row" role="tablist" aria-label="Dashboard filters">
              {(
                [
                  ["all", "All"],
                  ["client", "As client"],
                  ["worker", "As worker"],
                  ["action", "Needs action"],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={"filter-button" + (filter === key ? " is-active" : "")}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="controls-note">
              {loading ? "Syncing…" : `${filtered.length} shown`}
            </span>
          </div>

          {loading ? (
            <ListState>
              <Spinner /> Reading your milestones…
            </ListState>
          ) : error ? (
            <div className="notice">
              <Briefcase size={16} />
              <span>
                {error}{" "}
                <button
                  type="button"
                  className="pm-btn pm-btn-ghost pm-btn-sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => void load()}
                >
                  Retry
                </button>
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="section-band" style={{ padding: "56px 8%", textAlign: "center" }}>
              <UserRound size={26} color="var(--t-accent-dark)" />
              <h2
                style={{
                  fontFamily: 'var(--font-syne), "Syne", sans-serif',
                  letterSpacing: "-0.04em",
                  fontSize: 30,
                  margin: "14px 0 8px",
                }}
              >
                Nothing here yet
              </h2>
              <p style={{ color: "var(--t-muted)", margin: "0 auto 22px", maxWidth: 420, fontSize: 13.5, lineHeight: 1.7 }}>
                {filter === "all"
                  ? "This wallet has no milestones yet. Create the first one, or ask a counterparty to assign work to you."
                  : "No milestones match this filter. Try another view."}
              </p>
              <Link href="/create" className="pm-btn">
                Create a milestone <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <div className="pm-grid">
              {filtered.map((r) => (
                <MilestoneCard key={`${r.id}-${r.role}`} m={r.m} role={r.role} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
