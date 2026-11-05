import { ImageResponse } from "next/og";
import { isChainKey } from "@/lib/chains";
import { OG_SIZE, OgCard, ogFonts } from "@/lib/og-card";
import { getStored } from "@/lib/service";

export const alt = "Redstring token map card";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const rec = isChainKey(chain) ? await getStored(chain, address).catch(() => null) : null;
  return new ImageResponse(<OgCard rec={rec} />, { ...size, fonts: await ogFonts() });
}
