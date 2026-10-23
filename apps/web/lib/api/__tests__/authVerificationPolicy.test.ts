/** Revoked sessions must not read private data or perform mutations. */

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
    ["POST", "/api/economy/iap/verify"],
    ["POST", "/api/economy/subscriptions"],
    ["PUT", "/api/economy/subscriptions/example"],
    ["DELETE", "/api/economy/subscriptions/example"],
    ["POST", "/api/economy/crypto/confirm"],
    ["POST", "/api/business"],
    ["POST", "/api/business/iap/verify"],
    ["PATCH", "/api/business/tier"],
    ["POST", "/api/accounts/select"],
    ["POST", "/api/kyc/submit"],
    ["POST", "/api/auth/2fa/disable"],
    ["POST", "/api/auth/pin/verify"],
    ["POST", "/api/auth/pin/reset"],
    ["POST", "/api/auth/pin/setup"],
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
    "verifies revocation for %s %s",
    (method, path) => {
      expect(requiresLiveVerification(req(method), path)).toBe(true);
    }
  );

  it("verifies sensitive reads and HEAD requests", () => {
    expect(requiresLiveVerification(req("GET"), "/api/payouts/history")).toBe(true);
    expect(requiresLiveVerification(req("HEAD"), "/api/payments/status")).toBe(true);
  });
});
