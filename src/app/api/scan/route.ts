import { after } from "next/server";
import { isChainKey } from "@/lib/chains";
import { isAddress } from "@/lib/format";
import { maybeFlush } from "@/lib/seal/anchor";
import { runScan } from "@/lib/service";
import type { ScanEvent } from "@/lib/types";

export const maxDuration = 300;

/** POST { chain, address, force? } → NDJSON stream of ScanEvent lines. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { chain?: string; address?: string; force?: boolean };
  const chain = body.chain ?? "";
  const address = (body.address ?? "").trim();
  if (!isChainKey(chain) || !(isAddress(address) || address === "example")) {
    const err: ScanEvent = { type: "error", code: "invalid", message: "Unknown chain or malformed address." };
    return Response.json(err, { status: 400 });
  }
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: ScanEvent) => ctrl.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        await runScan(chain, address, { force: !!body.force, client }, emit);
      } finally {
        ctrl.close();
      }
    },
  });
  after(() => maybeFlush().catch(() => undefined));
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
