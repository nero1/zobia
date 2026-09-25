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
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlashXPEventRow {
  id: string;
  name: string;
  description: string | null;
  xp_multiplier: string | null;
  starts_at: Date;
  ends_at: Date;
  is_active: boolean | null;
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
    const orm = await getDb();
    const selectCols = {
      id: schema.platformEvents.id,
      name: schema.platformEvents.name,
      description: schema.platformEvents.description,
      xp_multiplier: schema.platformEvents.xpMultiplier,
      starts_at: schema.platformEvents.startsAt,
      ends_at: schema.platformEvents.endsAt,
      is_active: schema.platformEvents.isActive,
    };

    // Active flash XP events
    const activeRows = await orm
      .select(selectCols)
      .from(schema.platformEvents)
      .where(
        and(
          eq(schema.platformEvents.eventType, "flash_xp"),
          eq(schema.platformEvents.isActive, true),
          gt(schema.platformEvents.endsAt, sql`NOW()`)
        )
      )
      .orderBy(asc(schema.platformEvents.startsAt));

    // Upcoming flash XP events (not yet started, but starting within 24 hours)
    const upcomingRows = await orm
      .select(selectCols)
      .from(schema.platformEvents)
      .where(
        and(
          eq(schema.platformEvents.eventType, "flash_xp"),
          gt(schema.platformEvents.startsAt, sql`NOW()`),
          lte(schema.platformEvents.startsAt, sql`NOW() + INTERVAL '24 hours'`)
        )
      )
      .orderBy(asc(schema.platformEvents.startsAt));

    const toEvent = (row: FlashXPEventRow): FlashXPEvent => ({
      id: row.id,
      title: row.name,
      description: row.description,
      multiplier: parseFloat(row.xp_multiplier ?? "1.0"),
      startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : row.starts_at,
      endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : row.ends_at,
      isActive: row.is_active ?? false,
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
