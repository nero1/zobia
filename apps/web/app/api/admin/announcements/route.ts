export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/route.ts
 *
 * Unified announcements endpoint used by the admin panel
 * (app/(admin)/gate44/announcements/page.tsx).
 *
 * GET  /api/admin/announcements?type=modal|banner
 *   Lists all announcements of the specified type plus the current display mode.
 *
 * POST /api/admin/announcements
 *   Creates a new modal or banner. Body must include `type: "modal" | "banner"`.
 *
 * BUG FIX: the request/response shape here now matches what the admin page
 * actually sends/expects end-to-end (audience{plans,roles}, startAt/endAt,
 * status) — the previous version required `title` on both types (banners
 * never send one → always 400) and JSON.stringify'd target_plans/target_roles
 * into what are native Postgres text[] columns (malformed array literal →
 * always 500 on create/update, for both types).
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

const CreateSchema = z
  .object({
    type: z.enum(["modal", "banner"]),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(50_000),
    contentType: z.enum(["html", "markdown", "plain"]).default("plain"),
    linkUrl: z.string().url().optional().nullable(),
    startAt: z.string().datetime().optional().nullable(),
    endAt: z.string().datetime().optional().nullable(),
    audience: z
      .object({
        plans: z.array(z.string()).default([]),
        roles: z.array(z.string()).default([]),
      })
      .default({ plans: [], roles: [] }),
    displayOrder: z.number().int().min(0).default(1),
    status: z.enum(["active", "inactive", "scheduled"]).default("inactive"),
  })
  // Title is required for modals (shown as the modal heading) but banners
  // have no title field in the UI — making it universally required was the
  // bug that made every banner creation 400.
  .refine((data) => data.type !== "modal" || !!data.title?.trim(), {
    message: "Title is required for modal announcements",
    path: ["title"],
  });

interface DbRow {
  id: string;
  title: string | null;
  content: string;
  content_type: string;
  link_url?: string | null;
  is_active: boolean;
  target_plans: string[] | null;
  target_roles: string[] | null;
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Compute the admin-facing status from is_active + starts_at, matching what the UI's 3-way select means. */
function computeStatus(row: DbRow): "active" | "inactive" | "scheduled" {
  if (!row.is_active) return "inactive";
  if (row.starts_at && new Date(row.starts_at).getTime() > Date.now()) return "scheduled";
  return "active";
}

function toApiAnnouncement(type: "modal" | "banner", row: DbRow) {
  return {
    id: row.id,
    type,
    title: row.title ?? undefined,
    content: row.content,
    status: computeStatus(row),
    audience: {
      plans: row.target_plans ?? [],
      roles: row.target_roles ?? [],
    },
    startAt: row.starts_at,
    endAt: row.ends_at,
    displayOrder: row.display_order,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/announcements?type=modal|banner
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { searchParams } = new URL(req.url);
    const type: "modal" | "banner" = searchParams.get("type") === "banner" ? "banner" : "modal";

    const { rows } = await db.query<DbRow>(
      type === "modal"
        ? `SELECT id, title, content, content_type, is_active,
                  COALESCE(target_plans, '{}')::text[] AS target_plans,
                  COALESCE(target_roles, '{}')::text[] AS target_roles,
                  display_order, starts_at, ends_at, created_at, updated_at
           FROM announcement_modals
           WHERE deleted_at IS NULL
           ORDER BY display_order ASC, created_at DESC`
        : `SELECT id, title, content, content_type, link_url, is_active,
                  COALESCE(target_plans, '{}')::text[] AS target_plans,
                  COALESCE(target_roles, '{}')::text[] AS target_roles,
                  display_order, starts_at, ends_at, created_at, updated_at
           FROM announcement_banners
           WHERE deleted_at IS NULL
           ORDER BY display_order ASC, created_at DESC`
    );

    // Fetch the current display mode from x_manifest
    const dmKey = type === "modal" ? "announcement_modal_display_mode" : "announcement_banner_mode";
    const rawDm = await getManifestValue(dmKey);
    const displayMode = (rawDm ?? '"serial"').replace(/^"|"$/g, "");

    return NextResponse.json({
      announcements: rows.map((r) => toApiAnnouncement(type, r)),
      displayMode,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/announcements
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid announcement payload", parsed.error.flatten());
    }

    const { type, title, content: rawContent, contentType, linkUrl, startAt, endAt, audience, displayOrder, status } =
      parsed.data;

    const content = sanitizeAnnouncementContent(rawContent, contentType);
    const isActive = status !== "inactive";

    if (type === "modal") {
      const { rows: countRows } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM announcement_modals WHERE deleted_at IS NULL`
      );
      if (parseInt(countRows[0]?.count ?? "0", 10) >= MAX_MODALS) {
        throw badRequest(`Cannot create modal: already at maximum of ${MAX_MODALS} modals. Delete one first.`);
      }

      const { rows } = await db.query<DbRow>(
        `INSERT INTO announcement_modals
           (title, content, content_type, is_active,
            target_plans, target_roles, display_order,
            starts_at, ends_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING id, title, content, content_type, is_active,
                   COALESCE(target_plans, '{}')::text[] AS target_plans,
                   COALESCE(target_roles, '{}')::text[] AS target_roles,
                   display_order, starts_at, ends_at, created_at, updated_at`,
        [
          title ?? null, content, contentType, isActive,
          audience.plans, audience.roles,
          displayOrder, startAt ?? null, endAt ?? null, auth.user.sub,
        ]
      );
      return NextResponse.json({ announcement: toApiAnnouncement("modal", rows[0]) }, { status: 201 });
    } else {
      const { rows: countRows } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM announcement_banners WHERE deleted_at IS NULL`
      );
      if (parseInt(countRows[0]?.count ?? "0", 10) >= MAX_BANNERS) {
        throw badRequest(`Cannot create banner: already at maximum of ${MAX_BANNERS} banners. Delete one first.`);
      }

      const { rows } = await db.query<DbRow>(
        `INSERT INTO announcement_banners
           (title, content, content_type, link_url, is_active,
            target_plans, target_roles, display_order,
            starts_at, ends_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
         RETURNING id, title, content, content_type, link_url, is_active,
                   COALESCE(target_plans, '{}')::text[] AS target_plans,
                   COALESCE(target_roles, '{}')::text[] AS target_roles,
                   display_order, starts_at, ends_at, created_at, updated_at`,
        [
          title ?? null, content, contentType, linkUrl ?? null, isActive,
          audience.plans, audience.roles,
          displayOrder, startAt ?? null, endAt ?? null, auth.user.sub,
        ]
      );
      return NextResponse.json({ announcement: toApiAnnouncement("banner", rows[0]) }, { status: 201 });
    }
  } catch (err) {
    return handleApiError(err);
  }
});
