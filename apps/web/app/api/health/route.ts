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

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, "ok" | "error"> = {};
  const latencyMs: Record<string, number> = {};
  const errors: Record<string, string> = {};

  // 1. Database check
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
