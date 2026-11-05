import { flushSeals } from "@/lib/seal/anchor";

export const maxDuration = 120;

/** Anchor every pending snapshot hash now. Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await flushSeals());
}
