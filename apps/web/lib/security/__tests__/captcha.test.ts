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
const mockDbQuery = jest.fn();

jest.mock("@/lib/redis", () => ({
  redis: { get: (k: string) => mockRedisGet(k) },
}));

jest.mock("@/lib/db", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { getManifestValue } from "@/lib/manifest";
import { getCaptchaProvider } from "@/lib/security/captcha";

/** Make getManifestValue read from the DB by forcing a Redis cache miss. */
function seedDbValue(value: string | null) {
  mockRedisGet.mockResolvedValue(null);
  mockDbQuery.mockResolvedValue({ rows: value === null ? [] : [{ value }] });
}

describe("getManifestValue — JSON-quote normalization", () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockDbQuery.mockReset();
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
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe("getCaptchaProvider — resolves through the normalized read", () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockDbQuery.mockReset();
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
