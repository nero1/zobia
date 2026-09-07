/**
 * lib/auth/__tests__/gate44SupportAccess.test.ts
 *
 * Regression test for the JWT `is_support` claim gap: a plain `is_support`
 * staff member (not `is_admin`, not `is_moderator`) must be able to pass the
 * /gate44/support/queue and /gate44/support/tickets/:id edge pre-filter,
 * while a regular user with no staff flags must still be redirected away.
 *
 * Exercises the actual exported decision function from middleware.ts
 * (isAllowedGate44Route) rather than re-implementing the logic, so this test
 * fails if the real gate regresses.
 */

import { isAllowedGate44Route } from "@/middleware";

describe("isAllowedGate44Route — /gate44/support/* staff gate", () => {
  it("allows a plain is_support user (not admin, not moderator) into the queue", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: true, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/queue")).toBe(true);
  });

  it("allows a plain is_support user into a ticket thread page", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: true, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/tickets/abc-123")).toBe(true);
  });

  it("allows is_senior_support alone (without is_support/is_moderator/is_admin) into the queue", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: false, is_senior_support: true };
    expect(isAllowedGate44Route(payload, "/gate44/support/queue")).toBe(true);
  });

  it("still allows moderator into the support queue (pre-existing behavior preserved)", () => {
    const payload = { is_admin: false, is_moderator: true, is_support: false, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/queue")).toBe(true);
  });

  it("still allows admin into the support queue (pre-existing behavior preserved)", () => {
    const payload = { is_admin: true, is_moderator: false, is_support: false, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/queue")).toBe(true);
  });

  it("rejects a regular user with no staff flags", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: false, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/queue")).toBe(false);
  });

  it("does NOT let a plain is_support user through admin-only /gate44/support/settings", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: true, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/support/settings")).toBe(false);
  });

  it("does NOT let is_support alone into an unrelated admin-only page", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: true, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/users")).toBe(false);
  });

  it("is_support alone does not grant the moderator-scoped forum routes", () => {
    const payload = { is_admin: false, is_moderator: false, is_support: true, is_senior_support: false };
    expect(isAllowedGate44Route(payload, "/gate44/forum/queue")).toBe(false);
  });
});
