/**
 * lib/portals/repo.ts
 *
 * Data access for Portals (migration 0018): lookup/alias resolution, admin
 * CRUD, hashtag merge/block, follows and per-day analytics counters.
 *
 * Drizzle builder first, `sql` template only for aggregates / set-based
 * statements (per the project's Drizzle-coverage rule). No Redis in here:
 * caching lives in lib/portals/cache.ts and is always TTL-bounded.
 *
 * @module lib/portals/repo
 */

import { and, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { normaliseHashtag } from "@zobia/shared/utils";
import type { PortalCard, PortalSectionConfig, PortalStatus } from "@zobia/types";
import { isBoostActive, isSponsorshipActive, normalizeSections, RESERVED_PORTAL_SLUGS, titleFromSlug } from "./constants";

export type PortalRow = typeof schema.portals.$inferSelect;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function toPortalCard(row: PortalRow, activityCount = 0): PortalCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    coverImageUrl: row.coverImageUrl,
    accentColor: row.accentColor,
    status: row.status as PortalStatus,
    followerCount: row.followerCount,
    activityCount,
    isPromoted: isBoostActive(row) || isSponsorshipActive(row.sponsoredUntil),
    sponsorName: isSponsorshipActive(row.sponsoredUntil) ? row.sponsorName : null,
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface ResolvedPortal {
  row: PortalRow;
  /** The portal's own slug. A request for a merged alias resolves here and should 308 to it. */
  canonicalSlug: string;
  hashtagId: string;
}

/**
 * Resolve `/h/<slug>`: the portal whose hashtag is `slug`, following one
 * admin-merge alias hop. Suppressed portals resolve to null (public 404);
 * archived ones still resolve so old links and search engines keep working.
 */
export async function resolvePortal(rawSlug: string, opts: { includeSuppressed?: boolean } = {}): Promise<ResolvedPortal | null> {
  const slug = normaliseHashtag(rawSlug);
  if (!slug) return null;
  const orm = await getDb();

  const [tag] = await orm
    .select({ id: schema.hashtags.id, aliasOf: schema.hashtags.aliasOf, isBlocked: schema.hashtags.isBlocked })
    .from(schema.hashtags)
    .where(eq(schema.hashtags.slug, slug))
    .limit(1);
  if (!tag || tag.isBlocked) return null;

  const hashtagId = tag.aliasOf ?? tag.id;
  const [row] = await orm.select().from(schema.portals).where(eq(schema.portals.hashtagId, hashtagId)).limit(1);
  if (!row) return null;
  if (row.status === "suppressed" && !opts.includeSuppressed) return null;
  return { row, canonicalSlug: row.slug, hashtagId };
}

export async function getPortalById(id: string): Promise<PortalRow | null> {
  const orm = await getDb();
  const [row] = await orm.select().from(schema.portals).where(eq(schema.portals.id, id)).limit(1);
  return row ?? null;
}

/** Tagged-content counts inside the trending window, keyed by hashtag id. */
export async function getActivityCounts(hashtagIds: string[], windowHours: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (hashtagIds.length === 0) return out;
  const orm = await getDb();
  const rows = await orm
    .select({ hashtagId: schema.contentHashtags.hashtagId, n: sql<number>`COUNT(*)::int` })
    .from(schema.contentHashtags)
    .where(
      and(
        inArray(schema.contentHashtags.hashtagId, hashtagIds),
        sql`${schema.contentHashtags.createdAt} > NOW() - make_interval(hours => ${Math.max(1, Math.floor(windowHours))})`
      )
    )
    .groupBy(schema.contentHashtags.hashtagId);
  for (const r of rows) out.set(r.hashtagId, r.n);
  return out;
}

export interface ListPortalsOptions {
  statuses?: PortalStatus[];
  q?: string;
  sort?: "trending" | "followers" | "new" | "boost";
  limit?: number;
  offset?: number;
}

/** Paged portal list (discovery page + admin table). Returns cards with window activity. */
export async function listPortals(opts: ListPortalsOptions, windowHours: number): Promise<{ rows: PortalRow[]; cards: PortalCard[]; total: number }> {
  const orm = await getDb();
  const statuses = opts.statuses && opts.statuses.length > 0 ? opts.statuses : (["official", "auto"] as PortalStatus[]);
  const limit = Math.max(1, Math.min(opts.limit ?? 24, 100));
  const offset = Math.max(0, opts.offset ?? 0);

  const conds: SQL[] = [inArray(schema.portals.status, statuses)];
  const q = opts.q?.trim().replace(/^#/, "");
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(${schema.portals.title} ILIKE ${like} OR ${schema.portals.slug} ILIKE ${like})`);
  }
  const where = and(...conds);

  const order =
    opts.sort === "followers"
      ? [desc(schema.portals.followerCount)]
      : opts.sort === "new"
        ? [desc(schema.portals.createdAt)]
        : opts.sort === "boost"
          ? [desc(schema.portals.boostWeight), desc(schema.portals.lastActivityAt)]
          : [desc(schema.portals.isPinned), sql`${schema.portals.lastActivityAt} DESC NULLS LAST`, desc(schema.portals.followerCount)];

  const [rows, [{ n }]] = await Promise.all([
    orm.select().from(schema.portals).where(where).orderBy(...order).limit(limit).offset(offset),
    orm.select({ n: sql<number>`COUNT(*)::int` }).from(schema.portals).where(where),
  ]);
  const activity = await getActivityCounts(rows.map((r) => r.hashtagId), windowHours);
  return { rows, cards: rows.map((r) => toPortalCard(r, activity.get(r.hashtagId) ?? 0)), total: n };
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export interface PortalInput {
  slug: string;
  title?: string | null;
  tagline?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  accentColor?: string | null;
  city?: string | null;
  bbBoardId?: string | null;
  sections?: PortalSectionConfig[];
  isPinned?: boolean;
  boostWeight?: number;
  boostStartsAt?: string | null;
  boostEndsAt?: string | null;
  sponsoredUntil?: string | null;
  sponsorName?: string | null;
}

function assertValidPortalSlug(raw: string): string {
  const slug = normaliseHashtag(raw);
  if (!slug) throw badRequest("Portal slug must be 2-50 letters, numbers or underscores (not digits only).", "PORTAL_INVALID_SLUG");
  if (RESERVED_PORTAL_SLUGS.has(slug)) throw badRequest(`"${slug}" is reserved and cannot be a portal.`, "PORTAL_RESERVED_SLUG");
  return slug;
}

function toDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v) : null;
}

/**
 * Create an official (admin-curated) portal for `slug`, creating the hashtag
 * if it has never been used. If an auto portal already exists for the tag it
 * is promoted in place (status -> official) and the submitted fields applied.
 */
export async function upsertOfficialPortal(input: PortalInput, createdBy: string): Promise<PortalRow> {
  const slug = assertValidPortalSlug(input.slug);
  const orm = await getDb();

  return orm.transaction(async (tx) => {
    await tx
      .insert(schema.hashtags)
      .values({ slug, display: slug })
      .onConflictDoNothing({ target: schema.hashtags.slug });
    const [tag] = await tx
      .select({ id: schema.hashtags.id, aliasOf: schema.hashtags.aliasOf, isBlocked: schema.hashtags.isBlocked })
      .from(schema.hashtags)
      .where(eq(schema.hashtags.slug, slug))
      .limit(1);
    if (!tag) throw new Error("hashtag upsert failed");
    if (tag.isBlocked) throw conflict("That hashtag is blocked. Unblock it first.", "PORTAL_HASHTAG_BLOCKED");
    if (tag.aliasOf) throw conflict("That hashtag was merged into another. Use the surviving hashtag.", "PORTAL_HASHTAG_MERGED");

    const values = {
      title: input.title?.trim() || titleFromSlug(slug),
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      coverImageUrl: input.coverImageUrl || null,
      accentColor: input.accentColor || null,
      city: input.city?.trim() || null,
      bbBoardId: input.bbBoardId || null,
      sections: normalizeSections(input.sections),
      isPinned: input.isPinned ?? false,
      boostWeight: input.boostWeight ?? 0,
      boostStartsAt: toDateOrNull(input.boostStartsAt) ?? null,
      boostEndsAt: toDateOrNull(input.boostEndsAt) ?? null,
      sponsoredUntil: toDateOrNull(input.sponsoredUntil) ?? null,
      sponsorName: input.sponsorName?.trim() || null,
    };

    const [existing] = await tx.select({ id: schema.portals.id }).from(schema.portals).where(eq(schema.portals.hashtagId, tag.id)).limit(1);
    if (existing) {
      const [row] = await tx
        .update(schema.portals)
        .set({ ...values, status: "official", updatedAt: sql`NOW()` })
        .where(eq(schema.portals.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await tx
      .insert(schema.portals)
      .values({ ...values, slug, hashtagId: tag.id, status: "official", createdBy, lastActivityAt: sql`NOW()` })
      .returning();
    return row;
  });
}

export type PortalPatch = Partial<Omit<PortalInput, "slug">> & { status?: PortalStatus };

export async function updatePortal(id: string, patch: PortalPatch): Promise<PortalRow> {
  const set: Partial<typeof schema.portals.$inferInsert> = { updatedAt: sql`NOW()` as unknown as Date };
  if (patch.title !== undefined) set.title = patch.title?.trim() || "";
  if (patch.tagline !== undefined) set.tagline = patch.tagline?.trim() || null;
  if (patch.description !== undefined) set.description = patch.description?.trim() || null;
  if (patch.coverImageUrl !== undefined) set.coverImageUrl = patch.coverImageUrl || null;
  if (patch.accentColor !== undefined) set.accentColor = patch.accentColor || null;
  if (patch.city !== undefined) set.city = patch.city?.trim() || null;
  if (patch.bbBoardId !== undefined) set.bbBoardId = patch.bbBoardId || null;
  if (patch.sections !== undefined) set.sections = normalizeSections(patch.sections);
  if (patch.isPinned !== undefined) set.isPinned = patch.isPinned;
  if (patch.boostWeight !== undefined) set.boostWeight = patch.boostWeight;
  if (patch.boostStartsAt !== undefined) set.boostStartsAt = toDateOrNull(patch.boostStartsAt) ?? null;
  if (patch.boostEndsAt !== undefined) set.boostEndsAt = toDateOrNull(patch.boostEndsAt) ?? null;
  if (patch.sponsoredUntil !== undefined) set.sponsoredUntil = toDateOrNull(patch.sponsoredUntil) ?? null;
  if (patch.sponsorName !== undefined) set.sponsorName = patch.sponsorName?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (set.title === "") throw badRequest("Title cannot be empty.", "PORTAL_INVALID_TITLE");

  const orm = await getDb();
  const [row] = await orm.update(schema.portals).set(set).where(eq(schema.portals.id, id)).returning();
  if (!row) throw notFound("Portal not found");
  return row;
}

export async function deletePortal(id: string): Promise<void> {
  const orm = await getDb();
  const deleted = await orm.delete(schema.portals).where(eq(schema.portals.id, id)).returning({ id: schema.portals.id });
  if (deleted.length === 0) throw notFound("Portal not found");
}

// ---------------------------------------------------------------------------
// Hashtag moderation: merge + block
// ---------------------------------------------------------------------------

/**
 * Merge `fromSlug` into `intoSlug`: future and existing content collapses onto
 * the survivor. Links move in one statement (duplicates dropped), counters are
 * recomputed from the truth, and any portal on the merged-away tag is removed
 * (its followers are carried to the survivor's portal when one exists).
 */
export async function mergeHashtags(fromRaw: string, intoRaw: string): Promise<{ moved: number; survivorSlug: string }> {
  const fromSlug = normaliseHashtag(fromRaw);
  const intoSlug = normaliseHashtag(intoRaw);
  if (!fromSlug || !intoSlug) throw badRequest("Both hashtags must be valid.", "HASHTAG_INVALID");
  if (fromSlug === intoSlug) throw badRequest("Cannot merge a hashtag into itself.", "HASHTAG_MERGE_SELF");

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const tags = await tx
      .select({ id: schema.hashtags.id, slug: schema.hashtags.slug, aliasOf: schema.hashtags.aliasOf })
      .from(schema.hashtags)
      .where(inArray(schema.hashtags.slug, [fromSlug, intoSlug]));
    const from = tags.find((t) => t.slug === fromSlug);
    const into = tags.find((t) => t.slug === intoSlug);
    if (!from) throw notFound(`Hashtag #${fromSlug} not found`);
    if (!into) throw notFound(`Hashtag #${intoSlug} not found`);
    if (into.aliasOf) throw conflict(`#${intoSlug} was itself merged into another hashtag. Merge into the survivor.`, "HASHTAG_MERGE_TARGET_ALIASED");

    // Drop links that would collide with an existing survivor link, then re-point the rest.
    await tx.execute(sql`
      DELETE FROM content_hashtags a
      USING content_hashtags b
      WHERE a.hashtag_id = ${from.id} AND b.hashtag_id = ${into.id}
        AND a.content_type = b.content_type AND a.content_id = b.content_id
    `);
    const moved = await tx
      .update(schema.contentHashtags)
      .set({ hashtagId: into.id })
      .where(eq(schema.contentHashtags.hashtagId, from.id))
      .returning({ id: schema.contentHashtags.id });

    // Anything that already aliased to the merged-away tag now points at the survivor.
    await tx.update(schema.hashtags).set({ aliasOf: into.id }).where(eq(schema.hashtags.aliasOf, from.id));
    await tx.update(schema.hashtags).set({ aliasOf: into.id }).where(eq(schema.hashtags.id, from.id));

    // Carry followers across, then remove the merged-away portal.
    const [fromPortal] = await tx.select({ id: schema.portals.id }).from(schema.portals).where(eq(schema.portals.hashtagId, from.id)).limit(1);
    const [intoPortal] = await tx.select({ id: schema.portals.id }).from(schema.portals).where(eq(schema.portals.hashtagId, into.id)).limit(1);
    if (fromPortal && intoPortal) {
      await tx.execute(sql`
        INSERT INTO portal_follows (portal_id, user_id, created_at)
        SELECT ${intoPortal.id}, user_id, created_at FROM portal_follows WHERE portal_id = ${fromPortal.id}
        ON CONFLICT DO NOTHING
      `);
      await recountFollowers(tx, intoPortal.id);
    }
    if (fromPortal) await tx.delete(schema.portals).where(eq(schema.portals.id, fromPortal.id));

    await tx.execute(sql`
      UPDATE hashtags h SET use_count = (SELECT COUNT(*) FROM content_hashtags c WHERE c.hashtag_id = h.id)
      WHERE h.id IN (${from.id}, ${into.id})
    `);
    return { moved: moved.length, survivorSlug: into.slug };
  });
}

