import { isChainKey } from "@/lib/chains";
import { corsHeaders, preflight } from "@/lib/cors";
import { getStored } from "@/lib/service";

/** Latest stored snapshot for a token (StoredSnapshot JSON). The frontend's HttpStore reads this. */
export async function GET(req: Request, ctx: RouteContext<"/api/tokens/[chain]/[address]">) {
  const { chain, address } = await ctx.params;
  const headers = { ...corsHeaders(req), "cache-control": "no-store" };
  if (!isChainKey(chain)) return Response.json({ error: "unknown chain" }, { status: 404, headers });
  const rec = await getStored(chain, address);
  if (!rec) return Response.json({ error: "not scanned yet" }, { status: 404, headers });
  return Response.json(rec, { headers });
}

export const OPTIONS = preflight;
