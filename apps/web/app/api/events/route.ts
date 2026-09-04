export const dynamic = 'force-dynamic';

/**
 * app/api/events/route.ts
 *
 * Platform events endpoint.
 *
 * GET /api/events
 *   List currently-live AND upcoming (scheduled) platform events — anything
 *   admin has marked active that hasn't ended yet. `is_active` in the
 *   response means "currently live" (starts_at has passed, ends_at has not),
 *   not merely the admin's raw enable/disable flag — a future-scheduled
 *   event is included here but with is_active: false so the client can
 *   render it under "Upcoming" instead of "Active Now".
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
  is_live: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

/**
 * Return all admin-enabled platform events that haven't ended yet (live now
 * or scheduled to start soon). No auth required — this is what promotes
 * events near the top of various pages.
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
         (starts_at <= NOW() AND ends_at > NOW()) AS is_live,
         created_at
       FROM platform_events
       WHERE is_active = TRUE AND ends_at > NOW()
       ORDER BY starts_at ASC`
    );

    const events = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      event_type: row.event_type,
      xp_multiplier: row.xp_multiplier,
      coin_bonus_pct: row.coin_bonus_pct,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      target_cities: row.target_cities,
      // Kept as `is_active` for backward compatibility with existing consumers
      // (app/(app)/events/page.tsx), but now means "currently live", not the
      // raw admin toggle — see doc comment above.
      is_active: row.is_live,
      created_at: row.created_at,
    }));

    return NextResponse.json({ success: true, data: { events }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
