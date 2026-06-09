export const dynamic = 'force-dynamic';

/**
 * app/api/admin/events/route.ts
 *
 * Admin platform events management.
 *
 * GET /api/admin/events
 *   List all platform events (admin only).
 *
 * POST /api/admin/events
 *   Create a platform event.
 *   Body: { name, description, event_type, xp_multiplier, coin_bonus_pct,
 *           starts_at, ends_at, target_cities? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createEventSchema = z.object({
  name: z.string().min(3).max(150),
  description: z.string().max(1000).optional(),
  event_type: z.enum([
    "cultural",
    "season_launch",
    "flash_xp",
    "guild_war_event",
    "mystery_drop",
    "platform",
  ]),
  xp_multiplier: z.number().min(0.5).max(10).default(1.0),
  coin_bonus_pct: z.number().int().min(0).max(100).default(0),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  target_cities: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformEventRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  xp_multiplier: string;
  coin_bonus_pct: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  target_cities: string[] | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/events
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<PlatformEventRow>(
      `SELECT id, name, description, event_type,
              xp_multiplier::TEXT AS xp_multiplier,
              coin_bonus_pct, starts_at, ends_at,
              is_active, target_cities, metadata, created_at, updated_at
       FROM platform_events
       ORDER BY starts_at DESC`
    );

    const events = rows.map((row) => ({
      ...row,
      xpMultiplier: parseFloat(row.xp_multiplier),
    }));

    return NextResponse.json({
      success: true,
      data: { events },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/events
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createEventSchema);

    const { rows } = await db.query<PlatformEventRow>(
      `INSERT INTO platform_events
         (name, description, event_type, xp_multiplier, coin_bonus_pct,
          starts_at, ends_at, is_active, target_cities, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, NOW(), NOW())
       RETURNING id, name, description, event_type,
                 xp_multiplier::TEXT AS xp_multiplier,
                 coin_bonus_pct, starts_at, ends_at,
                 is_active, target_cities, metadata, created_at, updated_at`,
      [
        body.name,
        body.description ?? null,
        body.event_type,
        body.xp_multiplier,
        body.coin_bonus_pct,
        body.starts_at,
        body.ends_at,
        body.target_cities ?? null,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          event: {
            ...rows[0],
            xpMultiplier: parseFloat(rows[0].xp_multiplier),
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
