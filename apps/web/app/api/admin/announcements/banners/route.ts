export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/banners/route.ts
 *
 * GET  /api/admin/announcements/banners — List all announcement banners.
 * POST /api/admin/announcements/banners — Create a new banner.
 *
 * Banners are created as inactive by default.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, asc, count, desc, isNull } from "drizzle-orm";

const MAX_BANNERS = 5;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBannerSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5_000),
  contentType: z.enum(["html", "markdown", "plain"]).default("plain"),
  linkUrl: z.string().url().refine(u => !/^javascript:/i.test(u), "javascript: URLs are not allowed").optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  targetPlans: z.array(z.string()).default([]),
  targetRoles: z.array(z.string()).default([]),
  displayOrder: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// GET /api/admin/announcements/banners
// ---------------------------------------------------------------------------

/**
 * List all announcement banners (active and inactive).
 *
 * @returns Array of all banners ordered by display_order
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.announcementBanners.id,
        title: schema.announcementBanners.title,
        content: schema.announcementBanners.content,
        content_type: schema.announcementBanners.contentType,
        link_url: schema.announcementBanners.linkUrl,
        is_active: schema.announcementBanners.isActive,
        target_plans: schema.announcementBanners.targetPlans,
        target_roles: schema.announcementBanners.targetRoles,
        display_order: schema.announcementBanners.displayOrder,
        starts_at: schema.announcementBanners.startsAt,
        ends_at: schema.announcementBanners.endsAt,
        created_at: schema.announcementBanners.createdAt,
        updated_at: schema.announcementBanners.updatedAt,
      })
      .from(schema.announcementBanners)
      .where(isNull(schema.announcementBanners.deletedAt))
      .orderBy(asc(schema.announcementBanners.displayOrder), desc(schema.announcementBanners.createdAt));

    return NextResponse.json({ items: rows, count: rows.length });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/announcements/banners
// ---------------------------------------------------------------------------

/**
 * Create a new announcement banner.
 *
 * Created as inactive by default. Activate via PUT /[bannerId].
 *
 * @returns Created banner record
 */
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateBannerSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid banner payload", parsed.error.flatten());
    }

    const {
      title,
      content: rawContent,
      contentType,
      linkUrl,
      startsAt,
      endsAt,
      targetPlans,
      targetRoles,
      displayOrder,
    } = parsed.data;

    const content = sanitizeAnnouncementContent(rawContent, contentType);

    const orm = await getDb();

    // Enforce maximum banner cap
    const [countRow] = await orm
      .select({ count: count() })
      .from(schema.announcementBanners)
      .where(isNull(schema.announcementBanners.deletedAt));
    if ((countRow?.count ?? 0) >= MAX_BANNERS) {
      throw badRequest(`Cannot create banner: already at maximum of ${MAX_BANNERS} banners. Delete one first.`);
    }

    const [row] = await orm
      .insert(schema.announcementBanners)
      .values({
        title,
        content,
        contentType,
        linkUrl: linkUrl ?? null,
        isActive: false,
        targetPlans,
        targetRoles,
        displayOrder,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdBy: auth.user.sub,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
