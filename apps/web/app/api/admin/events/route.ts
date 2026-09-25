export const dynamic = 'force-dynamic';

/**
 * app/api/admin/events/route.ts
 *
 * Admin platform events management.
 *
 * GET /api/admin/events
 *   List all platform events (admin only). Returns camelCase fields matching
 *   the admin UI's PlatformEvent type — see app/(admin)/gate44/events/page.tsx.
 *
 * POST /api/admin/events
 *   Create a platform event, optionally scheduled for the future and/or
 *   recurring monthly or yearly.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  recurrence_interval: z.enum(["none", "monthly", "yearly"]).default("none"),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformEventRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  xp_multiplier: string | null;
  coin_bonus_pct: number | null;
  starts_at: Date | string;
  ends_at: Date | string;
  is_active: boolean | null;
  recurrence_interval: string;
  target_cities: string[] | null;
  metadata: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

/** Shape returned to the admin UI — matches PlatformEvent in gate44/events/page.tsx. */
function toApiEvent(row: PlatformEventRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.event_type ?? "platform",
    xpMultiplier: parseFloat(row.xp_multiplier ?? "1.0"),
    coinBonusPct: row.coin_bonus_pct,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
    recurrenceInterval: row.recurrence_interval,
    targetCities: row.target_cities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_SHAPE = {
  id: schema.platformEvents.id,
  name: schema.platformEvents.name,
  description: schema.platformEvents.description,
  event_type: schema.platformEvents.eventType,
  xp_multiplier: sql<string>`${schema.platformEvents.xpMultiplier}::TEXT`,
  coin_bonus_pct: schema.platformEvents.coinBonusPct,
  starts_at: schema.platformEvents.startsAt,
  ends_at: schema.platformEvents.endsAt,
  is_active: schema.platformEvents.isActive,
  recurrence_interval: schema.platformEvents.recurrenceInterval,
  target_cities: schema.platformEvents.targetCities,
  metadata: schema.platformEvents.metadata,
  created_at: schema.platformEvents.createdAt,
  updated_at: schema.platformEvents.updatedAt,
};

// ---------------------------------------------------------------------------
// GET /api/admin/events
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const orm = await getDb();
    const rows = await orm
      .select(SELECT_SHAPE)
      .from(schema.platformEvents)
      .orderBy(desc(schema.platformEvents.startsAt));

    return NextResponse.json({
      success: true,
      data: { events: rows.map((r) => toApiEvent(r as unknown as PlatformEventRow)) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/events
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createEventSchema);

    const orm = await getDb();
    const [inserted] = await orm
      .insert(schema.platformEvents)
      .values({
        name: body.name,
        description: body.description ?? null,
        eventType: body.event_type,
        xpMultiplier: String(body.xp_multiplier),
        coinBonusPct: body.coin_bonus_pct,
        startsAt: new Date(body.starts_at),
        endsAt: new Date(body.ends_at),
        isActive: true,
        recurrenceInterval: body.recurrence_interval,
        targetCities: body.target_cities ?? null,
        createdBy: auth.user.sub,
      })
      .returning(SELECT_SHAPE);

    return NextResponse.json(
      { success: true, data: { event: toApiEvent(inserted as unknown as PlatformEventRow) }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
