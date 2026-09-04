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
import { db } from "@/lib/db";
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
  xp_multiplier: string;
  coin_bonus_pct: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  recurrence_interval: string;
  target_cities: string[] | null;
  created_at: string;
  updated_at: string;
}

function toApiEvent(row: PlatformEventRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.event_type ?? "platform",
    xpMultiplier: parseFloat(row.xp_multiplier),
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

const SELECT_COLUMNS = `id, name, description, event_type,
                  xp_multiplier::TEXT AS xp_multiplier,
                  coin_bonus_pct, starts_at, ends_at,
                  is_active, recurrence_interval, target_cities, created_at, updated_at`;

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

      const updates: string[] = [];
      const params2: (string | number | boolean | null)[] = [];
      let idx = 1;

      const fieldMap: [keyof typeof body, string][] = [
        ["is_active", "is_active"],
        ["starts_at", "starts_at"],
        ["ends_at", "ends_at"],
        ["name", "name"],
        ["description", "description"],
        ["event_type", "event_type"],
        ["xp_multiplier", "xp_multiplier"],
        ["coin_bonus_pct", "coin_bonus_pct"],
        ["recurrence_interval", "recurrence_interval"],
      ];

      for (const [key, column] of fieldMap) {
        const value = body[key];
        if (value !== undefined) {
          updates.push(`${column} = $${idx++}`);
          params2.push(value as string | number | boolean);
        }
      }

      if (updates.length === 0) {
        const { rows } = await db.query<PlatformEventRow>(
          `SELECT ${SELECT_COLUMNS} FROM platform_events WHERE id = $1 LIMIT 1`,
          [eventId]
        );
        if (!rows[0]) throw notFound("Platform event not found");
        return NextResponse.json({ success: true, data: { event: toApiEvent(rows[0]) }, error: null });
      }

      updates.push(`updated_at = NOW()`);
      params2.push(eventId);

      const { rows } = await db.query<PlatformEventRow>(
        `UPDATE platform_events
         SET ${updates.join(", ")}
         WHERE id = $${idx}
         RETURNING ${SELECT_COLUMNS}`,
        params2
      );

      if (!rows[0]) throw notFound("Platform event not found");

      return NextResponse.json({ success: true, data: { event: toApiEvent(rows[0]) }, error: null });
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

      const { rows } = await db.query<{ id: string }>(
        `UPDATE platform_events
         SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [eventId]
      );

      if (!rows[0]) throw notFound("Platform event not found");

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
