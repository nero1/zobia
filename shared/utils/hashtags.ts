/**
 * shared/utils/hashtags.ts
 *
 * Pure hashtag parsing / normalisation / linkifying, shared by the web app,
 * the PWA and the Capacitor Android app so every client agrees on what a
 * `#tag` is and where it links (`/h/<slug>`, the Portal page).
 *
 *   #Lagos  #UNIBEN  #Edo_food   -> tags "lagos", "uniben", "edo_food"
 *   #1  # heading  a#b  site.com/#x  &#39;  -> NOT tags
 *
 * The server stores only the normalised slug (see lib/hashtags/service.ts);
 * clients use `splitHashtags` to render `#tag` tokens as links.
 */

export const HASHTAG_MIN_LENGTH = 2;
export const HASHTAG_MAX_LENGTH = 50;
/** Max distinct tags recorded for a single piece of content (anti-spam). */
export const HASHTAG_MAX_PER_CONTENT = 10;

/** Where a hashtag / portal lives. Leading slash, no origin. */
export const PORTAL_ROUTE_PREFIX = "/h";

/**
 * `#` not preceded by a letter/digit/underscore, `&`, `/` or another `#`
 * (rules out `a#b`, `&#39;`, URL fragments and `##x`), then 2..50 letters,
 * digits or underscores. Unicode-aware so diacritics (Yoruba, Igbo, French)
 * survive parsing; they are folded away by normaliseHashtag().
 */
const HASHTAG_SOURCE = "(?<![\\p{L}\\p{N}_&/#])#([\\p{L}\\p{N}_]{" + HASHTAG_MIN_LENGTH + "," + HASHTAG_MAX_LENGTH + "})(?![\\p{L}\\p{N}_])";

function hashtagRegex(): RegExp {
  return new RegExp(HASHTAG_SOURCE, "gu");
}

/**
 * Canonical storage form: decompose accents and drop the combining marks,
 * lowercase, strip anything that is not a letter/digit/underscore. Returns ""
 * when nothing usable is left, or when the tag is digits only (`#2024`, `#1`
 * are ordinals, not topics).
 */
export function normaliseHashtag(raw: string): string {
  const cleaned = (raw ?? "")
    .replace(/^#+/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
  if (cleaned.length < HASHTAG_MIN_LENGTH || cleaned.length > HASHTAG_MAX_LENGTH) return "";
  if (/^\p{N}+$/u.test(cleaned)) return "";
  return cleaned;
}

/** Distinct, normalised tags in first-seen order, capped at HASHTAG_MAX_PER_CONTENT. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const m of text.matchAll(hashtagRegex())) {
    const slug = normaliseHashtag(m[1]);
    if (slug) seen.add(slug);
    if (seen.size >= HASHTAG_MAX_PER_CONTENT) break;
  }
  return [...seen];
}

/** Same as extractHashtags over several text fields (title + body, etc.). */
export function extractHashtagsFrom(...texts: (string | null | undefined)[]): string[] {
  return extractHashtags(texts.filter((t): t is string => !!t).join("\n"));
}

export function portalPath(slug: string): string {
  return `${PORTAL_ROUTE_PREFIX}/${encodeURIComponent(slug)}`;
}

export type HashtagSegment =
  | { type: "text"; value: string }
  | { type: "hashtag"; value: string; slug: string };

/**
 * Split text into plain and hashtag segments so a renderer can turn the
 * hashtag ones into links without dangerouslySetInnerHTML.
 */
export function splitHashtags(text: string | null | undefined): HashtagSegment[] {
  if (!text) return [];
  const out: HashtagSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(hashtagRegex())) {
    const slug = normaliseHashtag(m[1]);
    if (!slug) continue;
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "hashtag", value: m[0], slug });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Parse a `/#/edo` style vanity hash (as typed by users) into a portal slug, or null. */
export function portalSlugFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const m = hash.match(/^#\/?([^/?#]+)\/?$/);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const slug = normaliseHashtag(decoded);
  return slug || null;
}

/**
 * The hashtag fragment being typed at the END of `text` (what a composer's
 * autocomplete should complete), without the `#`, or null when the text does
 * not currently end in a hashtag being typed (`"hi #la"` -> `"la"`, `"hi #la "`
 * -> null, `"a#b"` -> null). An empty fragment (`"hi #"`) is returned as "".
 */
export function activeHashtagQuery(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?<![\p{L}\p{N}_&/#])#([\p{L}\p{N}_]{0,50})$/u);
  return m ? m[1] : null;
}

/** Replace the hashtag fragment being typed at the end of `text` with `#slug ` (trailing space so typing continues). */
export function applyHashtagSuggestion(text: string, slug: string): string {
  return text.replace(/(?<![\p{L}\p{N}_&/#])#([\p{L}\p{N}_]{0,50})$/u, `#${slug} `);
}
