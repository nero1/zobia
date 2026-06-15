/**
 * instrumentation.ts
 *
 * Next.js instrumentation hook — runs once on server startup (Node.js runtime only).
 * Registers graceful shutdown handlers for SIGTERM/SIGINT so in-flight requests
 * complete and connections drain cleanly before the process exits.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const shutdown = async (signal: string) => {
      console.info(`[shutdown] Received ${signal} — draining connections`);

      const timeout = setTimeout(() => {
        console.error("[shutdown] Timed out waiting for drain — forcing exit");
        process.exit(1);
      }, 10_000);

      try {
        const [{ db }, { redis }] = await Promise.all([
          import("@/lib/db"),
          import("@/lib/redis"),
        ]);
        await Promise.allSettled([
          (db as unknown as { end?: () => Promise<void> }).end?.(),
          redis.quit(),
        ]);
      } catch (err) {
        console.error("[shutdown] Error during drain:", err);
      } finally {
        clearTimeout(timeout);
        process.exit(0);
      }
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  }
}
