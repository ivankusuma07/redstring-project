/** Runs once when the server starts: the backend (database, no BACKEND_URL) starts the scan workers. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.DATABASE_URL || process.env.BACKEND_URL) return;
  if (process.env.WORKERS === "0") return;
  const { startWorkers } = await import("./lib/jobs");
  startWorkers();
}