/**
 * Block or unblock a hashtag. Blocking removes its links and suppresses its
 * portal so it disappears everywhere immediately; unblocking only clears the
 * flag (links are not resurrected, new posts simply tag normally again).
 */
export async function setHashtagBlocked(rawSlug: string, blocked: boolean): Promise<void> {
  const slug = normaliseHashtag(rawSlug);
  if (!slug) throw badRequest("Invalid hashtag.", "HASHTAG_INVALID");
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [tag] = await tx.update(schema.hashtags).set({ isBlocked: blocked }).where(eq(schema.hashtags.slug, slug)).returning({ id: schema.hashtags.id });
    if (!tag) {
      if (!blocked) return;
      // Pre-emptive block of a never-used tag.
      await tx.insert(schema.hashtags).values({ slug, display: slug, isBlocked: true }).onConflictDoNothing();
      return;
    }
    if (blocked) {
      await tx.delete(schema.contentHashtags).where(eq(schema.contentHashtags.hashtagId, tag.id));
      await tx.update(schema.hashtags).set({ useCount: 0 }).where(eq(schema.hashtags.id, tag.id));
      await tx.update(schema.portals).set({ status: "suppressed", updatedAt: sql`NOW()` }).where(eq(schema.portals.hashtagId, tag.id));
    }
  });
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

