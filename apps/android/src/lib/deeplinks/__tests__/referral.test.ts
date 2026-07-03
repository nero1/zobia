/**
 * apps/android/src/lib/deeplinks/__tests__/referral.test.ts
 *
 * ZB-AND-10 baseline test: round-trips captureReferralFromUrl ->
 * getPendingReferralCode -> clearPendingReferralCode. This is the module
 * ZB-AND-02 found completely unmounted (its exports were only ever
 * referenced by the file that defines them) — a render-level test asserting
 * useReferralCaptureFromLink() is actually mounted at the app root would
 * have caught that class of bug; this covers the underlying storage logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn(async () => ({ remove: () => {} })) },
}));

import { captureReferralFromUrl, getPendingReferralCode, clearPendingReferralCode } from "../referral";

describe("referral deep-link capture", () => {
  beforeEach(() => {
    store.clear();
  });

  it("captures a valid ?r= code from a zobia:// deep link", async () => {
    captureReferralFromUrl("zobia://home?r=ABC123XYZ");
    await expect(getPendingReferralCode()).resolves.toBe("ABC123XYZ");
  });

  it("captures a valid ?r= code from a verified https App Link", async () => {
    captureReferralFromUrl("https://zobia.org/u/joe?r=74392");
    await expect(getPendingReferralCode()).resolves.toBe("74392");
  });

  it("ignores a URL with no ?r= param", async () => {
    captureReferralFromUrl("zobia://home");
    await expect(getPendingReferralCode()).resolves.toBeNull();
  });

  it("ignores an invalid/oversized code", async () => {
    captureReferralFromUrl(`zobia://home?r=${"x".repeat(50)}`);
    await expect(getPendingReferralCode()).resolves.toBeNull();
  });

  it("ignores a malformed URL instead of throwing", () => {
    expect(() => captureReferralFromUrl("not a url")).not.toThrow();
  });

  it("clearPendingReferralCode removes the stored code", async () => {
    captureReferralFromUrl("zobia://home?r=ABC123XYZ");
    await expect(getPendingReferralCode()).resolves.toBe("ABC123XYZ");
    await clearPendingReferralCode();
    await expect(getPendingReferralCode()).resolves.toBeNull();
  });
});
