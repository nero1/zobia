export const dynamic = 'force-dynamic';

/**
 * app/api/admin/events/[eventId]/route.ts
 *
 * PATCH /api/admin/events/:eventId
 *   Update any subset of an event's fields (name, dates, type, XP multiplier,
 *   recurrence, active state). Admin only.
 *
 * DELETE /api/admin/events/:eventId
 *   Deactivate event (set is_active = false). Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const updateEventSchema = z.object({
  is_active: z.boolean().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  name: z.string().min(3).max(150).optional(),
  description: z.string().max(1000).optional(),
  event_type: z.enum([
    "cultural",
    "season_launch",
    "flash_xp",
    "guild_war_event",
    "mystery_drop",
    "platform",
  ]).optional(),
  xp_multiplier: z.number().min(0.5).max(10).optional(),
  coin_bonus_pct: z.number().int().min(0).max(100).optional(),
  recurrence_interval: z.enum(["none", "monthly", "yearly"]).optional(),
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
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

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
  created_at: schema.platformEvents.createdAt,
  updated_at: schema.platformEvents.updatedAt,
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/events/:eventId
// ---------------------------------------------------------------------------

export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { eventId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { eventId } = await params;
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const body = await validateBody(req, updateEventSchema);
      const orm = await getDb();
      const pe = schema.platformEvents;

      const updates: Partial<typeof pe.$inferInsert> = {};
      if (body.is_active !== undefined) updates.isActive = body.is_active;
      if (body.starts_at !== undefined) updates.startsAt = new Date(body.starts_at);
      if (body.ends_at !== undefined) updates.endsAt = new Date(body.ends_at);
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;
      if (body.event_type !== undefined) updates.eventType = body.event_type;
      if (body.xp_multiplier !== undefined) updates.xpMultiplier = String(body.xp_multiplier);
      if (body.coin_bonus_pct !== undefined) updates.coinBonusPct = body.coin_bonus_pct;
      if (body.recurrence_interval !== undefined) updates.recurrenceInterval = body.recurrence_interval;

      if (Object.keys(updates).length === 0) {
        const [row] = await orm
          .select(SELECT_SHAPE)
          .from(pe)
          .where(eq(pe.id, eventId))
          .limit(1);
        if (!row) throw notFound("Platform event not found");
        return NextResponse.json({ success: true, data: { event: toApiEvent(row as unknown as PlatformEventRow) }, error: null });
      }

      updates.updatedAt = new Date();

      const [updated] = await orm
        .update(pe)
        .set(updates)
        .where(eq(pe.id, eventId))
        .returning(SELECT_SHAPE);

      if (!updated) throw notFound("Platform event not found");

      return NextResponse.json({ success: true, data: { event: toApiEvent(updated as unknown as PlatformEventRow) }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/events/:eventId
// ---------------------------------------------------------------------------

export const DELETE = withAdminAuth(
  async (
    _req: NextRequest,
    {
      params,
      auth,
    }: { params: { eventId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { eventId } = await params;
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const orm = await getDb();
      const [updated] = await orm
        .update(schema.platformEvents)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.platformEvents.id, eventId))
        .returning({ id: schema.platformEvents.id });

      if (!updated) throw notFound("Platform event not found");

      return NextResponse.json({
        success: true,
        data: { eventId, deactivated: true },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
