"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Coins,
  FileSearch,
  Gavel,
  Hourglass,
  Landmark,
  Scale,
  ScrollText,
  Sparkles,
  UploadCloud,
  Vote,
} from "lucide-react";
import { getReadContract, isContractConfigured } from "@/lib/contract";
import type { ContractStats, Milestone } from "@/lib/types";
import { formatWei } from "@/lib/money";
import { MilestoneCard, StatusPill } from "@/components/ui";

const ORBS: {
  icon: React.ReactNode;
  info?: { title: string; sub: string };
  left: string;
  top: string;
  delay: string;
  size?: number;
  tone?: string;
  infoLeft?: boolean;
}[] = [
  { icon: <BadgeCheck size={22} />, info: { title: "Milestone 07", sub: "Approved · +4 GEN" }, left: "7%", top: "14%", delay: "0s" },
  { icon: <Vote size={19} />, left: "16%", top: "38%", delay: "0.8s", size: 46, tone: "mint-2" },
  { icon: <Hourglass size={17} />, info: { title: "Milestone 11", sub: "Dispute open · 24h rebuttal" }, left: "9%", top: "62%", delay: "1.6s", size: 62, tone: "amber" },
  { icon: <FileSearch size={17} />, left: "22%", top: "82%", delay: "2.2s", size: 42, tone: "mint-2" },
  { icon: <Gavel size={22} />, info: { title: "Consensus round 2", sub: "Verdict reproduced" }, left: "88%", top: "18%", delay: "0.4s", infoLeft: true },
  { icon: <Coins size={18} />, left: "80%", top: "44%", delay: "1.2s", size: 46, tone: "mint-2" },
  { icon: <Scale size={17} />, info: { title: "Milestone 09", sub: "Released · settled" }, left: "90%", top: "66%", delay: "1.9s", size: 62, infoLeft: true },
  { icon: <ScrollText size={16} />, left: "76%", top: "86%", delay: "2.6s", size: 42, tone: "mint-2" },
];

