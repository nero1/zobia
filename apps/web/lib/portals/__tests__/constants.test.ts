import {
  DEFAULT_PORTAL_SECTIONS,
  PORTAL_SECTION_KEYS,
  RESERVED_PORTAL_SLUGS,
  isBoostActive,
  isSponsorshipActive,
  normalizeSections,
  titleFromSlug,
} from "../constants";

describe("normalizeSections", () => {
  it("returns every section enabled by default", () => {
    expect(normalizeSections(undefined)).toEqual(DEFAULT_PORTAL_SECTIONS);
    expect(normalizeSections("nope")).toEqual(DEFAULT_PORTAL_SECTIONS);
  });

  it("keeps the submitted order and enabled flags, appends missing sections", () => {
    const out = normalizeSections([
      { key: "people", enabled: false },
      { key: "feed", enabled: true },
    ]);
    expect(out[0]).toEqual({ key: "people", enabled: false });
    expect(out[1]).toEqual({ key: "feed", enabled: true });
    expect(out.map((s) => s.key).sort()).toEqual([...PORTAL_SECTION_KEYS].sort());
    expect(out.slice(2).every((s) => s.enabled)).toBe(true);
  });

  it("drops unknown keys, duplicates and malformed entries", () => {
    const out = normalizeSections([{ key: "bogus", enabled: true }, { key: "feed" }, { key: "feed", enabled: false }, null, 5]);
    expect(out.filter((s) => s.key === "feed")).toHaveLength(1);
    expect(out.find((s) => s.key === "feed")?.enabled).toBe(true);
    expect(out.some((s) => (s.key as string) === "bogus")).toBe(false);
  });
});

describe("titleFromSlug", () => {
  it("title-cases underscore separated slugs", () => {
    expect(titleFromSlug("edo_food")).toBe("Edo Food");
    expect(titleFromSlug("lagos")).toBe("Lagos");
  });
});

describe("reserved slugs", () => {
  it("blocks system words", () => {
    expect(RESERVED_PORTAL_SLUGS.has("gate44")).toBe(true);
    expect(RESERVED_PORTAL_SLUGS.has("lagos")).toBe(false);
  });
});

describe("boost and sponsorship windows", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  it("is inactive at weight 0", () => {
    expect(isBoostActive({ boostWeight: 0, boostStartsAt: null, boostEndsAt: null }, now)).toBe(false);
  });
  it("is open-ended when bounds are null", () => {
    expect(isBoostActive({ boostWeight: 40, boostStartsAt: null, boostEndsAt: null }, now)).toBe(true);
  });
  it("respects start and end", () => {
    expect(isBoostActive({ boostWeight: 40, boostStartsAt: "2026-10-01T00:00:00Z", boostEndsAt: null }, now)).toBe(false);
    expect(isBoostActive({ boostWeight: 40, boostStartsAt: null, boostEndsAt: "2026-09-29T00:00:00Z" }, now)).toBe(false);
    expect(isBoostActive({ boostWeight: 40, boostStartsAt: "2026-09-01T00:00:00Z", boostEndsAt: "2026-10-31T00:00:00Z" }, now)).toBe(true);
  });
  it("sponsorship is active only before its end", () => {
    expect(isSponsorshipActive(null, now)).toBe(false);
    expect(isSponsorshipActive("2026-09-01T00:00:00Z", now)).toBe(false);
    expect(isSponsorshipActive("2026-12-01T00:00:00Z", now)).toBe(true);
  });
});
