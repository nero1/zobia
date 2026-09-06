/**
 * Unit tests for the Support Ticket System escalation permission rules
 * (lib/support/service.ts#canEscalate) — a pure function, no DB mocking
 * required.
 */

import { canEscalate } from "@/lib/support/service";
import type { StaffRoles } from "@/lib/auth/roles";

const staffRoles = ["support", "moderator", "admin"];

function roles(overrides: Partial<StaffRoles>): StaffRoles {
  return { isAdmin: false, isModerator: false, isSupport: false, isSeniorSupport: false, ...overrides };
}

describe("canEscalate", () => {
  it("rejects an actor with no staff role", () => {
    const decision = canEscalate(roles({}), roles({ isSupport: true }), staffRoles);
    expect(decision.allowed).toBe(false);
  });

  it("rejects escalating to a non-staff target", () => {
    const decision = canEscalate(roles({ isSupport: true }), roles({}), staffRoles);
    expect(decision.allowed).toBe(false);
  });

  it("plain support can escalate to senior support", () => {
    const decision = canEscalate(roles({ isSupport: true }), roles({ isSupport: true, isSeniorSupport: true }), staffRoles);
    expect(decision.allowed).toBe(true);
  });

  it("plain support can escalate directly to an admin", () => {
    const decision = canEscalate(roles({ isSupport: true }), roles({ isAdmin: true }), staffRoles);
    expect(decision.allowed).toBe(true);
  });

  it("plain support CANNOT escalate to another plain support member", () => {
    const decision = canEscalate(roles({ isSupport: true }), roles({ isSupport: true }), staffRoles);
    expect(decision.allowed).toBe(false);
  });

  it("senior support (non-admin, non-moderator) can escalate further only to an admin", () => {
    const senior = roles({ isSupport: true, isSeniorSupport: true });
    expect(canEscalate(senior, roles({ isAdmin: true }), staffRoles).allowed).toBe(true);
    expect(canEscalate(senior, roles({ isSupport: true, isSeniorSupport: true }), staffRoles).allowed).toBe(false);
    expect(canEscalate(senior, roles({ isSupport: true }), staffRoles).allowed).toBe(false);
  });

  it("moderators can escalate to any eligible staff member", () => {
    const mod = roles({ isModerator: true });
    expect(canEscalate(mod, roles({ isSupport: true }), staffRoles).allowed).toBe(true);
    expect(canEscalate(mod, roles({ isAdmin: true }), staffRoles).allowed).toBe(true);
  });

  it("admins can escalate to anyone eligible", () => {
    const admin = roles({ isAdmin: true });
    expect(canEscalate(admin, roles({ isSupport: true }), staffRoles).allowed).toBe(true);
  });

  it("honors a narrower staffRoles allow-list (e.g. moderator support disabled)", () => {
    const narrowRoles = ["moderator", "admin"];
    const decision = canEscalate(roles({ isSupport: true }), roles({ isAdmin: true }), narrowRoles);
    // Actor holds only 'support', which isn't in the allow-list.
    expect(decision.allowed).toBe(false);
  });
});
