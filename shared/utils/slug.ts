/**
 * shared/utils/slug.ts
 *
 * Pure, dependency-free slug helpers shared by the web app, the Expo app and
 * the PWA. The functions here are deterministic string transforms only — they
 * never touch the database. Uniqueness (the numeric suffix dedupe) is enforced
 * server-side in apps/web/lib/slug.ts which calls `slugify` then probes the DB.
 *
 * Public URL scheme (see ZobiaSocial URL spec):
 *   /u/<username>        — public profile
 *   /r/<room-slug>       — public room
 *   /c/<course-slug>     — classroom / course
 *   /g/<game-slug>       — game
 *
 * Internal UUIDs remain the immutable primary keys / foreign keys. Slugs are a
 * mutable, human-facing alias that resolves to a UUID.
 */

/** Maximum length of a generated slug (keeps URLs short and index-friendly). */
export const MAX_SLUG_LENGTH = 60;

/**
 * Convert an arbitrary display name into a URL-safe slug.
 *
 *   "Dorcas' Cuisine!"      -> "dorcas-cuisine"
 *   "  Make Money Online  " -> "make-money-online"
 *   "Tap On Tap"            -> "tap-on-tap"
 *
 * Rules:
 *   - lowercased
 *   - accents/diacritics stripped (José -> jose)
 *   - every run of non-alphanumeric characters collapses to a single hyphen
 *   - leading/trailing hyphens removed
 *   - truncated to MAX_SLUG_LENGTH (without leaving a trailing hyphen)
 *
 * Returns "" when the input has no usable characters; callers should fall back
 * to a stable identifier (e.g. a short id) in that case.
 */
export function slugify(input: string): string {
  if (!input) return "";

  const normalised = input
    // Decompose accents (é -> e + ́ ) then drop the combining marks.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    // Replace any run of characters that are not a-z or 0-9 with a hyphen.
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse repeated hyphens and trim them from both ends.
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalised.length <= MAX_SLUG_LENGTH) return normalised;

  return normalised.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}

/**
 * Append the deduplication index to a base slug.
 *
 * The first room keeps the bare slug; duplicates get a trailing number with no
 * separator, matching the product spec:
 *
 *   withSuffix("dorcas-cuisine", 1) -> "dorcas-cuisine"
 *   withSuffix("dorcas-cuisine", 2) -> "dorcas-cuisine2"
 *   withSuffix("dorcas-cuisine", 3) -> "dorcas-cuisine3"
 */
export function withSuffix(base: string, index: number): string {
  return index <= 1 ? base : `${base}${index}`;
}

/** True when a string is a syntactically valid slug (a-z, 0-9, single hyphens). */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= MAX_SLUG_LENGTH;
}

/**
 * RFC 4122 UUID matcher. Used to tell legacy `/r/<uuid>` links apart from the
 * new `/r/<slug>` links so the old links can 301-redirect to their slug.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value);
}
