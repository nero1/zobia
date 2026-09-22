/**
 * Unit tests for the pure parts of the classroom sub-system: level curve,
 * badges, settings parsing, slug policy evaluation/validation, and the
 * role → capability matrix that every classroom API route relies on.
 */

// sanitize-html ships ESM that ts-jest doesn't transform; content sanitizing is
// covered by the security suite — here we only care about visibility rules.
jest.mock("@/lib/security/htmlSanitizer", () => ({ sanitizeBlogPostHtml: (s: string) => `<p>${s}</p>` }));

import { badgesForSignals, levelForPoints, levelProgress, CLASSROOM_LEVEL_THRESHOLDS } from "@/lib/classroom/levels";
import { mergeClassroomSettings, parseClassroomSettings, levelName, DEFAULT_SLUG_POLICY } from "@/lib/classroom/settings";
import { evaluateSlugPolicy, validateSlugShape } from "@/lib/classroom/slug";
import { resolveViewer } from "@/lib/classroom/access";
import { resolveClassroomStatsTier } from "@/lib/classroom/limits";
import { viewModules, parseModules } from "@/lib/classroom/curriculum";

describe("classroom levels", () => {
  it("maps points onto the 9-level ladder", () => {
    expect(levelForPoints(0)).toBe(1);
    expect(levelForPoints(4)).toBe(1);
    expect(levelForPoints(5)).toBe(2);
    expect(levelForPoints(CLASSROOM_LEVEL_THRESHOLDS[8])).toBe(9);
    expect(levelForPoints(10_000_000)).toBe(9);
  });

  it("reports progress to the next level", () => {
    const p = levelProgress(10);
    expect(p.level).toBe(2);
    expect(p.pointsToNextLevel).toBe(10);
    expect(p.percent).toBe(33);
    expect(levelProgress(40_000).pointsToNextLevel).toBeNull();
  });

  it("derives badges from signals", () => {
    expect(badgesForSignals({ postCount: 1, likesReceived: 10, level: 5 })).toEqual(
      expect.arrayContaining(["first_post", "helpful", "rising_star"])
    );
    expect(badgesForSignals({})).toEqual([]);
  });
});

describe("classroom settings", () => {
  it("fills defaults for an empty/legacy value", () => {
    const s = parseClassroomSettings({});
    expect(s.slugPolicy).toEqual(DEFAULT_SLUG_POLICY);
    expect(s.postingPolicy).toBe("members");
    expect(s.levelNames).toHaveLength(9);
    expect(levelName(s, 1)).toBe("Newcomer");
  });

  it("keeps valid sections when another is malformed", () => {
    const s = parseClassroomSettings({ slugPolicy: { mode: "bogus" }, postingPolicy: "moderators" });
    expect(s.slugPolicy).toEqual(DEFAULT_SLUG_POLICY);
    expect(s.postingPolicy).toBe("moderators");
  });

  it("merges a partial patch", () => {
    const merged = mergeClassroomSettings(parseClassroomSettings({}), { slugPolicy: { mode: "free" }, moderatorPermissions: { manageEvents: false } });
    expect(merged.slugPolicy.mode).toBe("free");
    expect(merged.slugPolicy.costCredits).toBe(500);
    expect(merged.moderatorPermissions.manageEvents).toBe(false);
    expect(merged.moderatorPermissions.managePosts).toBe(true);
  });
});

