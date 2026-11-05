/** Backend origin for browser calls. Empty = same origin (single-server deployments, local dev). */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
