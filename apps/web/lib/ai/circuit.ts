/**
 * lib/ai/circuit.ts
 *
 * Generic per-provider circuit breaker, persisted in Redis so it works
 * across Vercel lambda instances. Factored out of the old hand-rolled
 * DeepSeek/Gemini duplicated blocks in lib/ai/client.ts — adding a new AI
 * provider (see lib/ai/config.ts AI_PROVIDERS) now costs one
 * `createProviderCircuit(providerId)` call instead of copy-pasting ~60 lines.
 *
 * @module lib/ai/circuit
 */

import { redis } from "@/lib/redis";
import { atomicIncrWithTtl } from "@/lib/redis/helpers";
import { CIRCUIT_BREAKER, type AiProviderId } from "./config";

export type CircuitStatus = "closed" | "open" | "half-open";

export interface CircuitState {
  failures: number;
  openedAt: number | null;
}

interface CircuitCacheEntry {
  open: boolean;
  checkedAt: number;
}

const CACHE_TTL_MS = 5_000; // refresh cache every 5s — avoids a Redis round-trip per request

export interface ProviderCircuit {
  isOpen(): Promise<boolean>;
  recordSuccess(): Promise<void>;
  recordFailure(): Promise<void>;
  getState(): Promise<CircuitState>;
  /** Derives the admin-facing status label from raw state, matching CIRCUIT_BREAKER.recoveryTimeMs. */
  getStatus(): Promise<CircuitState & { status: CircuitStatus }>;
}

/** Build a circuit breaker instance scoped to one provider's Redis key namespace. */
export function createProviderCircuit(providerId: AiProviderId): ProviderCircuit {
  const failuresKey = `ai:circuit:${providerId}:failures`;
  const openedAtKey = `ai:circuit:${providerId}:opened_at`;
  const probeKey = `ai:circuit:${providerId}:probe`;
  let cache: CircuitCacheEntry | null = null;

  async function isOpen(): Promise<boolean> {
    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      return cache.open;
    }
    try {
      const openedAtRaw = await redis.get(openedAtKey);
      if (!openedAtRaw) {
        cache = { open: false, checkedAt: Date.now() };
        return false;
      }
      const elapsed = Date.now() - parseInt(openedAtRaw, 10);
      if (elapsed >= CIRCUIT_BREAKER.recoveryTimeMs) {
        // Half-open: only one caller gets the probe slot (SET NX prevents thundering herd).
        const probeTtl = Math.ceil(CIRCUIT_BREAKER.recoveryTimeMs / 2000);
        const gotProbe = await redis.set(probeKey, "1", "EX", probeTtl, "NX");
        if (!gotProbe) {
          cache = { open: true, checkedAt: Date.now() };
          return true;
        }
        cache = { open: false, checkedAt: Date.now() };
        return false;
      }
      cache = { open: true, checkedAt: Date.now() };
      return true;
    } catch {
      // On Redis error, default to allowing the request (fail open for availability)
      return false;
    }
  }

  async function recordFailure(): Promise<void> {
    try {
      const ttl = Math.ceil(CIRCUIT_BREAKER.recoveryTimeMs / 1000) + 60;
      const failures = await atomicIncrWithTtl(redis, failuresKey, ttl);
      if (failures >= CIRCUIT_BREAKER.failureThreshold) {
        await redis.set(openedAtKey, String(Date.now()), "EX", ttl);
        cache = { open: true, checkedAt: Date.now() };
        console.warn(`[ai:circuit-breaker] ${providerId} circuit OPEN after ${failures} failures (global)`);
      } else {
        cache = null; // invalidate cache
      }
    } catch {
      // Redis failure — don't block the AI path
    }
  }

  async function recordSuccess(): Promise<void> {
    try {
      await redis.del(failuresKey, openedAtKey, probeKey);
      cache = { open: false, checkedAt: Date.now() };
    } catch {
      // ignore
    }
  }

  async function getState(): Promise<CircuitState> {
    const [failures, openedAt] = await Promise.all([redis.get(failuresKey), redis.get(openedAtKey)]);
    return {
      failures: parseInt(failures ?? "0", 10),
      openedAt: openedAt ? parseInt(openedAt, 10) : null,
    };
  }

  async function getStatus(): Promise<CircuitState & { status: CircuitStatus }> {
    const state = await getState();
    if (!state.openedAt) return { ...state, status: "closed" };
    const elapsed = Date.now() - state.openedAt;
    return { ...state, status: elapsed >= CIRCUIT_BREAKER.recoveryTimeMs ? "half-open" : "open" };
  }

  return { isOpen, recordSuccess, recordFailure, getState, getStatus };
}
