export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/route.ts
 *
 * Unified announcements endpoint used by the admin panel.
 *
 * GET  /api/admin/announcements?type=modal|banner
 *   Lists all announcements of the specified type plus the current display mode.
 *
 * POST /api/admin/announcements
 *   Creates a new modal or banner. Body must include `type: "modal" | "banner"`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { db } from "@/lib/db";
import { getManifestValue } from "@/lib/manifest";

const MAX_MODALS = 5;
const MAX_BANNERS = 5;

const CreateSchema = z.object({
  type: z.enum(["modal", "banner"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
  contentType: z.enum(["html", "markdown", "plain"]).default("plain"),
  linkUrl: z.string().url().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  targetPlans: z.array(z.string()).default([]),
  targetRoles: z.array(z.string()).default([]),
  displayOrder: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// GET /api/admin/announcements?type=modal|banner
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") === "banner" ? "banner" : "modal";

    let announcements: unknown[];

    if (type === "modal") {
      const { rows } = await db.query(
        `SELECT
           id, title, content, content_type, is_active,
           target_plans, target_roles, display_order,
           starts_at, ends_at, created_at, updated_at
         FROM announcement_modals
         WHERE deleted_at IS NULL
         ORDER BY display_order ASC, created_at DESC`
      );
      announcements = rows;
    } else {
      const { rows } = await db.query(
        `SELECT
           id, title, content, content_type, link_url, is_active,
           target_plans, target_roles, display_order,
           starts_at, ends_at, created_at, updated_at
         FROM announcement_banners
         WHERE deleted_at IS NULL
         ORDER BY display_order ASC, created_at DESC`
      );
      announcements = rows;
    }

    // Fetch the current display mode from x_manifest
    const dmKey = type === "modal" ? "announcement_modal_display_mode" : "announcement_banner_mode";
    const rawDm = await getManifestValue(dmKey);
    const displayMode = (rawDm ?? '"sequential"').replace(/^"|"$/g, "");

    return NextResponse.json({ announcements, displayMode });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/announcements
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid announcement payload", parsed.error.flatten());
    }

    const {
      type,
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

    if (type === "modal") {
      const { rows: countRows } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM announcement_modals WHERE deleted_at IS NULL`
      );
      if (parseInt(countRows[0]?.count ?? "0", 10) >= MAX_MODALS) {
        throw badRequest(`Cannot create modal: already at maximum of ${MAX_MODALS} modals. Delete one first.`);
      }

      const { rows } = await db.query(
        `INSERT INTO announcement_modals
           (title, content, content_type, is_active,
            target_plans, target_roles, display_order,
            starts_at, ends_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [
          title, content, contentType,
          JSON.stringify(targetPlans), JSON.stringify(targetRoles),
          displayOrder, startsAt ?? null, endsAt ?? null, auth.user.sub,
        ]
      );
      return NextResponse.json(rows[0], { status: 201 });
    } else {
      const { rows: countRows } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM announcement_banners WHERE deleted_at IS NULL`
      );
      if (parseInt(countRows[0]?.count ?? "0", 10) >= MAX_BANNERS) {
        throw badRequest(`Cannot create banner: already at maximum of ${MAX_BANNERS} banners. Delete one first.`);
      }

      const { rows } = await db.query(
        `INSERT INTO announcement_banners
           (title, content, content_type, link_url, is_active,
            target_plans, target_roles, display_order,
            starts_at, ends_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING *`,
        [
          title, content, contentType, linkUrl ?? null,
          JSON.stringify(targetPlans), JSON.stringify(targetRoles),
          displayOrder, startsAt ?? null, endsAt ?? null, auth.user.sub,
        ]
      );
      return NextResponse.json(rows[0], { status: 201 });
    }
  } catch (err) {
    return handleApiError(err);
  }
});
