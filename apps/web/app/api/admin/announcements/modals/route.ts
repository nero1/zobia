export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/modals/route.ts
 *
 * GET  /api/admin/announcements/modals — List all announcement modals.
 * POST /api/admin/announcements/modals — Create a new modal (max 5 active).
 *
 * Modals are created as inactive by default. The admin must explicitly
 * activate them via the PUT endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { getDb, schema } from "@/lib/db/drizzle";
import { asc, count, desc, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateModalSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
  contentType: z.enum(["html", "markdown", "plain"]).default("plain"),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  /** Empty array = target all plans. */
  targetPlans: z.array(z.string()).default([]),
  /** Empty array = target all roles. */
  targetRoles: z.array(z.string()).default([]),
  displayOrder: z.number().int().min(0).default(0),
});

/** Maximum number of announcement modals allowed in the system. */
const MAX_MODALS = 5;

// ---------------------------------------------------------------------------
// GET /api/admin/announcements/modals
// ---------------------------------------------------------------------------

/**
 * List all announcement modals (active and inactive).
 *
 * @returns Array of all modals ordered by display_order
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.announcementModals.id,
        title: schema.announcementModals.title,
        content: schema.announcementModals.content,
        content_type: schema.announcementModals.contentType,
        is_active: schema.announcementModals.isActive,
        target_plans: schema.announcementModals.targetPlans,
        target_roles: schema.announcementModals.targetRoles,
        display_order: schema.announcementModals.displayOrder,
        starts_at: schema.announcementModals.startsAt,
        ends_at: schema.announcementModals.endsAt,
        created_at: schema.announcementModals.createdAt,
        updated_at: schema.announcementModals.updatedAt,
      })
      .from(schema.announcementModals)
      .where(isNull(schema.announcementModals.deletedAt))
      .orderBy(asc(schema.announcementModals.displayOrder), desc(schema.announcementModals.createdAt));

    return NextResponse.json({ items: rows, count: rows.length });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/announcements/modals
// ---------------------------------------------------------------------------

/**
 * Create a new announcement modal.
 *
 * Enforces a hard cap of 5 modals. Returns 400 if already at cap.
 * Created as inactive by default.
 *
 * @returns Created modal record
 */
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateModalSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid modal payload", parsed.error.flatten());
    }

    const orm = await getDb();

    // Enforce modal cap
    const [countRow] = await orm
      .select({ count: count() })
      .from(schema.announcementModals)
      .where(isNull(schema.announcementModals.deletedAt));
    const currentCount = countRow?.count ?? 0;
    if (currentCount >= MAX_MODALS) {
      throw badRequest(
        `Cannot create modal: already at maximum of ${MAX_MODALS} modals. Delete one first.`
      );
    }

    const {
      title,
      content: rawContent,
      contentType,
      startsAt,
      endsAt,
      targetPlans,
      targetRoles,
      displayOrder,
    } = parsed.data;

    const content = sanitizeAnnouncementContent(rawContent, contentType);

    const [row] = await orm
      .insert(schema.announcementModals)
      .values({
        title,
        content,
        contentType,
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
