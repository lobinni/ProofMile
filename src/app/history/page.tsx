"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCcw } from "lucide-react";
import { getReadContract, isContractConfigured } from "@/lib/contract";
import type { Milestone, MilestoneStatus } from "@/lib/types";
import { formatWei, shortenAddress, timeUntil } from "@/lib/money";
import { ConfigureNotice, ListState, Spinner, StatusPill } from "@/components/ui";

const FILTERS: [string, string][] = [
  ["ALL", "All"],
  ["CREATED", "Awaiting funds"],
  ["FUNDED", "Funded"],
  ["SUBMITTED", "Proof in"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["DISPUTED", "Disputed"],
  ["RELEASED", "Paid out"],
  ["REFUNDED", "Refunded"],
  ["CLOSED", "Closed"],
];

export default function HistoryPage() {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const configured = isContractConfigured();

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const contract = getReadContract();
      if (!contract) return;
      const ids = await contract.getMilestoneIds();
      const ordered = [...ids].sort((a, b) => Number(b) - Number(a));
      const all = await Promise.all(ordered.map((id) => contract.getMilestone(id)));
      setItems(all.filter((m) => m && m.id));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "ALL") return items;
    if (filter === "CLOSED")
      return items.filter((m) =>
        ["RELEASED", "REFUNDED", "CANCELLED", "EXPIRED"].includes(m.status)
      );
    return items.filter((m) => m.status === (filter as MilestoneStatus));
  }, [items, filter]);

  return (
    <section className="t-shell page-zone" aria-labelledby="histTitle">
      <div className="zone-head">
        <div>
          <div className="t-kicker">Public ledger · every milestone ever written</div>
          <h1 id="histTitle">
            The <span>Ledger</span>
          </h1>
          <p>
            An open record of escrowed work: funded, judged, disputed, settled.
            Every row is read straight from the contract on Studionet.
          </p>
        </div>
        <button
          type="button"
          className="pm-btn pm-btn-ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCcw size={13} className={loading ? "spin" : undefined} /> Refresh
        </button>
      </div>

      {!configured && <ConfigureNotice />}

      {configured && (
        <>
          <div className="task-controls">
            <div className="filter-row" role="tablist" aria-label="Ledger filters">
              {FILTERS.map(([key, label]) => (
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
              {loading ? "Syncing…" : `${filtered.length} of ${items.length}`}
            </span>
          </div>

          <div className="section-band">
            {loading ? (
              <ListState>
                <Spinner /> Reading the ledger…
              </ListState>
            ) : filtered.length === 0 ? (
              <ListState>
                {items.length === 0
                  ? "The ledger is empty — the first milestone will anchor it."
                  : "Nothing matches this filter."}
              </ListState>
            ) : (
              filtered.map((m) => (
                <Link key={m.id} href={`/milestone/${m.id}`} className="list-row">
                  <span className="id">#{m.id}</span>
                  <span>
                    <b>{m.title}</b>
                    <small className="sub">
                      {shortenAddress(m.client)} → {shortenAddress(m.worker)}
                      {m.status === "FUNDED" && ` · due in ${timeUntil(m.deadline_epoch)}`}
                      {m.status === "DISPUTED" && " · rebuttal window running"}
                    </small>
                  </span>
                  <span className="t-chip">{formatWei(m.amount_wei)} GEN</span>
                  <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                    <StatusPill status={m.status} />
                    <ArrowRight size={14} color="var(--t-accent-dark)" />
                  </span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
