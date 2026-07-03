export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Health check endpoint for load balancers and monitoring. (BUG-37)
 * Returns 200 when all dependencies are healthy, 503 when degraded.
 * Never includes sensitive information (connection strings, stack traces).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { dbCircuit } from "@/lib/db/circuit";

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, "ok" | "error"> = {};
  const latencyMs: Record<string, number> = {};
  const errors: Record<string, string> = {};

  // 1. Database check (this query itself runs through the same circuit
  // breaker as every other DB call — see lib/db/circuit.ts / BUG-CAP-02 — so
  // a periodic health-check poll doubles as the breaker's own recovery probe
  // once it moves from OPEN to HALF_OPEN).
  const dbStart = Date.now();
  try {
    await db.query("SELECT 1", []);
    checks.db = "ok";
    latencyMs.db = Date.now() - dbStart;
  } catch {
    checks.db = "error";
    latencyMs.db = Date.now() - dbStart;
    errors.db = "Database connection failed";
  }

  // 1b. DB circuit breaker state — surfaced separately from the raw query
  // check above so ops can distinguish "DB is slow/erroring" from "the
  // breaker has already tripped and is fast-failing requests".
  const dbCircuitMetrics = await dbCircuit.getMetrics();
  checks.dbCircuit = dbCircuitMetrics.state === "OPEN" ? "error" : "ok";
  if (dbCircuitMetrics.state !== "CLOSED") {
    errors.dbCircuit = `Circuit is ${dbCircuitMetrics.state} (failure rate ${dbCircuitMetrics.failureRate.toFixed(1)}%)`;
  }

  // 2. Redis check
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = "ok";
    latencyMs.redis = Date.now() - redisStart;
  } catch {
    checks.redis = "error";
    latencyMs.redis = Date.now() - redisStart;
    errors.redis = "Redis connection failed";
  }

  // 3. Critical env vars
  const requiredEnvVars = ["JWT_SECRET", "DATABASE_URL", "REDIS_URL"];
  const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingEnvVars.length > 0) {
    checks.config = "error";
    errors.config = `Missing required environment variables`;
  } else {
    checks.config = "ok";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  const status = allOk ? "ok" : "degraded";
  const httpStatus = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      checks,
      latencyMs,
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
    },
    { status: httpStatus }
  );
}