async function recountFollowers(db: DbOrTx, portalId: string): Promise<number> {
  const [row] = await db
    .update(schema.portals)
    .set({ followerCount: sql`(SELECT COUNT(*)::int FROM portal_follows WHERE portal_id = ${portalId})` })
    .where(eq(schema.portals.id, portalId))
    .returning({ followerCount: schema.portals.followerCount });
  return row?.followerCount ?? 0;
}

export async function followPortal(portalId: string, userId: string): Promise<{ following: true; followerCount: number }> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.portalFollows)
      .values({ portalId, userId })
      .onConflictDoNothing()
      .returning({ portalId: schema.portalFollows.portalId });
    const followerCount = await recountFollowers(tx, portalId);
    if (inserted.length > 0) await bumpPortalStat(portalId, "follows", 1, tx);
    return { following: true as const, followerCount };
  });
}

export async function unfollowPortal(portalId: string, userId: string): Promise<{ following: false; followerCount: number }> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    await tx.delete(schema.portalFollows).where(and(eq(schema.portalFollows.portalId, portalId), eq(schema.portalFollows.userId, userId)));
    const followerCount = await recountFollowers(tx, portalId);
    return { following: false as const, followerCount };
  });
}

export async function isFollowingPortal(portalId: string, userId: string): Promise<boolean> {
  const orm = await getDb();
  const [row] = await orm
    .select({ portalId: schema.portalFollows.portalId })
    .from(schema.portalFollows)
    .where(and(eq(schema.portalFollows.portalId, portalId), eq(schema.portalFollows.userId, userId)))
    .limit(1);
  return !!row;
}

