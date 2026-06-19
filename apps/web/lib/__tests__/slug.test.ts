/**
 * Unit tests for the shared slug + referral utilities.
 * These are pure functions, so they run fast with no DB/network.
 */

import {
  slugify,
  withSuffix,
  isValidSlug,
  looksLikeUuid,
  extractReferralCode,
  appendReferralCode,
  isValidReferralCode,
  buildProfileReferralUrl,
} from "@zobia/shared/utils";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Dorcas Cuisine")).toBe("dorcas-cuisine");
    expect(slugify("Make Money Online")).toBe("make-money-online");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Dorcas' Cuisine!!!")).toBe("dorcas-cuisine");
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
    expect(slugify("a___b---c")).toBe("a-b-c");
  });

  it("removes accents", () => {
    expect(slugify("Café José")).toBe("cafe-jose");
  });

  it("returns empty string for all-symbol input", () => {
    expect(slugify("🎮🎉")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const long = "a".repeat(80);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
    expect(slugify(`${"word ".repeat(20)}`).endsWith("-")).toBe(false);
  });
});

describe("withSuffix (dedupe numbering)", () => {
  it("keeps the bare slug for index 1", () => {
    expect(withSuffix("dorcas-cuisine", 1)).toBe("dorcas-cuisine");
  });
  it("appends the number with no separator for duplicates", () => {
    expect(withSuffix("dorcas-cuisine", 2)).toBe("dorcas-cuisine2");
    expect(withSuffix("dorcas-cuisine", 3)).toBe("dorcas-cuisine3");
  });
});

describe("isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("dorcas-cuisine")).toBe(true);
    expect(isValidSlug("tapontap")).toBe(true);
    expect(isValidSlug("make-money-online2")).toBe(true);
  });
  it("rejects invalid slugs", () => {
    expect(isValidSlug("Dorcas Cuisine")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("looksLikeUuid", () => {
  it("matches real UUIDs and rejects slugs", () => {
    expect(looksLikeUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
    expect(looksLikeUuid("dorcas-cuisine")).toBe(false);
  });
});

describe("referral codes", () => {
  it("validates code shape", () => {
    expect(isValidReferralCode("74392")).toBe(true);
    expect(isValidReferralCode("ABC123")).toBe(true);
    expect(isValidReferralCode("")).toBe(false);
    expect(isValidReferralCode("a".repeat(40))).toBe(false);
    expect(isValidReferralCode("has space")).toBe(false);
  });

  it("extracts from URLSearchParams", () => {
    expect(extractReferralCode(new URLSearchParams("r=74392"))).toBe("74392");
    expect(extractReferralCode(new URLSearchParams("x=1"))).toBeNull();
    expect(extractReferralCode(new URLSearchParams("r=bad code"))).toBeNull();
  });

  it("extracts from an Expo-style query record", () => {
    expect(extractReferralCode({ r: "8732623" })).toBe("8732623");
    expect(extractReferralCode({ r: ["1", "2"] })).toBe("1");
    expect(extractReferralCode({})).toBeNull();
  });

  it("appends to relative and absolute URLs", () => {
    expect(appendReferralCode("/g/tapontap", "74392")).toBe("/g/tapontap?r=74392");
    expect(appendReferralCode("https://zobia.org/u/joe?x=1", "74392")).toBe(
      "https://zobia.org/u/joe?x=1&r=74392"
    );
  });

  it("overwrites an existing r param and ignores invalid codes", () => {
    expect(appendReferralCode("/r/room?r=old", "new1")).toBe("/r/room?r=new1");
    expect(appendReferralCode("/r/room", "bad code")).toBe("/r/room");
  });

  it("builds a profile referral URL", () => {
    expect(buildProfileReferralUrl("https://zobia.org", "74392")).toBe(
      "https://zobia.org/?r=74392"
    );
    expect(buildProfileReferralUrl("https://zobia.org/", "74392")).toBe(
      "https://zobia.org/?r=74392"
    );
  });
});
