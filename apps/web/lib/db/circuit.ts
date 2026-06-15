/**
 * Circuit breaker for database connections.
 *
 * Uses the same Redis-backed RedisCircuitBreaker from lib/payments/circuit.ts
 * so the circuit state is shared across all serverless instances (rather than
 * being in-process only, which meant each cold-start instance was always CLOSED
 * even when the DB was degraded).
 */

import { RedisCircuitBreaker } from "@/lib/payments/circuit";

export const dbCircuit = new RedisCircuitBreaker({
  name: "database",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 15_000,
  callTimeoutMs: 10_000,
});

export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  return dbCircuit.execute(fn);
}
