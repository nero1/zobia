/**
 * apps/web/lib/slug.ts
 *
 * Server-side slug generation with database-backed uniqueness.
 *
 * `slugify` (the pure string transform) lives in @zobia/shared/utils so the
 * web app, the PWA and the Expo app all produce identical base slugs. This
 * module adds the part that *must* run on the server: probing the database for
 * collisions and appending the numeric dedupe suffix described in the product
 * spec ("dorcas-cuisine", "dorcas-cuisine2", "dorcas-cuisine3", ...).
 *
 * The UUID primary key remains the immutable internal reference; the slug is a
 * mutable public alias. When a slug changes we record the previous value in
 * `slug_redirects` so old links 301 instead of 404.
 */

import { slugify, withSuffix, MAX_SLUG_LENGTH } from "@zobia/shared/utils";
import { db } from "@/lib/db";

/** Minimal shape of a DB client exposing a parameterised `query`. */
interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

/** Identifier types that own a slug namespace. */
export type SlugEntity = "room" | "game";

/**
 * The column + table each entity uses. Slugs are unique *within* an entity
 * namespace (a room and a game may legitimately both be "tapontap").
 */
const SLUG_SOURCES: Record<SlugEntity, { table: string }> = {
  room: { table: "rooms" },
  game: { table: "games" },
};

/**
 * Generate a slug for `name` that is unique within the entity's namespace.
 *
 * Tries the bare slug first, then "-2", "-3"… (rendered without a separator
 * per spec: "name", "name2", "name3"). A `fallbackId` (e.g. a UUID) is used
 * when the name slugifies to an empty string (all-emoji or non-Latin names),
 * guaranteeing a stable, collision-free value.
 *
 * @param entity      Which namespace to dedupe within.
 * @param name        Human display name to derive the slug from.
 * @param fallbackId  Stable id used when the name has no slug-able characters.
 * @param client      Optional transaction client (defaults to the pool).
 * @param excludeId   Row id to ignore when checking collisions (for renames).
 */
export async function generateUniqueSlug(
  entity: SlugEntity,
  name: string,
  fallbackId: string,
  client: Queryable = db,
  excludeId?: string
): Promise<string> {
  const { table } = SLUG_SOURCES[entity];

  let base = slugify(name);
  if (!base) {
    // No usable characters — derive a short stable slug from the id.
    base = `${entity}-${fallbackId.replace(/-/g, "").slice(0, 8)}`;
  }

  // Probe candidates until we find a free one. Capped to avoid pathological
  // loops; in practice collisions on the same name are rare.
  for (let i = 1; i <= 1000; i++) {
    const candidate = clampSuffixed(base, i);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${table}
       WHERE slug = $1
         AND deleted_at IS NULL
         ${excludeId ? "AND id <> $2" : ""}
       LIMIT 1`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (rows.length === 0) return candidate;
  }

  // Extremely unlikely fallback: suffix with the id for guaranteed uniqueness.
  return clampSuffixed(`${base}-${fallbackId.replace(/-/g, "").slice(0, 8)}`, 1);
}

/**
 * Apply the numeric dedupe suffix while keeping the total length within
 * MAX_SLUG_LENGTH (trimming the base, never the suffix, so the number is never
 * truncated and uniqueness is preserved).
 */
function clampSuffixed(base: string, index: number): string {
  const suffix = index <= 1 ? "" : String(index);
  const maxBase = MAX_SLUG_LENGTH - suffix.length;
  const trimmedBase =
    base.length > maxBase ? base.slice(0, maxBase).replace(/-+$/g, "") : base;
  return withSuffix(trimmedBase, index);
}

/**
 * Record that `oldSlug` previously pointed at `entityId` so future requests to
 * the old slug can 301-redirect to the current one. Safe to call when a slug
 * is reassigned during a rename. No-ops when oldSlug is falsy/unchanged.
 */
export async function recordSlugRedirect(
  entity: SlugEntity,
  oldSlug: string | null | undefined,
  entityId: string,
  newSlug: string,
  client: Queryable = db
): Promise<void> {
  if (!oldSlug || oldSlug === newSlug) return;
  await client.query(
    `INSERT INTO slug_redirects (entity_type, old_slug, entity_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (entity_type, old_slug) DO UPDATE
       SET entity_id = EXCLUDED.entity_id, created_at = NOW()`,
    [entity, oldSlug, entityId]
  );
}

/**
 * Look up the current slug an old slug redirects to. Returns null when there
 * is no recorded redirect.
 */
export async function lookupSlugRedirect(
  entity: SlugEntity,
  oldSlug: string,
  client: Queryable = db
): Promise<{ entityId: string } | null> {
  const { rows } = await client.query<{ entity_id: string }>(
    `SELECT entity_id FROM slug_redirects
     WHERE entity_type = $1 AND old_slug = $2 LIMIT 1`,
    [entity, oldSlug]
  );
  return rows[0] ? { entityId: rows[0].entity_id } : null;
}
