export const dynamic = 'force-dynamic';

/**
 * app/api/events/flash-xp/route.ts
 *
 * Flash XP Events user-facing API.
 *
 * GET /api/events/flash-xp
 *   - Returns currently active flash XP events
 *     (type = 'flash_xp', is_active = TRUE, ends_at > NOW())
 *   - Also returns upcoming flash XP events starting within the next 24 hours
 *   - No authentication required — this is publicly cacheable
 *
 * Response:
 * {
 *   active:   FlashXPEvent[],
 *   upcoming: FlashXPEvent[],
 * }
 *
 * Each event: { id, title, multiplier, starts_at, ends_at, is_active }
 *
 * This is separate from the admin events API and the generic /api/events
 * endpoint. It provides a focused, client-optimised view for the Expo app's
 * XP multiplier banner and countdown timer.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlashXPEventRow {
  id: string;
  name: string;
  description: string | null;
  xp_multiplier: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

interface FlashXPEvent {
  id: string;
  title: string;
  description: string | null;
  multiplier: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/events/flash-xp
// ---------------------------------------------------------------------------

/**
 * Return active and upcoming flash XP events.
 *
 * Active:   event_type = 'flash_xp', is_active = TRUE, ends_at > NOW()
 * Upcoming: event_type = 'flash_xp', starts_at within the next 24 hours,
 *           and the event has not yet started (starts_at > NOW())
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    // Active flash XP events
    const { rows: activeRows } = await db.query<FlashXPEventRow>(
      `SELECT
         id,
         name,
         description,
         xp_multiplier,
         starts_at,
         ends_at,
         is_active
       FROM platform_events
       WHERE event_type = 'flash_xp'
         AND is_active = TRUE
         AND ends_at > NOW()
       ORDER BY starts_at ASC`
    );

    // Upcoming flash XP events (not yet started, but starting within 24 hours)
    const { rows: upcomingRows } = await db.query<FlashXPEventRow>(
      `SELECT
         id,
         name,
         description,
         xp_multiplier,
         starts_at,
         ends_at,
         is_active
       FROM platform_events
       WHERE event_type = 'flash_xp'
         AND starts_at > NOW()
         AND starts_at <= NOW() + INTERVAL '24 hours'
       ORDER BY starts_at ASC`
    );

    const toEvent = (row: FlashXPEventRow): FlashXPEvent => ({
      id: row.id,
      title: row.name,
      description: row.description,
      multiplier: row.xp_multiplier,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isActive: row.is_active,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          active: activeRows.map(toEvent),
          upcoming: upcomingRows.map(toEvent),
        },
        error: null,
      },
      {
        status: 200,
        headers: {
          // Cache for 60 seconds — short enough to pick up newly activated events
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
