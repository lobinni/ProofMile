"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Blocks,
  ChevronDown,
  LoaderCircle,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { shortenAddress } from "@/lib/money";
import { getContractAddress, explorerAddress } from "@/lib/contract";

export function BrandMark() {
  return (
    <span className="t-brand-mark" aria-hidden="true">
      <ShieldCheck size={16} strokeWidth={2.2} />
    </span>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const wallet = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const links = [
    { href: "/history", label: "Ledger" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/create", label: "Create" },
  ];

  const accountLabel = wallet.isBusy
    ? "Connecting…"
    : wallet.isConnected && wallet.address
      ? shortenAddress(wallet.address)
      : "Connect wallet";
  const accountSub = wallet.isConnected
    ? wallet.isCorrectNetwork
      ? "Studionet · 61999"
      : "Wrong network — switch"
    : "MetaMask · Studionet";

  return (
    <header className="t-header">
      <div className="t-shell">
        <nav className="t-nav" aria-label="Platform navigation">
          <Link className="t-brand" href="/" aria-label="ProofMile Escrow home">
            <BrandMark />
            <span className="t-brand-name">
              Proof<span>Mile</span>
            </span>
          </Link>

          <div className="t-nav-links">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={pathname?.startsWith(l.href) ? "active" : ""}
                aria-current={pathname?.startsWith(l.href) ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="t-account-wrap" ref={menuRef}>
            <button
              className="t-account"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => {
                if (!wallet.isMetaMaskInstalled) {
                  window.open("https://metamask.io/download/", "_blank");
                  return;
                }
                if (!wallet.isConnected) void wallet.connect();
                else setMenuOpen((o) => !o);
              }}
            >
              <span
                className={
                  "t-account-dot" + (wallet.isConnected ? "" : " t-account-dots-off")
                }
              >
                {wallet.isBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : wallet.isConnected ? (
                  <Blocks size={16} />
                ) : (
                  <Wallet size={16} />
                )}
              </span>
              <span className={wallet.isConnected ? "" : "off"}>
                <strong>{accountLabel}</strong>
                <small>{accountSub}</small>
              </span>
              {wallet.isConnected && (
                <ChevronDown
                  size={14}
                  style={{ transition: "transform .18s", transform: menuOpen ? "rotate(180deg)" : "none" }}
                />
              )}
            </button>

            {menuOpen && wallet.isConnected && (
              <div
                className="pm-panel"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  width: 260,
                  zIndex: 50,
                }}
                role="dialog"
                aria-label="Wallet menu"
              >
                <div className="pm-panel-body" style={{ padding: 14 }}>
                  <p className="mono-note" style={{ margin: "0 0 10px" }}>
                    Signed in as {shortenAddress(wallet.address ?? "", 10, 6)}
                  </p>
                  {!wallet.isCorrectNetwork && (
                    <button
                      type="button"
                      className="pm-btn pm-btn-mint pm-btn-sm"
                      style={{ width: "100%", marginBottom: 8 }}
                      onClick={() => void wallet.switchToStudionet()}
                    >
                      <RefreshCcw size={13} /> Switch to Studionet
                    </button>
                  )}
                  <button
                    type="button"
                    className="pm-btn pm-btn-ghost pm-btn-sm"
                    style={{ width: "100%" }}
                    onClick={() => wallet.disconnect()}
                  >
                    <LogOut size={13} /> Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </nav>

        {wallet.isConnected && !wallet.isCorrectNetwork && (
          <div className="notice amber" style={{ marginTop: 12 }}>
            <RefreshCcw size={15} />
            <span>
              Your wallet is on a different network. Switch MetaMask to{" "}
              <strong>GenLayer Studionet (chain 61999)</strong> to read and
              write milestones.{" "}
              <button
                type="button"
                onClick={() => void wallet.switchToStudionet()}
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  color: "#8a5b13",
                  font: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Switch now
              </button>
            </span>
          </div>
        )}
        {wallet.error && (
          <div className="notice" style={{ marginTop: 12 }}>
            <Wallet size={15} />
            <span>{wallet.error}</span>
          </div>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  const addr = getContractAddress();
  return (
    <footer className="t-footer">
      <div className="t-shell t-footer-inner">
        <Link className="t-brand" href="/">
          <BrandMark />
          <span className="t-brand-name">
            Proof<span>Mile</span>
          </span>
        </Link>
        <div className="t-footer-meta">
          <div>GenLayer Studionet · Chain 61999 · Proof, not promises</div>
          <div>
            {addr ? (
              <a href={explorerAddress(addr)} target="_blank" rel="noreferrer">
                Contract {shortenAddress(addr, 8, 6)} ↗
              </a>
            ) : (
              <span>Contract address pending configuration</span>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
