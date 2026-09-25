/**
 * lib/announcements/engine.ts
 *
 * Announcement resolution engine.
 *
 * Determines which modal and banner to show a specific user based on:
 *  - Active status (is_active = true)
 *  - Schedule (starts_at / ends_at)
 *  - Plan targeting (empty = all plans)
 *  - Role targeting (empty = all roles)
 *  - Gender targeting (empty = all genders)
 *  - Display mode from x_manifest (serial or random)
 *  - For serial mode: tracks viewed modals via user_modal_views
 *
 * HTML content from admins is sanitized before being returned.
 *
 * @module lib/announcements/engine
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved announcement modal ready to display. */
export interface ResolvedModal {
  id: string;
  title: string;
  content: string;
  content_type: "html" | "markdown" | "plain";
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
}

/** A resolved announcement banner ready to display. */
export interface ResolvedBanner {
  id: string;
  title: string;
  content: string;
  content_type: "html" | "markdown" | "plain";
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

/** Minimal user object needed for targeting. */
export interface AnnouncementUser {
  id: string;
  plan_id?: string | null;
  role?: string | null;
  gender?: string | null;
}

// ---------------------------------------------------------------------------
// Internal targeting helpers
// ---------------------------------------------------------------------------

/**
 * Check if a user matches a modal/banner's targeting criteria.
 *
 * Empty target arrays mean "show to everyone".
 *
 * @param user          - The current user
 * @param targetPlans   - Plans the announcement targets (empty = all)
 * @param targetRoles   - Roles the announcement targets (empty = all)
 * @param targetGenders - Genders the announcement targets (empty = all)
 */
function matchesTargeting(
  user: AnnouncementUser,
  targetPlans: string[],
  targetRoles: string[],
  targetGenders: string[] = []
): boolean {
  if (targetPlans.length > 0 && (!user.plan_id || !targetPlans.includes(user.plan_id))) return false;
  if (targetRoles.length > 0 && (!user.role || !targetRoles.includes(user.role))) return false;
  if (targetGenders.length > 0 && (!user.gender || !targetGenders.includes(user.gender))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// getActiveModalForUser
// ---------------------------------------------------------------------------

/**
 * Resolve the single announcement modal to show the current user.
 *
 * Display mode is read from the x_manifest table (key: announcement_modal_mode).
 *  - "serial"   → show modals in display_order; skip already-viewed ones
 *  - "random"   → pick a random eligible modal each session
 *
 * Returns null if no eligible modal exists.
 *
 * @param userId - Authenticated user's UUID
 * @param user   - User object with plan and role for targeting
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns The modal to show, or null
 */
export async function getActiveModalForUser(
  userId: string,
  user: AnnouncementUser,
  db: DbOrTx
): Promise<ResolvedModal | null> {
  // TASK-30: use manifest cache instead of raw SQL to avoid an extra uncached DB hit
  const displayMode = ((await getManifestValue("announcement_modal_mode")) ?? "serial") as "serial" | "random";

  // TASK-19: LIMIT 50 prevents unbounded fetch when hundreds of announcements exist
  const modals = await db
    .select({
      id: schema.announcementModals.id,
      title: schema.announcementModals.title,
      content: schema.announcementModals.content,
      contentType: schema.announcementModals.contentType,
      displayOrder: schema.announcementModals.displayOrder,
      targetPlans: sql<string[]>`COALESCE(${schema.announcementModals.targetPlans}, '{}')::text[]`,
      targetRoles: sql<string[]>`COALESCE(${schema.announcementModals.targetRoles}, '{}')::text[]`,
      targetGenders: sql<string[]>`COALESCE(${schema.announcementModals.targetGenders}, '{}')::text[]`,
      startsAt: schema.announcementModals.startsAt,
      endsAt: schema.announcementModals.endsAt,
    })
    .from(schema.announcementModals)
    .where(
      and(
        eq(schema.announcementModals.isActive, true),
        or(isNull(schema.announcementModals.startsAt), sql`${schema.announcementModals.startsAt} <= NOW()`),
        or(isNull(schema.announcementModals.endsAt), sql`${schema.announcementModals.endsAt} >= NOW()`),
        isNull(schema.announcementModals.deletedAt)
      )
    )
    .orderBy(sql`${schema.announcementModals.displayOrder} ASC`)
    .limit(50);

  const eligible = modals.filter((m) =>
    matchesTargeting(user, m.targetPlans, m.targetRoles, m.targetGenders)
  );

  if (eligible.length === 0) return null;

  let selected = eligible[0];

  if (displayMode === "serial") {
    const eligibleIds = eligible.map((m) => m.id);
    // TASK-32: bound query to only eligible modal IDs to prevent unbounded scan
    const viewedRows = await db
      .select({ modalId: schema.userModalViews.modalId })
      .from(schema.userModalViews)
      .where(and(eq(schema.userModalViews.userId, userId), inArray(schema.userModalViews.modalId, eligibleIds)));
    const viewedIds = new Set(viewedRows.map((r) => r.modalId));
    const unviewed = eligible.filter((m) => !viewedIds.has(m.id));
    if (unviewed.length === 0) {
      // TASK-31: reset only the currently eligible modal views, not ALL user views
      await db
        .delete(schema.userModalViews)
        .where(and(eq(schema.userModalViews.userId, userId), inArray(schema.userModalViews.modalId, eligibleIds)));
      selected = eligible[0];
    } else {
      selected = unviewed[0];
    }
  } else if (displayMode === "random") {
    selected = eligible[Math.floor(Math.random() * eligible.length)];
  }

  return {
    id: selected.id,
    title: selected.title,
    content: sanitizeAnnouncementContent(selected.content, selected.contentType),
    content_type: selected.contentType as ResolvedModal["content_type"],
    display_order: selected.displayOrder,
    starts_at: selected.startsAt ? new Date(selected.startsAt).toISOString() : null,
    ends_at: selected.endsAt ? new Date(selected.endsAt).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// confirmAnnouncementView
// ---------------------------------------------------------------------------

/**
 * Record that the user has confirmed they saw a modal or banner.
 * Called by the client after the announcement is actually rendered and visible.
 *
 * @param userId         - Authenticated user's UUID
 * @param announcementId - UUID of the modal or banner that was shown
 * @param type           - Whether this is a 'modal' or 'banner' view
 * @param db             - Drizzle db instance or an active transaction handle.
 */
export async function confirmAnnouncementView(
  userId: string,
  announcementId: string,
  type: "modal" | "banner",
  db: DbOrTx
): Promise<void> {
  if (type === "modal") {
    await db
      .insert(schema.userModalViews)
      .values({ userId, modalId: announcementId })
      .onConflictDoUpdate({
        target: [schema.userModalViews.userId, schema.userModalViews.modalId],
        set: { viewedAt: new Date() },
      });
  } else {
    await db
      .insert(schema.userBannerViews)
      .values({ userId, bannerId: announcementId })
      .onConflictDoUpdate({
        target: [schema.userBannerViews.userId, schema.userBannerViews.bannerId],
        set: { viewedAt: new Date() },
      });
  }
}

// ---------------------------------------------------------------------------
// getActiveBannerForUser
// ---------------------------------------------------------------------------

/**
 * Resolve the single announcement banner to show the current user.
 *
 * Returns the highest-priority (lowest display_order) banner that
 * matches the user's plan and role targeting.
 *
 * Returns null if no eligible banner exists.
 *
 * @param userId - Authenticated user's UUID
 * @param user   - User object with plan and role for targeting
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns The banner to show, or null
 */
export async function getActiveBannerForUser(
  userId: string,
  user: AnnouncementUser,
  db: DbOrTx
): Promise<ResolvedBanner | null> {
  // TASK-19: LIMIT 50 prevents unbounded fetch
  const banners = await db
    .select({
      id: schema.announcementBanners.id,
      title: schema.announcementBanners.title,
      content: schema.announcementBanners.content,
      contentType: schema.announcementBanners.contentType,
      linkUrl: schema.announcementBanners.linkUrl,
      targetPlans: sql<string[]>`COALESCE(${schema.announcementBanners.targetPlans}, '{}')::text[]`,
      targetRoles: sql<string[]>`COALESCE(${schema.announcementBanners.targetRoles}, '{}')::text[]`,
      targetGenders: sql<string[]>`COALESCE(${schema.announcementBanners.targetGenders}, '{}')::text[]`,
      startsAt: schema.announcementBanners.startsAt,
      endsAt: schema.announcementBanners.endsAt,
    })
    .from(schema.announcementBanners)
    .where(
      and(
        eq(schema.announcementBanners.isActive, true),
        or(isNull(schema.announcementBanners.startsAt), sql`${schema.announcementBanners.startsAt} <= NOW()`),
        or(isNull(schema.announcementBanners.endsAt), sql`${schema.announcementBanners.endsAt} >= NOW()`),
        isNull(schema.announcementBanners.deletedAt)
      )
    )
    .orderBy(sql`${schema.announcementBanners.displayOrder} ASC`)
    .limit(50);

  const eligible = banners.filter((b) =>
    matchesTargeting(user, b.targetPlans, b.targetRoles, b.targetGenders)
  );

  if (eligible.length === 0) return null;

  // TASK-30: use manifest cache instead of raw SQL to avoid uncached DB hit
  const displayMode = ((await getManifestValue("announcement_banner_mode")) ?? "serial") as "serial" | "random";

  let selected = eligible[0];

  if (displayMode === "serial") {
    const eligibleIds = eligible.map((b) => b.id);
    // TASK-32: bound query to only eligible banner IDs
    const viewedRows = await db
      .select({ bannerId: schema.userBannerViews.bannerId })
      .from(schema.userBannerViews)
      .where(and(eq(schema.userBannerViews.userId, userId), inArray(schema.userBannerViews.bannerId, eligibleIds)));
    const viewedIds = new Set(viewedRows.map((r) => r.bannerId));
    const unviewed = eligible.filter((b) => !viewedIds.has(b.id));
    if (unviewed.length === 0) return null;
    selected = unviewed[0];
  } else if (displayMode === "random") {
    selected = eligible[Math.floor(Math.random() * eligible.length)];
  }

  return {
    id: selected.id,
    title: selected.title as string,
    content: sanitizeAnnouncementContent(selected.content, selected.contentType),
    content_type: selected.contentType as ResolvedBanner["content_type"],
    link_url: selected.linkUrl,
    starts_at: selected.startsAt ? new Date(selected.startsAt).toISOString() : null,
    ends_at: selected.endsAt ? new Date(selected.endsAt).toISOString() : null,
  };
}