export async function listFollowedPortalIds(userId: string): Promise<string[]> {
  const orm = await getDb();
  const rows = await orm
    .select({ portalId: schema.portalFollows.portalId })
    .from(schema.portalFollows)
    .where(eq(schema.portalFollows.userId, userId))
    .orderBy(desc(schema.portalFollows.createdAt))
    .limit(200);
  return rows.map((r) => r.portalId);
}

export async function listFollowedPortals(userId: string, windowHours: number): Promise<PortalCard[]> {
  const orm = await getDb();
  const rows = await orm
    .select({ portal: schema.portals })
    .from(schema.portalFollows)
    .innerJoin(schema.portals, eq(schema.portals.id, schema.portalFollows.portalId))
    .where(and(eq(schema.portalFollows.userId, userId), sql`${schema.portals.status} <> 'suppressed'`))
    .orderBy(desc(schema.portalFollows.createdAt))
    .limit(100);
  const activity = await getActivityCounts(rows.map((r) => r.portal.hashtagId), windowHours);
  return rows.map((r) => toPortalCard(r.portal, activity.get(r.portal.hashtagId) ?? 0));
}

// ---------------------------------------------------------------------------
// Analytics (one upsert per event, no Redis)
// ---------------------------------------------------------------------------

export type PortalStatField = "views" | "impressions" | "clicks" | "follows";

