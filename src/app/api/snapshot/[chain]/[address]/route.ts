import { isChainKey } from "@/lib/chains";
import { getStored } from "@/lib/service";

/** Download the exact snapshot JSON that was hashed, plus its seal and Merkle proof. */
export async function GET(_req: Request, ctx: RouteContext<"/api/snapshot/[chain]/[address]">) {
  const { chain, address } = await ctx.params;
  if (!isChainKey(chain)) return Response.json({ error: "unknown chain" }, { status: 404 });
  const rec = await getStored(chain, address);
  if (!rec) return Response.json({ error: "not scanned yet" }, { status: 404 });
  const name = `${rec.snapshot.token.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "") || "token"}-${rec.snapshot.blockNumber}.json`;
  return new Response(JSON.stringify({ snapshot: rec.snapshot, seal: rec.seal }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
