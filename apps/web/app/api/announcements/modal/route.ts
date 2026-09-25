export const dynamic = 'force-dynamic';

/**
 * app/api/announcements/modal/route.ts
 *
 * GET /api/announcements/modal
 *   Returns the next announcement modal for the authenticated user using
 *   server-side rotation tracking (serial or random mode).
 *
 * The rotation cursor is stored in user_announcement_rotation so it persists
 * across devices and reinstalls.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface ModalRow {
  id: string;
  title: string;
  content: string;
  content_type: string;
  display_order: number;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const orm = await getDb();
    const now = new Date();

    // Fetch user plan and gender for audience filtering.
    // BUG-FIX: the pre-migration raw SQL selected a `role` column directly
    // off `users`, but `users` has never had a `role` column (only
    // isAdmin/isModerator/isCreator booleans) — that query would fail with
    // "column role does not exist" every time role-targeted modals existed.
    // Role targeting is modeled via the `admin_roles` table elsewhere in the
    // app (see app/api/admin/messages/route.ts's by_role targeting), so
    // role-match is now an EXISTS check against admin_roles instead of a
    // scalar column on users.
    const [user] = await orm
      .select({
        plan: sql<string>`COALESCE(${schema.users.plan}, 'free')`,
        gender: schema.users.gender,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!user) return NextResponse.json({ success: true, data: { modal: null }, error: null });

    // Fetch all active, scheduled modals whose audience includes this user's plan,
    // role, AND gender (empty target_plans/target_roles/target_genders means
    // "show to everyone" for that dimension).
    const modals = (await orm
      .select({
        id: schema.announcementModals.id,
        title: schema.announcementModals.title,
        content: schema.announcementModals.content,
        content_type: schema.announcementModals.contentType,
        display_order: schema.announcementModals.displayOrder,
      })
      .from(schema.announcementModals)
      .where(
        and(
          eq(schema.announcementModals.isActive, true),
          or(isNull(schema.announcementModals.startsAt), lte(schema.announcementModals.startsAt, now)),
          or(isNull(schema.announcementModals.endsAt), gte(schema.announcementModals.endsAt, now)),
          sql`(cardinality(${schema.announcementModals.targetPlans}) = 0 OR ${user.plan} = ANY(${schema.announcementModals.targetPlans}))`,
          sql`(cardinality(${schema.announcementModals.targetRoles}) = 0 OR EXISTS (
            SELECT 1 FROM admin_roles ar WHERE ar.user_id = ${userId} AND ar.role = ANY(${schema.announcementModals.targetRoles})
          ))`,
          sql`(cardinality(${schema.announcementModals.targetGenders}) = 0 OR (${user.gender}::text IS NOT NULL AND ${user.gender}::text = ANY(${schema.announcementModals.targetGenders})))`
        )
      )
      .orderBy(asc(schema.announcementModals.displayOrder), asc(schema.announcementModals.createdAt))) as ModalRow[];

    if (modals.length === 0) {
      return NextResponse.json({ success: true, data: { modal: null }, error: null });
    }

    // Read display mode from x_manifest
    const displayMode = (await getManifestValue("announcement_modal_display_mode"))?.replace(/"/g, "") ?? "serial";

    // Read last-shown rotation cursor for this user
    const [rotation] = await orm
      .select({ last_shown_id: schema.userAnnouncementRotation.lastShownId })
      .from(schema.userAnnouncementRotation)
      .where(and(eq(schema.userAnnouncementRotation.userId, userId), eq(schema.userAnnouncementRotation.contentType, "modal")))
      .limit(1);
    const lastShownId = rotation?.last_shown_id ?? null;

    let selected: ModalRow;

    if (displayMode === "random") {
      selected = modals[Math.floor(Math.random() * modals.length)];
    } else {
      // Serial: pick the next in display_order after last_shown_id; wrap around
      if (!lastShownId) {
        selected = modals[0];
      } else {
        const lastIdx = modals.findIndex((m) => m.id === lastShownId);
        selected = lastIdx === -1 || lastIdx === modals.length - 1
          ? modals[0]
          : modals[lastIdx + 1];
      }
    }

    // Upsert rotation cursor
    await orm
      .insert(schema.userAnnouncementRotation)
      .values({ userId, contentType: "modal", lastShownId: selected.id, lastShownAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.userAnnouncementRotation.userId, schema.userAnnouncementRotation.contentType],
        set: { lastShownId: selected.id, lastShownAt: new Date() },
      });

    return NextResponse.json({
      success: true,
      data: {
        modal: {
          id: selected.id,
          title: selected.title,
          content: selected.content,
          contentType: selected.content_type,
        },
      },
      error: null,
    }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
  } catch (err) {
    return handleApiError(err);
  }
});
