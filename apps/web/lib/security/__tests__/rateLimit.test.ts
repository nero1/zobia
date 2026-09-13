/**
 * Unit tests for the two-tier rate limiter (REDIS-COST-01).
 *
 * The limiter was rewritten from a sorted-set sliding window (four Redis
 * commands and one stored member PER REQUEST) to:
 *   - `tier: "local"` — counted entirely in-process, zero Redis commands;
 *   - `tier: "exact"` — an approximate sliding window over two fixed-window
 *     counters, costing an MGET + INCR (+ a PEXPIRE on window creation).
 *
 * These tests pin the properties that actually matter for security and cost:
 * that local limiters never touch Redis, that exact limiters do, that limits
 * are enforced in both tiers, and that a Redis outage fails CLOSED for
 * security-critical limiters and OPEN for ordinary ones.
 */

const mockEval = jest.fn();

jest.mock("@/lib/redis", () => ({
  redis: { eval: (...args: unknown[]) => mockEval(...args) },
}));

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import {
  checkUserRateLimit,
  enforceRateLimit,
  RATE_LIMITS,
  type RateLimitOptions,
} from "@/lib/security/rateLimit";
import { ApiError } from "@/lib/api/errors";

/** Allow-everything reply in the shape the Lua script returns. */
function allowReply(remaining = 99): [number, number, number] {
  return [1, remaining, 60_000];
}

/** Deny reply in the shape the Lua script returns. */
function denyReply(): [number, number, number] {
  return [0, 0, 60_000];
}

/** Unique subject per test so in-process counters never bleed between cases. */
let subjectCounter = 0;
function nextSubject(): string {
  subjectCounter += 1;
  return `user-${subjectCounter}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  mockEval.mockReset();
});

describe("tier: local", () => {
  const localOptions: RateLimitOptions = {
    limit: 3,
    windowMs: 60_000,
    name: "test:local",
    tier: "local",
  };

  it("never issues a Redis command", async () => {
    const subject = nextSubject();
    await checkUserRateLimit(subject, localOptions);
    await checkUserRateLimit(subject, localOptions);

    expect(mockEval).not.toHaveBeenCalled();
  });

  it("still enforces the limit within a single instance", async () => {
    const subject = nextSubject();

    const first = await checkUserRateLimit(subject, localOptions);
    const second = await checkUserRateLimit(subject, localOptions);
    const third = await checkUserRateLimit(subject, localOptions);
    const fourth = await checkUserRateLimit(subject, localOptions);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("counts down `remaining` as requests are consumed", async () => {
    const subject = nextSubject();

    expect((await checkUserRateLimit(subject, localOptions)).remaining).toBe(2);
    expect((await checkUserRateLimit(subject, localOptions)).remaining).toBe(1);
    expect((await checkUserRateLimit(subject, localOptions)).remaining).toBe(0);
  });
});

describe("tier: exact", () => {
  const exactOptions: RateLimitOptions = {
    limit: 5,
    windowMs: 60_000,
    name: "test:exact",
    // bypassL1 so the in-process skip cache never hides the Redis call we are
    // asserting on — this mirrors how every security-critical preset is set up.
    bypassL1: true,
  };

  it("issues exactly one Redis round-trip per request", async () => {
    mockEval.mockResolvedValue(allowReply());

    await checkUserRateLimit(nextSubject(), exactOptions);

    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it("passes both bucket keys, hash-tagged into a single cluster slot", async () => {
    mockEval.mockResolvedValue(allowReply());

    await checkUserRateLimit("abc", exactOptions);

    const [, numKeys, currentKey, previousKey] = mockEval.mock.calls[0];
    expect(numKeys).toBe(2);
    // A Lua script may only touch keys in one Redis Cluster slot, so both
    // buckets must share a `{...}` hash tag.
    expect(currentKey).toMatch(/^\{rl:user:test:exact:abc\}:\d+$/);
    expect(previousKey).toMatch(/^\{rl:user:test:exact:abc\}:\d+$/);

    const currentBucket = Number(String(currentKey).split(":").pop());
    const previousBucket = Number(String(previousKey).split(":").pop());
    expect(currentBucket - previousBucket).toBe(1);
  });

  it("denies when Redis reports the window is full", async () => {
    mockEval.mockResolvedValue(denyReply());

    const result = await checkUserRateLimit(nextSubject(), exactOptions);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("Redis outage behaviour", () => {
  it("fails CLOSED for security-critical limiters (bypassL1)", async () => {
    mockEval.mockRejectedValue(new Error("redis down"));

    const result = await checkUserRateLimit(nextSubject(), {
      limit: 5,
      windowMs: 60_000,
      name: "test:sensitive",
      bypassL1: true,
    });

    expect(result.allowed).toBe(false);
  });

  it("fails OPEN for ordinary limiters so an outage cannot take the app down", async () => {
    mockEval.mockRejectedValue(new Error("redis down"));

    const result = await checkUserRateLimit(nextSubject(), {
      limit: 5,
      windowMs: 60_000,
      name: "test:ordinary",
      skipThreshold: 0,
    });

    expect(result.allowed).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  it("throws a 429 ApiError once the limit is exceeded", async () => {
    mockEval.mockResolvedValue(denyReply());

    await expect(
      enforceRateLimit(nextSubject(), "user", {
        limit: 1,
        windowMs: 60_000,
        name: "test:enforce",
        bypassL1: true,
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("applies the global cap after the per-subject check", async () => {
    // First call = per-user check (allowed), second = global cap (denied).
    mockEval.mockResolvedValueOnce(allowReply()).mockResolvedValueOnce(denyReply());

    await expect(
      enforceRateLimit(nextSubject(), "user", {
        limit: 100,
        windowMs: 60_000,
        name: "test:global",
        globalLimit: 10,
        bypassL1: true,
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockEval).toHaveBeenCalledTimes(2);
  });
});

describe("preset tiering", () => {
  it("keeps the highest-volume read limiter off Redis", () => {
    expect(RATE_LIMITS.apiRead.tier).toBe("local");
  });

  it.each([
    ["auth", RATE_LIMITS.auth],
    ["login", RATE_LIMITS.login],
    ["register", RATE_LIMITS.register],
    ["pinVerify", RATE_LIMITS.pinVerify],
    ["payoutRequest", RATE_LIMITS.payoutRequest],
    ["coinPurchase", RATE_LIMITS.coinPurchase],
    ["giftSend", RATE_LIMITS.giftSend],
    ["starGift", RATE_LIMITS.starGift],
    ["contactsLookup", RATE_LIMITS.contactsLookup],
  ])("keeps %s exact and Redis-backed", (_name, preset) => {
    expect(preset.tier).not.toBe("local");
    // Security-critical presets must also bypass the in-process skip cache, or
    // a warm instance could allow a burst before Redis is ever consulted.
    expect(preset.bypassL1).toBe(true);
  });
});
