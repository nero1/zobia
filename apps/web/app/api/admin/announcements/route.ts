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
import { and, desc, isNull, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { getDb, schema } from "@/lib/db/drizzle";
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
        genders: z.array(z.enum(["male", "female", "non_binary", "prefer_not_to_say"])).default([]),
      })
      .default({ plans: [], roles: [], genders: [] }),
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
  isActive: boolean | null;
  targetPlans: string[] | null;
  targetRoles: string[] | null;
  targetGenders: string[] | null;
  displayOrder: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}

/** Compute the admin-facing status from is_active + starts_at, matching what the UI's 3-way select means. */
function computeStatus(row: DbRow): "active" | "inactive" | "scheduled" {
  if (!row.isActive) return "inactive";
  if (row.startsAt && new Date(row.startsAt).getTime() > Date.now()) return "scheduled";
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
      plans: row.targetPlans ?? [],
      roles: row.targetRoles ?? [],
      genders: row.targetGenders ?? [],
    },
    startAt: row.startsAt,
    endAt: row.endsAt,
    displayOrder: row.displayOrder,
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

    const orm = await getDb();
    const rows: DbRow[] =
      type === "modal"
        ? await orm
            .select({
              id: schema.announcementModals.id,
              title: schema.announcementModals.title,
              content: schema.announcementModals.content,
              isActive: schema.announcementModals.isActive,
              targetPlans: schema.announcementModals.targetPlans,
              targetRoles: schema.announcementModals.targetRoles,
              targetGenders: schema.announcementModals.targetGenders,
              displayOrder: schema.announcementModals.displayOrder,
              startsAt: schema.announcementModals.startsAt,
              endsAt: schema.announcementModals.endsAt,
            })
            .from(schema.announcementModals)
            .where(isNull(schema.announcementModals.deletedAt))
            .orderBy(schema.announcementModals.displayOrder, desc(schema.announcementModals.createdAt))
        : await orm
            .select({
              id: schema.announcementBanners.id,
              title: schema.announcementBanners.title,
              content: schema.announcementBanners.content,
              isActive: schema.announcementBanners.isActive,
              targetPlans: schema.announcementBanners.targetPlans,
              targetRoles: schema.announcementBanners.targetRoles,
              targetGenders: schema.announcementBanners.targetGenders,
              displayOrder: schema.announcementBanners.displayOrder,
              startsAt: schema.announcementBanners.startsAt,
              endsAt: schema.announcementBanners.endsAt,
            })
            .from(schema.announcementBanners)
            .where(isNull(schema.announcementBanners.deletedAt))
            .orderBy(schema.announcementBanners.displayOrder, desc(schema.announcementBanners.createdAt));

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
    const orm = await getDb();

    if (type === "modal") {
      const [{ count: modalCount }] = await orm
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.announcementModals)
        .where(isNull(schema.announcementModals.deletedAt));
      if (parseInt(modalCount ?? "0", 10) >= MAX_MODALS) {
        throw badRequest(`Cannot create modal: already at maximum of ${MAX_MODALS} modals. Delete one first.`);
      }

      const [row] = await orm
        .insert(schema.announcementModals)
        .values({
          // Guaranteed non-empty by the schema's .refine() above for type === "modal".
          title: title as string,
          content,
          contentType,
          isActive,
          targetPlans: audience.plans,
          targetRoles: audience.roles,
          targetGenders: audience.genders,
          displayOrder,
          startsAt: startAt ? new Date(startAt) : null,
          endsAt: endAt ? new Date(endAt) : null,
          createdBy: auth.user.sub,
        })
        .returning({
          id: schema.announcementModals.id,
          title: schema.announcementModals.title,
          content: schema.announcementModals.content,
          isActive: schema.announcementModals.isActive,
          targetPlans: schema.announcementModals.targetPlans,
          targetRoles: schema.announcementModals.targetRoles,
          targetGenders: schema.announcementModals.targetGenders,
          displayOrder: schema.announcementModals.displayOrder,
          startsAt: schema.announcementModals.startsAt,
          endsAt: schema.announcementModals.endsAt,
        });
      return NextResponse.json({ announcement: toApiAnnouncement("modal", row as DbRow) }, { status: 201 });
    } else {
      const [{ count: bannerCount }] = await orm
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.announcementBanners)
        .where(isNull(schema.announcementBanners.deletedAt));
      if (parseInt(bannerCount ?? "0", 10) >= MAX_BANNERS) {
        throw badRequest(`Cannot create banner: already at maximum of ${MAX_BANNERS} banners. Delete one first.`);
      }

      const [row] = await orm
        .insert(schema.announcementBanners)
        .values({
          title: title ?? null,
          content,
          contentType,
          linkUrl: linkUrl ?? null,
          isActive,
          targetPlans: audience.plans,
          targetRoles: audience.roles,
          targetGenders: audience.genders,
          displayOrder,
          startsAt: startAt ? new Date(startAt) : null,
          endsAt: endAt ? new Date(endAt) : null,
          createdBy: auth.user.sub,
        })
        .returning({
          id: schema.announcementBanners.id,
          title: schema.announcementBanners.title,
          content: schema.announcementBanners.content,
          isActive: schema.announcementBanners.isActive,
          targetPlans: schema.announcementBanners.targetPlans,
          targetRoles: schema.announcementBanners.targetRoles,
          targetGenders: schema.announcementBanners.targetGenders,
          displayOrder: schema.announcementBanners.displayOrder,
          startsAt: schema.announcementBanners.startsAt,
          endsAt: schema.announcementBanners.endsAt,
        });
      return NextResponse.json({ announcement: toApiAnnouncement("banner", row as DbRow) }, { status: 201 });
    }
  } catch (err) {
    return handleApiError(err);
  }
});
