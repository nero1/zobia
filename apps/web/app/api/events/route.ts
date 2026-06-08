export const dynamic = 'force-dynamic';

/**
 * app/api/events/route.ts
 *
 * Platform events endpoint.
 *
 * GET /api/events
 *   List all currently active platform events.
 *   An event is active when `is_active = TRUE AND ends_at > NOW()`.
 *   No authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PlatformEventRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  xp_multiplier: number;
  coin_bonus_pct: number;
  starts_at: string;
  ends_at: string;
  target_cities: string[] | null;
  is_active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

/**
 * Return all active platform events (no auth required).
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { rows } = await db.query<PlatformEventRow>(
      `SELECT
         id,
         name,
         description,
         event_type,
         xp_multiplier,
         coin_bonus_pct,
         starts_at,
         ends_at,
         target_cities,
         is_active,
         created_at
       FROM platform_events
       WHERE is_active = TRUE AND ends_at > NOW()
       ORDER BY starts_at ASC`
    );

    return NextResponse.json({ success: true, data: { events: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
