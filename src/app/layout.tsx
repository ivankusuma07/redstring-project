import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { chainNames } from "@/lib/chains";

const sans = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: ["400", "500", "700", "800", "900"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Redstring · Who really holds it?", template: "%s · Redstring" },
  description: `Token supply forensics for ${chainNames()}. Paste a token, see who really owns it, share the receipt.`,
  openGraph: { siteName: "Redstring", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
