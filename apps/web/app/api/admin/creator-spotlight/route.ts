export const dynamic = 'force-dynamic';

/**
 * app/api/admin/creator-spotlight/route.ts
 *
 * Admin endpoints for the Creator of the Month Spotlight (PRD §25).
 *
 * GET  /api/admin/creator-spotlight
 *   Return all spotlights (current + past) joined with creator user info,
 *   ordered by month_year descending.
 *
 * POST /api/admin/creator-spotlight
 *   Create a new monthly spotlight.
 *   Body: { creatorId: string, monthYear: string (YYYY-MM), blurb?: string }
 *   - Admin only.
 *   - Validates that the creator user exists.
 *   - Validates monthYear format.
 *   - Enforces one spotlight per calendar month (UNIQUE constraint + pre-check).
 *   - Marks the new spotlight as is_active = true when it is the current month,
 *     and deactivates any previously active spotlight first.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSpotlightSchema = z.object({
  creatorId: z.string().uuid("creatorId must be a valid UUID"),
  monthYear: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthYear must be in YYYY-MM format"),
  blurb: z.string().max(500, "blurb must be 500 characters or fewer").optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface SpotlightRow {
  id: string;
  creator_id: string;
  month_year: string;
  blurb: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  // joined from users (creator)
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  // joined from users (admin who created)
  admin_username: string | null;
}

async function fetchSpotlightRow(orm: Awaited<ReturnType<typeof getDb>>, id: string) {
  const creator = alias(schema.users, "creator");
  const admin = alias(schema.users, "admin");
  const cs = schema.creatorSpotlights;

  const [row] = await orm
    .select({
      id: cs.id,
      creator_id: cs.creatorId,
      month_year: cs.monthYear,
      blurb: cs.blurb,
      is_active: cs.isActive,
      created_at: cs.createdAt,
      created_by: cs.createdBy,
      creator_username: creator.username,
      creator_display_name: creator.displayName,
      creator_avatar_url: creator.avatarUrl,
      admin_username: admin.username,
    })
    .from(cs)
    .leftJoin(creator, eq(creator.id, cs.creatorId))
    .leftJoin(admin, eq(admin.id, cs.createdBy))
    .where(eq(cs.id, id))
    .limit(1);

  return row;
}

// ---------------------------------------------------------------------------
// GET /api/admin/creator-spotlight
// ---------------------------------------------------------------------------

/**
 * List all creator spotlights with creator and admin info.
 *
 * @returns JSON { spotlights: SpotlightRow[] }
 */
export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const orm = await getDb();
    const creator = alias(schema.users, "creator");
    const admin = alias(schema.users, "admin");
    const cs = schema.creatorSpotlights;

    const rows = await orm
      .select({
        id: cs.id,
        creator_id: cs.creatorId,
        month_year: cs.monthYear,
        blurb: cs.blurb,
        is_active: cs.isActive,
        created_at: cs.createdAt,
        created_by: cs.createdBy,
        creator_username: creator.username,
        creator_display_name: creator.displayName,
        creator_avatar_url: creator.avatarUrl,
        admin_username: admin.username,
      })
      .from(cs)
      .leftJoin(creator, eq(creator.id, cs.creatorId))
      .leftJoin(admin, eq(admin.id, cs.createdBy))
      .orderBy(desc(cs.monthYear));

    return NextResponse.json({ spotlights: rows }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/creator-spotlight
// ---------------------------------------------------------------------------

/**
 * Create a new monthly creator spotlight.
 *
 * Validates:
 *  - creatorId points to an existing, non-deleted user.
 *  - monthYear is unique (one spotlight per month).
 *
 * When the new spotlight is for the current calendar month it is immediately
 * set as active and any existing active spotlight is deactivated.
 *
 * @returns JSON { spotlight: SpotlightRow }
 */
export const POST = withAdminAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await validateBody(req, createSpotlightSchema);

    const orm = await getDb();
    const cs = schema.creatorSpotlights;

    // Validate creator user exists
    const [creatorUser] = await orm
      .select({
        id: schema.users.id,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_url: schema.users.avatarUrl,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, body.creatorId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!creatorUser) {
      throw notFound(`User ${body.creatorId} does not exist`);
    }

    // Check for existing spotlight for this month
    const [existing] = await orm
      .select({ id: cs.id })
      .from(cs)
      .where(eq(cs.monthYear, body.monthYear))
      .limit(1);

    if (existing) {
      throw badRequest(
        `A spotlight already exists for ${body.monthYear}. Only one spotlight is allowed per month.`,
        "MONTH_ALREADY_SPOTLIGHTED"
      );
    }

    // Determine whether this spotlight should be immediately active.
    // Active = the monthYear matches the current calendar month.
    const now = new Date();
    const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const isActive = body.monthYear === currentMonthYear;

    // Run deactivation + insert in a transaction
    const newId = await orm.transaction(async (tx) => {
      if (isActive) {
        await tx.update(cs).set({ isActive: false }).where(eq(cs.isActive, true));
      }

      const [inserted] = await tx
        .insert(cs)
        .values({
          creatorId: body.creatorId,
          monthYear: body.monthYear,
          blurb: body.blurb ?? null,
          isActive,
          createdBy: ctx.auth.user.sub,
        })
        .returning({ id: cs.id });

      if (!inserted?.id) throw new Error("Insert did not return an id");
      return inserted.id;
    });

    // Fetch the full row with joins
    const fullRow = await fetchSpotlightRow(orm, newId);

    return NextResponse.json({ spotlight: fullRow }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
