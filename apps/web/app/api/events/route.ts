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
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { handleApiError } from "@/lib/api/errors";

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
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.platformEvents.id,
        name: schema.platformEvents.name,
        description: schema.platformEvents.description,
        event_type: schema.platformEvents.eventType,
        xp_multiplier: schema.platformEvents.xpMultiplier,
        coin_bonus_pct: schema.platformEvents.coinBonusPct,
        starts_at: schema.platformEvents.startsAt,
        ends_at: schema.platformEvents.endsAt,
        target_cities: schema.platformEvents.targetCities,
        is_live: sql<boolean>`(${schema.platformEvents.startsAt} <= NOW() AND ${schema.platformEvents.endsAt} > NOW())`,
        created_at: schema.platformEvents.createdAt,
      })
      .from(schema.platformEvents)
      .where(and(eq(schema.platformEvents.isActive, true), gt(schema.platformEvents.endsAt, sql`NOW()`)))
      .orderBy(asc(schema.platformEvents.startsAt));

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
