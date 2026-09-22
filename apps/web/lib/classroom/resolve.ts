/**
 * lib/classroom/resolve.ts
 *
 * Resolve the identifier in a /c/<identifier> URL to a classroom id, with
 * the same three cases as lib/public/resolveRoom.ts:
 *   1. current slug             → serve
 *   2. legacy /c/<uuid> link    → 301 to the slug URL
 *   3. retired slug (a rename)  → 301 via slug_redirects
 * Unlike resolvePublicRoom this also resolves archived and private
 * classrooms — the page itself decides what a given viewer may see, so
 * members keep access to an archived/private classroom's homepage.
 */

import { looksLikeUuid } from "@zobia/shared/utils";
import { db } from "@/lib/db";
import { lookupSlugRedirect } from "@/lib/slug";

export interface ResolvedClassroomId {
  id: string;
  slug: string | null;
  /** Set when the request should 301 to /c/<canonicalSlug>. */
  redirectTo: string | null;
}

async function bySlug(slug: string): Promise<{ id: string; slug: string | null } | null> {
  const { rows } = await db.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM rooms WHERE slug = $1 AND type = 'classroom' AND deleted_at IS NULL LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

async function byId(id: string): Promise<{ id: string; slug: string | null } | null> {
  const { rows } = await db.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM rooms WHERE id = $1 AND type = 'classroom' AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function resolveClassroomIdentifier(identifier: string): Promise<ResolvedClassroomId | null> {
  const current = await bySlug(identifier);
  if (current) return { ...current, redirectTo: null };

  if (looksLikeUuid(identifier)) {
    const row = await byId(identifier);
    if (row) return { ...row, redirectTo: row.slug && row.slug !== identifier ? row.slug : null };
  }

  const redirect = await lookupSlugRedirect("room", identifier).catch(() => null);
  if (redirect) {
    const row = await byId(redirect.entityId);
    if (row) return { ...row, redirectTo: row.slug && row.slug !== identifier ? row.slug : null };
  }
  return null;
}
