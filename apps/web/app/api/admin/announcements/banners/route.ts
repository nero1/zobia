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
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBannerSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5_000),
  contentType: z.enum(["html", "markdown", "plain"]).default("plain"),
  linkUrl: z.string().url().optional().nullable(),
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
export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query(
      `SELECT
         id, title, content, content_type, link_url, is_active,
         target_plans, target_roles, display_order,
         starts_at, ends_at, created_at, updated_at
       FROM announcement_banners
       WHERE deleted_at IS NULL
       ORDER BY display_order ASC, created_at DESC`
    );

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
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateBannerSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid banner payload", parsed.error.flatten());
    }

    const {
      title,
      content,
      contentType,
      linkUrl,
      startsAt,
      endsAt,
      targetPlans,
      targetRoles,
      displayOrder,
    } = parsed.data;

    const { rows } = await db.query(
      `INSERT INTO announcement_banners
         (title, content, content_type, link_url, is_active,
          target_plans, target_roles, display_order,
          starts_at, ends_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        title,
        content,
        contentType,
        linkUrl ?? null,
        JSON.stringify(targetPlans),
        JSON.stringify(targetRoles),
        displayOrder,
        startsAt ?? null,
        endsAt ?? null,
        auth.user.sub,
      ]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