describe("slug policy", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("first change free, then the configured cost", () => {
    expect(evaluateSlugPolicy(DEFAULT_SLUG_POLICY, { changesMade: 0, lastChangedAt: null }, now).costCredits).toBe(0);
    expect(evaluateSlugPolicy(DEFAULT_SLUG_POLICY, { changesMade: 1, lastChangedAt: now }, now).costCredits).toBe(500);
  });

  it("enforces a cooldown", () => {
    const policy = { ...DEFAULT_SLUG_POLICY, cooldownUnit: "months" as const, cooldownValue: 2 };
    const q = evaluateSlugPolicy(policy, { changesMade: 1, lastChangedAt: new Date("2026-05-01T00:00:00Z") }, now);
    expect(q.eligible).toBe(false);
    expect(q.nextEligibleAt).toBe("2026-07-01T00:00:00.000Z");
    const later = evaluateSlugPolicy(policy, { changesMade: 1, lastChangedAt: new Date("2026-03-01T00:00:00Z") }, now);
    expect(later.eligible).toBe(true);
  });

  it("free mode is always free and uncapped", () => {
    const q = evaluateSlugPolicy({ ...DEFAULT_SLUG_POLICY, mode: "free", cooldownUnit: "days" }, { changesMade: 50, lastChangedAt: now }, now);
    expect(q).toMatchObject({ eligible: true, costCredits: 0, freeChangesRemaining: null });
  });

  it("validates slug shape", () => {
    expect(validateSlugShape("good-slug")).toBeNull();
    expect(validateSlugShape("ab")).toBe("too_short");
    expect(validateSlugShape("studio")).toBe("reserved");
    expect(validateSlugShape("Bad Slug")).toBe("invalid");
  });
});

describe("classroom role resolution", () => {
  const settings = parseClassroomSettings({ moderatorPermissions: { manageEvents: false } });
  const classroom = { creatorId: "c", settings, isActive: true };
  const base = { enrolled: false, moderator: false, staff: false, mutedUntil: null };

  it("visitor sees nothing member-only", () => {
    const v = resolveViewer(classroom, { ...base, userId: "x" });
    expect(v.role).toBe("visitor");
    expect(v.can.viewMemberContent).toBe(false);
    expect(v.can.like).toBe(false);
  });

  it("member can post/like/report but not moderate", () => {
    const v = resolveViewer(classroom, { ...base, userId: "m", enrolled: true });
    expect(v.can).toMatchObject({ createPost: true, like: true, report: true, managePosts: false, manageClassroom: false });
  });

  it("muted member cannot post or comment", () => {
    const v = resolveViewer(classroom, { ...base, userId: "m", enrolled: true, mutedUntil: new Date(Date.now() + 3600e3).toISOString() });
    expect(v.can.createPost).toBe(false);
    expect(v.can.comment).toBe(false);
  });

  it("moderator gets only the permissions the creator enabled", () => {
    const v = resolveViewer(classroom, { ...base, userId: "mod", enrolled: true, moderator: true });
    expect(v.can).toMatchObject({ managePosts: true, manageEvents: false, manageClassroom: false });
  });

  it("creator and staff manage the classroom", () => {
    expect(resolveViewer(classroom, { ...base, userId: "c" }).can.manageClassroom).toBe(true);
    expect(resolveViewer(classroom, { ...base, userId: "s", staff: true }).can.manageClassroom).toBe(true);
  });

  it("archived classrooms are read-only", () => {
    const v = resolveViewer({ ...classroom, isActive: false }, { ...base, userId: "m", enrolled: true });
    expect(v.can.createPost).toBe(false);
    expect(v.can.viewMemberContent).toBe(true);
  });
});

describe("stats tier + lesson visibility", () => {
  it("takes the higher of plan and creator tier", () => {
    expect(resolveClassroomStatsTier("free", "rookie")).toBe("basic");
    expect(resolveClassroomStatsTier("plus", "rookie")).toBe("more");
    expect(resolveClassroomStatsTier("free", "verified")).toBe("detailed");
  });

  it("never leaks lesson content to visitors or under-levelled members", () => {
    const modules = parseModules({ modules: [{ id: "a", title: "A", content: "secret" }, { id: "b", title: "B", content: "x", unlockLevel: 3 }] });
    const visitor = viewModules(modules, { fullAccess: false, memberLevel: null });
    expect(visitor.every((m) => m.locked && !m.content)).toBe(true);
    const member = viewModules(modules, { fullAccess: false, memberLevel: 1 });
    expect(member[0]!.content).toBe("secret");
    expect(member[1]!.locked).toBe(true);
    expect(member[1]!.content).toBeUndefined();
  });
});
