/**
 * Tests for the session-verification policy introduced by REDIS-COST-01.
 *
 * `withAuth` no longer reads `session:<sid>` and `user:status:<uid>` from Redis
 * on every authenticated request. It trusts the short-lived signed access token
 * on ordinary routes and performs live Redis + database verification only where
 * acting on a stale credential could be materially harmful.
 *
 * That trade is only safe if the "sensitive" classification is right, so these
 * tests pin it explicitly: every money-moving and privilege-granting surface
 * must be verified, and the high-volume read surfaces must not be. A regression
 * here is a security regression, not a performance one.
 */

import { requiresLiveVerification } from "@/lib/api/middleware";

/** Minimal stand-in for the NextRequest fields the policy actually reads. */
function req(method: string) {
  return { method } as unknown as Parameters<typeof requiresLiveVerification>[0];
}

describe("requiresLiveVerification — sensitive surfaces", () => {
  const sensitiveMutations: Array<[string, string]> = [
    ["POST", "/api/economy/coins/transfer"],
    ["POST", "/api/economy/coins/purchase"],
    ["POST", "/api/economy/stars/purchase"],
    ["POST", "/api/economy/stars/gift"],
    ["POST", "/api/economy/gifts/send"],
    ["POST", "/api/payouts/request"],
    ["POST", "/api/payments/initiate"],
    ["POST", "/api/kyc/submit"],
    ["POST", "/api/auth/2fa/disable"],
    ["POST", "/api/auth/pin/verify"],
    ["POST", "/api/creator/bank-account"],
    ["DELETE", "/api/auth/sessions"],
    ["PATCH", "/api/payouts/request"],
  ];

  it.each(sensitiveMutations)(
    "verifies %s %s against live session + account state",
    (method, path) => {
      expect(requiresLiveVerification(req(method), path)).toBe(true);
    }
  );

  it("verifies GET /api/auth/sessions because the response is itself security state", () => {
    expect(requiresLiveVerification(req("GET"), "/api/auth/sessions")).toBe(true);
  });
});

describe("requiresLiveVerification — ordinary surfaces", () => {
  const ordinaryRequests: Array<[string, string]> = [
    ["GET", "/api/feed"],
    ["GET", "/api/rooms"],
    ["GET", "/api/leaderboards"],
    ["GET", "/api/notifications"],
    ["GET", "/api/users/me"],
    ["GET", "/api/messages/dm/abc"],
    ["POST", "/api/tweets"],
    ["POST", "/api/forum/questions"],
    ["POST", "/api/presence"],
    ["POST", "/api/blogs/my-blog/posts"],
  ];

  it.each(ordinaryRequests)(
    "trusts the signed access token for %s %s",
    (method, path) => {
      expect(requiresLiveVerification(req(method), path)).toBe(false);
    }
  );

  it("does not verify reads of sensitive surfaces — reading is not escalation", () => {
    // A GET of payout history is authorised by the same token that was
    // authorised moments ago; only state CHANGES need live confirmation.
    expect(requiresLiveVerification(req("GET"), "/api/payouts/history")).toBe(false);
    expect(requiresLiveVerification(req("HEAD"), "/api/payments/status")).toBe(false);
  });
});
