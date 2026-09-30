/**
 * Unit tests for the shared PIN failed-attempt lockout (lib/auth/pinAttempts.ts).
 * A 4-digit PIN has only 10,000 combinations, so the policy (5 wrong -> 15 min
 * lock, 3 lockouts -> 24 h) and its "every PIN comparison goes through here"
 * contract are security-critical.
 */

const store = new Map<string, number>();
const ttls = new Map<string, number>();

const mockRedis = {
  ttl: jest.fn(async (k: string) => (store.has(k) ? ttls.get(k) ?? -1 : -2)),
  incr: jest.fn(async (k: string) => {
    const n = (store.get(k) ?? 0) + 1;
    store.set(k, n);
    return n;
  }),
  expire: jest.fn(async (k: string, s: number) => { ttls.set(k, s); return 1; }),
  set: jest.fn(async (k: string, _v: string, _ex: string, s: number) => { store.set(k, 1); ttls.set(k, s); return "OK"; }),
  del: jest.fn(async (...keys: string[]) => { keys.forEach((k) => { store.delete(k); ttls.delete(k); }); return keys.length; }),
};

jest.mock("@/lib/redis", () => ({ redis: mockRedis }));

let mockPinLockout: Record<string, number> = {
  maxFailedAttempts: 5, failWindowMinutes: 15, lockoutMinutes: 15,
  strikeLimit: 3, strikeWindowHours: 24, longLockoutHours: 24,
};
jest.mock("@/lib/manifest", () => ({ loadManifest: async () => ({ pinLockout: mockPinLockout }) }));

import bcrypt from "bcryptjs";
import {
  verifyPinAttempt,
  requireCorrectPin,
  assertPinNotLocked,
  resetPinLockout,
  PIN_MAX_FAILED_ATTEMPTS,
  PIN_LOCKOUT_SECONDS,
  PIN_LONG_LOCKOUT_SECONDS,
} from "@/lib/auth/pinAttempts";
import { ApiError } from "@/lib/api/errors";

const USER = "user-1";
let hash: string;

beforeAll(async () => {
  hash = await bcrypt.hash("1234", 4);
});

beforeEach(() => {
  store.clear();
  ttls.clear();
  Object.values(mockRedis).forEach((m) => m.mockClear());
});

describe("verifyPinAttempt", () => {
  it("accepts the right PIN and clears the failure counter", async () => {
    await verifyPinAttempt(USER, "0000", hash);
    expect(store.get(`pin_fail:${USER}`)).toBe(1);
    const res = await verifyPinAttempt(USER, "1234", hash);
    expect(res).toEqual({ verified: true });
    expect(store.has(`pin_fail:${USER}`)).toBe(false);
  });

  it("counts wrong PINs and reports attempts remaining", async () => {
    const res = await verifyPinAttempt(USER, "0000", hash);
    expect(res).toEqual({ verified: false, attemptsRemaining: PIN_MAX_FAILED_ATTEMPTS - 1 });
    // the window TTL is set on the first failure only
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });

  it("locks after the maximum number of wrong PINs and rejects even the right PIN while locked", async () => {
    for (let i = 0; i < PIN_MAX_FAILED_ATTEMPTS - 1; i++) await verifyPinAttempt(USER, "0000", hash);
    await expect(verifyPinAttempt(USER, "0000", hash)).rejects.toMatchObject({ status: 429, code: "PIN_LOCKED" });
    expect(ttls.get(`pin_lock:${USER}`)).toBe(PIN_LOCKOUT_SECONDS);
    await expect(verifyPinAttempt(USER, "1234", hash)).rejects.toMatchObject({ status: 429, code: "PIN_LOCKED" });
  });

  it("escalates to a 24h lock on the third lockout", async () => {
    for (let round = 0; round < 3; round++) {
      store.delete(`pin_lock:${USER}`); // previous lock expired
      for (let i = 0; i < PIN_MAX_FAILED_ATTEMPTS; i++) {
        await verifyPinAttempt(USER, "0000", hash).catch(() => undefined);
      }
    }
    expect(ttls.get(`pin_lock:${USER}`)).toBe(PIN_LONG_LOCKOUT_SECONDS);
  });

  it("happy path costs one lock check and one counter delete", async () => {
    await verifyPinAttempt(USER, "1234", hash);
    expect(mockRedis.ttl).toHaveBeenCalledTimes(1);
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });
});

describe("requireCorrectPin", () => {
  it("throws 400 INVALID_PIN (never 401, which the client treats as an expired session)", async () => {
    const err = (await requireCorrectPin(USER, "9999", hash).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("INVALID_PIN");
    expect(err.params).toEqual({ attemptsRemaining: PIN_MAX_FAILED_ATTEMPTS - 1 });
  });

  it("resolves for the right PIN", async () => {
    await expect(requireCorrectPin(USER, "1234", hash)).resolves.toBeUndefined();
  });
});

describe("admin-configured policy", () => {
  afterEach(() => {
    mockPinLockout = { maxFailedAttempts: 5, failWindowMinutes: 15, lockoutMinutes: 15, strikeLimit: 3, strikeWindowHours: 24, longLockoutHours: 24 };
  });

  it("uses the configured attempt limit, lock length and window", async () => {
    mockPinLockout = { ...mockPinLockout, maxFailedAttempts: 2, lockoutMinutes: 30, failWindowMinutes: 5 };
    const first = await verifyPinAttempt(USER, "0000", hash);
    expect(first).toEqual({ verified: false, attemptsRemaining: 1 });
    expect(ttls.get(`pin_fail:${USER}`)).toBe(5 * 60);
    await expect(verifyPinAttempt(USER, "0000", hash)).rejects.toMatchObject({ code: "PIN_LOCKED" });
    expect(ttls.get(`pin_lock:${USER}`)).toBe(30 * 60);
  });
});

describe("lock lifecycle", () => {
  it("assertPinNotLocked passes when unlocked and throws when locked", async () => {
    await expect(assertPinNotLocked(USER)).resolves.toBeUndefined();
    store.set(`pin_lock:${USER}`, 1);
    ttls.set(`pin_lock:${USER}`, 120);
    await expect(assertPinNotLocked(USER)).rejects.toMatchObject({ status: 429, code: "PIN_LOCKED" });
  });

  it("resetPinLockout clears counters, lock and strikes", async () => {
    store.set(`pin_lock:${USER}`, 1);
    store.set(`pin_fail:${USER}`, 3);
    store.set(`pin_strikes:${USER}`, 2);
    await resetPinLockout(USER);
    expect(store.size).toBe(0);
  });
});
