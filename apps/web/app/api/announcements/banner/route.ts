export const dynamic = 'force-dynamic';

/**
 * app/api/announcements/banner/route.ts
 *
 * GET /api/announcements/banner
 *   Returns the next announcement banner for the authenticated user using
 *   server-side rotation tracking (serial or random mode).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface BannerRow {
  id: string;
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

    // BUG-FIX: the pre-migration raw SQL selected a `role` column directly
    // off `users`, but `users` has never had a `role` column (only
    // isAdmin/isModerator/isCreator booleans) — that query would fail with
    // "column role does not exist" every time role-targeted banners existed.
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

    if (!user) return NextResponse.json({ success: true, data: { banner: null }, error: null });

    const banners = (await orm
      .select({
        id: schema.announcementBanners.id,
        content: schema.announcementBanners.content,
        content_type: schema.announcementBanners.contentType,
        display_order: schema.announcementBanners.displayOrder,
      })
      .from(schema.announcementBanners)
      .where(
        and(
          eq(schema.announcementBanners.isActive, true),
          or(isNull(schema.announcementBanners.startsAt), lte(schema.announcementBanners.startsAt, now)),
          or(isNull(schema.announcementBanners.endsAt), gte(schema.announcementBanners.endsAt, now)),
          sql`(cardinality(${schema.announcementBanners.targetPlans}) = 0 OR ${user.plan} = ANY(${schema.announcementBanners.targetPlans}))`,
          sql`(cardinality(${schema.announcementBanners.targetRoles}) = 0 OR EXISTS (
            SELECT 1 FROM admin_roles ar WHERE ar.user_id = ${userId} AND ar.role = ANY(${schema.announcementBanners.targetRoles})
          ))`,
          sql`(cardinality(${schema.announcementBanners.targetGenders}) = 0 OR (${user.gender}::text IS NOT NULL AND ${user.gender}::text = ANY(${schema.announcementBanners.targetGenders})))`
        )
      )
      .orderBy(asc(schema.announcementBanners.displayOrder), asc(schema.announcementBanners.createdAt))) as BannerRow[];

    if (banners.length === 0) {
      return NextResponse.json({ success: true, data: { banner: null }, error: null });
    }

    const displayMode = (await getManifestValue("announcement_banner_mode"))?.replace(/"/g, "") ?? "serial";

    const [rotation] = await orm
      .select({ last_shown_id: schema.userAnnouncementRotation.lastShownId })
      .from(schema.userAnnouncementRotation)
      .where(and(eq(schema.userAnnouncementRotation.userId, userId), eq(schema.userAnnouncementRotation.contentType, "banner")))
      .limit(1);
    const lastShownId = rotation?.last_shown_id ?? null;

    let selected: BannerRow;

    if (displayMode === "random") {
      selected = banners[Math.floor(Math.random() * banners.length)];
    } else {
      if (!lastShownId) {
        selected = banners[0];
      } else {
        const lastIdx = banners.findIndex((b) => b.id === lastShownId);
        selected = lastIdx === -1 || lastIdx === banners.length - 1
          ? banners[0]
          : banners[lastIdx + 1];
      }
    }

    await orm
      .insert(schema.userAnnouncementRotation)
      .values({ userId, contentType: "banner", lastShownId: selected.id, lastShownAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.userAnnouncementRotation.userId, schema.userAnnouncementRotation.contentType],
        set: { lastShownId: selected.id, lastShownAt: new Date() },
      });

    return NextResponse.json({
      success: true,
      data: {
        banner: {
          id: selected.id,
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
