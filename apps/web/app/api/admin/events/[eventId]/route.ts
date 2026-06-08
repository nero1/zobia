export const dynamic = 'force-dynamic';

/**
 * app/api/admin/events/[eventId]/route.ts
 *
 * PATCH /api/admin/events/:eventId
 *   Toggle event is_active, update dates. Admin only.
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
  xp_multiplier: z.number().min(0.5).max(10).optional(),
  coin_bonus_pct: z.number().int().min(0).max(100).optional(),
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
  created_at: string;
  updated_at: string;
}

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

      if (body.is_active !== undefined) {
        updates.push(`is_active = $${idx++}`);
        params2.push(body.is_active);
      }
      if (body.starts_at !== undefined) {
        updates.push(`starts_at = $${idx++}`);
        params2.push(body.starts_at);
      }
      if (body.ends_at !== undefined) {
        updates.push(`ends_at = $${idx++}`);
        params2.push(body.ends_at);
      }
      if (body.name !== undefined) {
        updates.push(`name = $${idx++}`);
        params2.push(body.name);
      }
      if (body.description !== undefined) {
        updates.push(`description = $${idx++}`);
        params2.push(body.description);
      }
      if (body.xp_multiplier !== undefined) {
        updates.push(`xp_multiplier = $${idx++}`);
        params2.push(body.xp_multiplier);
      }
      if (body.coin_bonus_pct !== undefined) {
        updates.push(`coin_bonus_pct = $${idx++}`);
        params2.push(body.coin_bonus_pct);
      }

      if (updates.length === 0) {
        const { rows } = await db.query<PlatformEventRow>(
          `SELECT id, name, description, event_type,
                  xp_multiplier::TEXT AS xp_multiplier,
                  coin_bonus_pct, starts_at, ends_at,
                  is_active, target_cities, created_at, updated_at
           FROM platform_events WHERE id = $1 LIMIT 1`,
          [eventId]
        );
        if (!rows[0]) throw notFound("Platform event not found");
        return NextResponse.json({ success: true, data: { event: rows[0] }, error: null });
      }

      updates.push(`updated_at = NOW()`);
      params2.push(eventId);

      const { rows } = await db.query<PlatformEventRow>(
        `UPDATE platform_events
         SET ${updates.join(", ")}
         WHERE id = $${idx}
         RETURNING id, name, description, event_type,
                   xp_multiplier::TEXT AS xp_multiplier,
                   coin_bonus_pct, starts_at, ends_at,
                   is_active, target_cities, created_at, updated_at`,
        params2
      );

      if (!rows[0]) throw notFound("Platform event not found");

      return NextResponse.json({
        success: true,
        data: {
          event: {
            ...rows[0],
            xpMultiplier: parseFloat(rows[0].xp_multiplier),
          },
        },
        error: null,
      });
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
