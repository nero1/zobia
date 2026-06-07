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
import { db } from "@/lib/db";

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
export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query(
      `SELECT
         id, title, content, content_type, is_active,
         target_plans, target_roles, display_order,
         starts_at, ends_at, created_at, updated_at
       FROM announcement_modals
       WHERE deleted_at IS NULL
       ORDER BY display_order ASC, created_at DESC`
    );

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
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = CreateModalSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid modal payload", parsed.error.flatten());
    }

    // Enforce modal cap
    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM announcement_modals WHERE deleted_at IS NULL`
    );
    const currentCount = parseInt(countRows[0]?.count ?? "0", 10);
    if (currentCount >= MAX_MODALS) {
      throw badRequest(
        `Cannot create modal: already at maximum of ${MAX_MODALS} modals. Delete one first.`
      );
    }

    const {
      title,
      content,
      contentType,
      startsAt,
      endsAt,
      targetPlans,
      targetRoles,
      displayOrder,
    } = parsed.data;

    const { rows } = await db.query(
      `INSERT INTO announcement_modals
         (title, content, content_type, is_active,
          target_plans, target_roles, display_order,
          starts_at, ends_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        title,
        content,
        contentType,
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
