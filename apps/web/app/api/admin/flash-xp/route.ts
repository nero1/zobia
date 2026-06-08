export const dynamic = 'force-dynamic';

/**
 * app/api/admin/flash-xp/route.ts
 *
 * Admin Flash XP events management.
 *
 * GET /api/admin/flash-xp
 *   List all flash XP events from flash_xp_events table (admin only).
 *
 * POST /api/admin/flash-xp
 *   Create a new flash XP event.
 *   Body: { name, description?, announced_at, fires_at, ends_at, multiplier }
 *   Constraints: announced_at < fires_at, fires_at < ends_at,
 *                fires_at - announced_at >= 6 hours (PRD §2.4).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createFlashXpSchema = z.object({
  name: z.string().min(3).max(150),
  description: z.string().max(500).optional(),
  announced_at: z.string().datetime(),
  fires_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  multiplier: z.number().min(1.0).max(5.0).default(2.0),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlashXpEventRow {
  id: string;
  name: string;
  description: string | null;
  announced_at: string;
  fires_at: string;
  ends_at: string;
  multiplier: string;
  is_active: boolean;
  fired: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/flash-xp
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<FlashXpEventRow>(
      `SELECT id, name, description,
              announced_at, fires_at, ends_at,
              multiplier::TEXT AS multiplier,
              is_active, fired, created_at
       FROM flash_xp_events
       ORDER BY announced_at DESC`
    );

    const events = rows.map((row) => ({
      ...row,
      multiplier: parseFloat(row.multiplier),
    }));

    return NextResponse.json({ success: true, data: { events }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/flash-xp
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createFlashXpSchema);

    const announcedAt = new Date(body.announced_at);
    const firesAt = new Date(body.fires_at);
    const endsAt = new Date(body.ends_at);

    if (announcedAt >= firesAt) {
      throw badRequest("announced_at must be before fires_at");
    }

    if (firesAt >= endsAt) {
      throw badRequest("fires_at must be before ends_at");
    }

    // PRD §2.4: Flash events announced 6 hours in advance of firing
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (firesAt.getTime() - announcedAt.getTime() < SIX_HOURS_MS) {
      throw badRequest(
        "fires_at must be at least 6 hours after announced_at per platform policy"
      );
    }

    const { rows } = await db.query<FlashXpEventRow>(
      `INSERT INTO flash_xp_events
         (name, description, announced_at, fires_at, ends_at,
          multiplier, is_active, fired, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, NOW())
       RETURNING id, name, description,
                 announced_at, fires_at, ends_at,
                 multiplier::TEXT AS multiplier,
                 is_active, fired, created_at`,
      [
        body.name,
        body.description ?? null,
        body.announced_at,
        body.fires_at,
        body.ends_at,
        body.multiplier,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          event: {
            ...rows[0],
            multiplier: parseFloat(rows[0].multiplier),
          },
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
