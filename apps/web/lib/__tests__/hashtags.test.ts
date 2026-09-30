import {
  extractHashtags,
  extractHashtagsFrom,
  normaliseHashtag,
  splitHashtags,
  portalPath,
  portalSlugFromHash,
  HASHTAG_MAX_PER_CONTENT,
  activeHashtagQuery,
  applyHashtagSuggestion,
} from "@zobia/shared/utils";

describe("hashtags", () => {
  it("extracts and normalises tags, de-duplicated in first-seen order", () => {
    expect(extractHashtags("Loving #Lagos and #UNIBEN! #lagos again")).toEqual(["lagos", "uniben"]);
  });

  it("folds diacritics", () => {
    expect(normaliseHashtag("#Ọ̀ṣun")).toBe("osun");
    expect(extractHashtags("Visit #Café today")).toEqual(["cafe"]);
  });

  it("ignores headings, digits-only, mid-word, entities and URL fragments", () => {
    expect(extractHashtags("# Heading\n#1 place a#b &#39; https://x.com/#frag ##double")).toEqual([]);
  });

  it("supports underscores and trailing punctuation", () => {
    expect(extractHashtags("(#edo_food), #detroit.")).toEqual(["edo_food", "detroit"]);
  });

  it("rejects too-short and too-long tags", () => {
    expect(extractHashtags("#a")).toEqual([]);
    expect(extractHashtags("#" + "x".repeat(51))).toEqual([]);
  });

  it("caps distinct tags per content", () => {
    const text = Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ");
    expect(extractHashtags(text)).toHaveLength(HASHTAG_MAX_PER_CONTENT);
  });

  it("combines several fields and skips nullish", () => {
    expect(extractHashtagsFrom("#a1", null, undefined, "#b2")).toEqual(["a1", "b2"]);
  });

  it("splits into text and hashtag segments that re-join to the source", () => {
    const src = "Hi #Lagos, meet #uniben";
    const segs = splitHashtags(src);
    expect(segs.map((s) => s.value).join("")).toBe(src);
    expect(segs.filter((s) => s.type === "hashtag").map((s) => (s as { slug: string }).slug)).toEqual(["lagos", "uniben"]);
  });

  it("builds portal paths and parses vanity hashes", () => {
    expect(portalPath("edo")).toBe("/h/edo");
    expect(portalSlugFromHash("#/Edo")).toBe("edo");
    expect(portalSlugFromHash("#/edo/")).toBe("edo");
    expect(portalSlugFromHash("#section")).toBe("section");
    expect(portalSlugFromHash("#/a/b")).toBeNull();
    expect(portalSlugFromHash("")).toBeNull();
  });

  it("finds the hashtag fragment being typed at the end of the text", () => {
    expect(activeHashtagQuery("hi #la")).toBe("la");
    expect(activeHashtagQuery("#")).toBe("");
    expect(activeHashtagQuery("hi #la ")).toBeNull();
    expect(activeHashtagQuery("a#b")).toBeNull();
    expect(activeHashtagQuery("site.com/#frag")).toBeNull();
    expect(activeHashtagQuery("")).toBeNull();
  });

  it("applies a suggestion over the typed fragment", () => {
    expect(applyHashtagSuggestion("hi #la", "lagos")).toBe("hi #lagos ");
    expect(applyHashtagSuggestion("#", "edo")).toBe("#edo ");
    expect(applyHashtagSuggestion("no tag here", "edo")).toBe("no tag here");
  });
});
