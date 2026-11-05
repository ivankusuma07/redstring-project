import { corsHeaders, preflight } from "@/lib/cors";
import { store } from "@/lib/store";

/** Most recently scanned tokens, latest snapshot each. */
export async function GET(req: Request) {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 100, 1), 500);
  const rows = await store().recent(limit);
  return Response.json({ rows }, { headers: { ...corsHeaders(req), "cache-control": "no-store" } });
}

export const OPTIONS = preflight;
