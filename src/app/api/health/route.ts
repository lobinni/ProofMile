export const dynamic = "force-dynamic";

/**
 * Platform health probe — intentionally dependency-free.
 * The dApp keeps all escrow state on-chain (GenLayer Studionet), so health
 * only reports process liveness and whether the contract binding is set.
 */
export async function GET() {
  const configured = /^0x[0-9a-fA-F]{40}$/.test(
    (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").trim()
  );
  return Response.json({
    ok: true,
    network: Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || 61999),
    contractConfigured: configured,
  });
}
