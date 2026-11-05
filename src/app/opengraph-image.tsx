import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, ogFonts } from "@/lib/og-card";

export const alt = "Redstring: who really holds it?";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(<OgCard rec={null} />, { ...size, fonts: await ogFonts() });
}
