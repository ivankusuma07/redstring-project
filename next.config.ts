import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image for the VPS backend (deploy/Dockerfile sets this). Vercel builds normally.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