export default function HomePage() {
  const [stats, setStats] = useState<ContractStats | null>(null);
  const [recent, setRecent] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const configured = isContractConfigured();

  useEffect(() => {
    let active = true;
    (async () => {
      const contract = getReadContract();
      if (!contract) {
        setLoading(false);
        return;
      }
      try {
        const s = await contract.getStats();
        const ids = await contract.getMilestoneIds();
        const last = [...ids].sort((a, b) => Number(b) - Number(a)).slice(0, 3);
        const items = await Promise.all(last.map((id) => contract.getMilestone(id)));
        if (!active) return;
        setStats(s);
        setRecent(items.filter((m) => m && (m as Milestone).id));
      } catch {
        /* network hiccup — landing stays alive */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const live = (stats?.counts?.FUNDED ?? 0) + (stats?.counts?.SUBMITTED ?? 0) + (stats?.counts?.DISPUTED ?? 0);
  const decided =
    (stats?.counts?.APPROVED ?? 0) +
    (stats?.counts?.REJECTED ?? 0) +
    (stats?.counts?.INSUFFICIENT_EVIDENCE ?? 0) +
    (stats?.counts?.RELEASED ?? 0) +
    (stats?.counts?.REFUNDED ?? 0);
  const locked = stats ? formatWei(stats.locked_wei) : "—";

  return (
    <>
      {/* --------------------------------------------------------- hero */}
      <section className="t-shell">
        <div className="t-hero" aria-labelledby="heroTitle">
          <div className="proof-network" aria-hidden="true">
            <svg className="proof-paths" viewBox="0 0 1200 680" preserveAspectRatio="none">
              <path d="M76 92 C205 150 128 262 226 324 S104 523 204 607" />
              <path d="M1124 108 C1005 164 1088 260 984 334 S1106 502 1002 596" />
            </svg>
            {ORBS.map((o, i) => (
              <div
                key={i}
                className={`proof-node ${o.tone ?? ""}`}
                style={{
                  left: o.left,
                  top: o.top,
                  ["--node-delay" as string]: o.delay,
                  ["--node-size" as string]: `${o.size ?? 58}px`,
                }}
              >
                <span className="orb">{o.icon}</span>
                {o.info && (
                  <span className={`proof-info ${o.infoLeft ? "info-left" : ""}`}>
                    <strong>{o.info.title}</strong>
                    <small>{o.info.sub}</small>
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="hero-copy">
            <div className="t-kicker">GenLayer Studionet · Chain 61999</div>
            <h1 id="heroTitle">
              Proof. Not <span>Promises.</span>
            </h1>
            <p className="hero-sub">
              Lock GEN · Ship work · Let validator consensus decide
            </p>
            <div className="hero-proof" aria-label="Protocol status">
              <span>
                <i />
                {configured ? (loading ? "syncing" : `${stats?.total_milestones ?? 0} milestones written`) : "awaiting contract address"}
              </span>
              <span>
                <i />
                {configured ? (loading ? "syncing" : `${live} escrows live`) : "studionet online"}
              </span>
              <span>
                <i />
                {configured ? (loading ? "syncing" : `${locked} GEN locked`) : "24h rebuttal window"}
              </span>
            </div>
            <div className="hero-cta">
              <Link href="/create" className="pm-btn pm-btn-hero">
                Open a milestone <ArrowRight size={14} />
              </Link>
              <Link href="/history" className="pm-btn pm-btn-hero pm-btn-ghost">
                Read the ledger
              </Link>
            </div>
          </div>

          <div className="hero-corner-meta">
            <span>Epoch — live</span>
            <span>UTC consensus</span>
            <span>MetaMask ready</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="t-shell page-zone" aria-labelledby="howTitle">
        <div className="zone-head">
          <div>
            <div className="t-kicker">Protocol clock · five moves</div>
            <h2 id="howTitle">
              The Escrow <span>Ritual</span>
            </h2>
            <p>
              One contract, two parties, zero custodians. Every milestone walks
              the same audited path from funding to final settlement — with an
              AI jury that must reproduce its own verdict before money moves.
            </p>
          </div>
          <StatusPill status="FUNDED" />
        </div>

        <div className="pm-grid">
          {[
            {
              icon: <ScrollText size={18} color="var(--t-accent-dark)" />,
              title: "Define & fund",
              body: "The client writes acceptance criteria in plain language, names a worker, sets a deadline, and locks the exact escrow in GEN. No partial funding, no custodians.",
              chip: "Step 01 · client",
            },
            {
              icon: <UploadCloud size={18} color="var(--t-accent-dark)" />,
              title: "Ship & submit",
              body: "The worker delivers, then attaches public proof — deployments, repositories, documents — with a statement before the deadline.",
              chip: "Step 02 · worker",
            },
            {
              icon: <Sparkles size={18} color="var(--t-accent-dark)" />,
              title: "Adjudicate",
              body: "The contract fetches the proof. An LLM scores every criterion independently — then validators re-run the same evaluation and must agree before the verdict counts.",
              chip: "Step 03 · consensus",
            },
            {
              icon: <Landmark size={18} color="var(--t-accent-dark)" />,
              title: "Settle",
              body: "Verdict in, window closed, escrow moves deterministically: released to the worker or refunded to the client. Either side can dispute first — a fresh consensus round, after a 24h rebuttal window.",
              chip: "Step 04 · finality",
            },
          ].map((s) => (
            <article key={s.title} className="pm-card" style={{ minHeight: 300 }}>
              <div className="pm-card-head">
                <span className="t-account-dot">{s.icon}</span>
                <span className="t-kicker">{s.chip}</span>
              </div>
              <h3>{s.title}</h3>
              <p className="lede">{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      <section className="t-shell" aria-label="Protocol statistics">
        <div className="stat-band">
          <div className="stat-cell">
            <b>{configured ? (loading ? "·" : stats?.total_milestones ?? 0) : "·"}</b>
            <span className="stat-label">Milestones written on-chain</span>
          </div>
          <div className="stat-cell">
            <b><em>{configured ? locked : "·"}</em></b>
            <span className="stat-label">GEN locked in escrow now</span>
          </div>
          <div className="stat-cell">
            <b>{configured ? live : "·"}</b>
            <span className="stat-label">Live escrows in flight</span>
          </div>
          <div className="stat-cell">
            <b>{configured ? decided : "·"}</b>
            <span className="stat-label">Verdicts & settlements closed</span>
          </div>
          <div className="stat-cell">
            <b><em>24h</em></b>
            <span className="stat-label">Guaranteed rebuttal window</span>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- recent */}
      <section className="t-shell page-zone" aria-labelledby="recentTitle">
        <div className="zone-head">
          <div>
            <div className="t-kicker">Latest from the contract</div>
            <h2 id="recentTitle">
              Recently <span>Written</span>
            </h2>
          </div>
          <Link href="/history" className="pm-btn pm-btn-ghost">
            Full ledger <ArrowRight size={13} />
          </Link>
        </div>

        {!configured ? (
          <div className="notice amber">
            <FileSearch size={16} />
            <span>
              No contract address is bound yet. Configure{" "}
              <strong>NEXT_PUBLIC_CONTRACT_ADDRESS</strong> and this strip
              becomes a live feed of the newest milestones on Studionet.
            </span>
          </div>
        ) : loading ? (
          <div className="list-state">Reading the ledger…</div>
        ) : recent.length === 0 ? (
          <div className="list-state">
            Nothing on-chain yet — the first milestone will appear here.
          </div>
        ) : (
          <div className="pm-grid">
            {recent.map((m) => (
              <MilestoneCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ band */}
      <section className="t-shell">
        <div className="pm-dark-panel" style={{ padding: "64px 8%", textAlign: "center" }}>
          <div className="t-kicker" style={{ color: "var(--t-accent)" }}>
            Studionet · Chain 61999
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-syne), "Syne", sans-serif',
              letterSpacing: "-0.06em",
              fontSize: "clamp(34px, 4.5vw, 58px)",
              lineHeight: 1,
              margin: "18px 0 0",
              fontWeight: 700,
            }}
          >
            Escrow that <span style={{ color: "var(--t-accent)" }}>thinks</span>
            <br />
            before it pays.
          </h2>
          <p className="hero-sub" style={{ marginTop: 22 }}>
            Connect MetaMask · create a milestone · fund the exact amount
          </p>
          <div className="hero-cta" style={{ marginTop: 34 }}>
            <Link href="/dashboard" className="pm-btn pm-btn-hero">
              Open your dashboard <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