export async function bumpPortalStat(portalId: string, field: PortalStatField, n = 1, db?: DbOrTx): Promise<void> {
  const orm = db ?? (await getDb());
  const inc = Math.max(1, Math.min(Math.floor(n), 1000));
  const values = { portalId, views: 0, impressions: 0, clicks: 0, follows: 0, [field]: inc };
  await orm
    .insert(schema.portalStatsDaily)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.portalStatsDaily.portalId, schema.portalStatsDaily.day],
      set: { [field]: sql`${schema.portalStatsDaily[field]} + ${inc}` },
    });
}

/** One multi-row upsert for a feed page's suggestion impressions. */
export async function bumpPortalImpressions(portalIds: string[]): Promise<void> {
  const ids = [...new Set(portalIds)];
  if (ids.length === 0) return;
  const orm = await getDb();
  await orm
    .insert(schema.portalStatsDaily)
    .values(ids.map((portalId) => ({ portalId, impressions: 1 })))
    .onConflictDoUpdate({
      target: [schema.portalStatsDaily.portalId, schema.portalStatsDaily.day],
      set: { impressions: sql`${schema.portalStatsDaily.impressions} + 1` },
    });
}

export interface PortalStatsSummary {
  days: { day: string; views: number; impressions: number; clicks: number; follows: number }[];
  totals: { views: number; impressions: number; clicks: number; follows: number };
}

export async function getPortalStats(portalId: string, days = 30): Promise<PortalStatsSummary> {
  const orm = await getDb();
  const span = Math.max(1, Math.min(days, 365));
  const rows = await orm
    .select({
      day: schema.portalStatsDaily.day,
      views: schema.portalStatsDaily.views,
      impressions: schema.portalStatsDaily.impressions,
      clicks: schema.portalStatsDaily.clicks,
      follows: schema.portalStatsDaily.follows,
    })
    .from(schema.portalStatsDaily)
    .where(and(eq(schema.portalStatsDaily.portalId, portalId), sql`${schema.portalStatsDaily.day} >= CURRENT_DATE - ${span}::int`))
    .orderBy(schema.portalStatsDaily.day);
  const totals = rows.reduce(
    (acc, r) => ({ views: acc.views + r.views, impressions: acc.impressions + r.impressions, clicks: acc.clicks + r.clicks, follows: acc.follows + r.follows }),
    { views: 0, impressions: 0, clicks: 0, follows: 0 }
  );
  return { days: rows, totals };
}

/** Portals whose hashtag has an alias pointing at them (used by the admin table to show merged tags). */
export async function listAliasesFor(hashtagId: string): Promise<string[]> {
  const orm = await getDb();
  const rows = await orm
    .select({ slug: schema.hashtags.slug })
    .from(schema.hashtags)
    .where(and(eq(schema.hashtags.aliasOf, hashtagId), isNotNull(schema.hashtags.aliasOf)));
  return rows.map((r) => r.slug);
}
