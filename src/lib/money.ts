"use client";

// ---------------------------------------------------------------------------
// BigInt-only money helpers. Wei <-> GEN conversions never touch floats for
// storage — only for display — and never lose precision.
// ---------------------------------------------------------------------------

const WEI_PER_GEN = 10n ** 18n;

/** Parse a human GEN amount ("1.25") into wei as bigint. Throws on bad input. */
export function parseGenToWei(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error("Enter a plain positive number, e.g. 0.5 or 12");
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole) * WEI_PER_GEN + BigInt(fracPadded);
}

/** Format wei (string | bigint) as a trimmed GEN string for display. */
export function formatWei(wei: string | bigint, maxFrac = 4): string {
  const v = typeof wei === "string" ? BigInt(wei || "0") : wei;
  const whole = v / WEI_PER_GEN;
  const frac = v % WEI_PER_GEN;
  if (frac === 0n) return whole.toString();
  let fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  if (fracStr.length > maxFrac) fracStr = fracStr.slice(0, maxFrac);
  return `${whole}.${fracStr}`;
}

/** Shorten an address for display: 0x1234…abcd */
export function shortenAddress(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr ?? "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Epoch seconds (string) -> friendly date-time in UTC. */
export function formatEpoch(epoch: string | number): string {
  const t = typeof epoch === "string" ? parseInt(epoch || "0", 10) : epoch;
  if (!t) return "—";
  const d = new Date(t * 1000);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
}

/** Human countdown, e.g. "2d 4h" / "41m" / "now". */
export function timeUntil(epoch: string | number): string {
  const t = typeof epoch === "string" ? parseInt(epoch || "0", 10) : epoch;
  if (!t) return "—";
  const diff = t - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
