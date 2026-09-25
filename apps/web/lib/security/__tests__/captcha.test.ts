/**
 * Unit tests for manifest value normalization + CAPTCHA provider resolution.
 *
 * Regression coverage for the production incident where the x_manifest
 * `captcha_provider` row was stored JSON-encoded (the literal `"turnstile"`,
 * quotes included). Application code compared it against the bare string
 * `"turnstile"`, never matched, logged "Unknown provider value" and fell back to
 * the last-known-good provider. On `/api/auth/google` this surfaced as a
 * spurious "CAPTCHA required" / unexpected error, and the admin "captcha off"
 * (`none`) toggle became a no-op because the stored `"none"` never matched the
 * `none` branch.
 *
 * getManifestValue() now strips surrounding JSON quotes on read, so callers
 * (including resolveProvider in captcha.ts) see the bare value regardless of
 * whether the row was seeded quoted (legacy) or bare (canonical).
 */

const mockRedisGet = jest.fn<Promise<string | null>, [string]>();

jest.mock("@/lib/redis", () => ({
  redis: {
    get: (k: string) => mockRedisGet(k),
    // invalidateManifestCache() deletes the KV key; the tests below call it to
    // reset the in-process manifest caches between cases.
    del: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// ---------------------------------------------------------------------------
// lib/manifest's DB fallback (getManifestValue) reads via Drizzle's getDb()
// instead of the raw `@/lib/db` adapter. Back a real `drizzle-orm/node-postgres`
// instance with a fake pg-shaped client so the real query compiles exactly like
// production, landing on `mockQuery` as plain SQL text + params (see
// lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
// ---------------------------------------------------------------------------

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/drizzle";

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === "string" ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

import { getManifestValue, invalidateManifestCache } from "@/lib/manifest";
import { getCaptchaProvider } from "@/lib/security/captcha";

/**
 * Make getManifestValue read from the DB by forcing a Redis cache miss.
 * getManifestValue's fallback select only projects the `value` column, so
 * Drizzle's node-postgres driver returns each row in array ("positional")
 * mode — a single-element array, not `{ value }`.
 */
function seedDbValue(value: string | null) {
  mockRedisGet.mockResolvedValue(null);
  mockQuery.mockResolvedValue({ rows: value === null ? [] : [[value]], rowCount: value === null ? 0 : 1 });
}

/**
 * REDIS-COST-01 added an in-process cache of the raw manifest KV map, so a warm
 * instance answers getManifestValue() without touching Redis at all. That
 * cache is module-level and therefore shared between test cases — clear it in
 * beforeEach so each case genuinely exercises the path it is asserting on,
 * rather than a value a previous case happened to warm.
 */
async function resetManifestCaches() {
  await invalidateManifestCache();
}

describe("getManifestValue — JSON-quote normalization", () => {
  beforeEach(async () => {
    mockRedisGet.mockReset();
    mockQuery.mockReset();
    await resetManifestCaches();
  });

  it("strips surrounding quotes from a legacy quoted value (the prod bug)", async () => {
    seedDbValue('"turnstile"');
    await expect(getManifestValue("captcha_provider")).resolves.toBe("turnstile");
  });

  it("returns a bare value unchanged", async () => {
    seedDbValue("turnstile");
    await expect(getManifestValue("captcha_provider")).resolves.toBe("turnstile");
  });

  it("normalizes a quoted empty string to ''", async () => {
    seedDbValue('""');
    await expect(getManifestValue("admob_app_id")).resolves.toBe("");
  });

  it("leaves boolean rows ('true') untouched", async () => {
    seedDbValue("true");
    await expect(getManifestValue("auth_2fa_enabled")).resolves.toBe("true");
  });

  it("returns null for a missing key", async () => {
    seedDbValue(null);
    await expect(getManifestValue("does_not_exist")).resolves.toBeNull();
  });

  it("reads (and unquotes) from the Redis KV cache when present", async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ captcha_provider: '"none"' }));
    await expect(getManifestValue("captcha_provider")).resolves.toBe("none");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("getCaptchaProvider — resolves through the normalized read", () => {
  beforeEach(async () => {
    mockRedisGet.mockReset();
    mockQuery.mockReset();
    await resetManifestCaches();
  });

  it("honours a legacy quoted '\"none\"' so the admin captcha-off toggle works", async () => {
    seedDbValue('"none"');
    await expect(getCaptchaProvider()).resolves.toBe("none");
  });

  it("resolves a legacy quoted '\"turnstile\"' value", async () => {
    seedDbValue('"turnstile"');
    await expect(getCaptchaProvider()).resolves.toBe("turnstile");
  });

  it("resolves a bare 'recaptcha' value", async () => {
    seedDbValue("recaptcha");
    await expect(getCaptchaProvider()).resolves.toBe("recaptcha");
  });
});
