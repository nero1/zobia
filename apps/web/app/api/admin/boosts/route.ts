export const dynamic = 'force-dynamic';

/**
 * app/api/admin/boosts/route.ts
 *
 * GET  /api/admin/boosts — list all boost types (active + inactive).
 * POST /api/admin/boosts — create a new boost type.
 *
 * Lets admin add new boost/multiplier types from gate44 without a code
 * deploy — app/api/economy/boosters/route.ts reads this same table.
 *
 * IMPORTANT: for a boost to be purchasable via Google Play Billing on the
 * Capacitor Android app, a matching product must also be created in Play
 * Console with the same product ID as `iapProductId` — see
 * docs/HOW-IT-WORKS.md "Boosts & Play Billing".
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, conflict } from "@/lib/api/errors";

const createBoostSchema = z.object({
  key: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/, "key must be lowercase snake_case"),
  label: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  multiplierBp: z.number().int().min(0).max(10000).default(0),
  durationHours: z.number().int().positive(),
  coinsCost: z.number().int().nonnegative().optional(),
  starsCost: z.number().int().nonnegative().optional(),
  iapProductId: z.string().max(200).optional(),
  stackable: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

interface BoostTypeRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  multiplier_bp: number;
  duration_hours: number;
  coins_cost: number | null;
  stars_cost: number | null;
  iap_product_id: string | null;
  stackable: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export const GET = withAdminAuth(async () => {
  try {
    const { rows } = await db.query<BoostTypeRow>(
      `SELECT id, key, label, description, multiplier_bp, duration_hours,
              coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_at
       FROM boost_types ORDER BY sort_order ASC, created_at ASC`
    );
    return NextResponse.json({ success: true, data: { boosts: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, createBoostSchema);

    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM boost_types WHERE key = $1 LIMIT 1`,
      [body.key]
    );
    if (existing[0]) {
      throw conflict(`A boost type with key "${body.key}" already exists`);
    }

    const { rows } = await db.query<BoostTypeRow>(
      `INSERT INTO boost_types
         (key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost,
          iap_product_id, stackable, sort_order, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING id, key, label, description, multiplier_bp, duration_hours,
                 coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_at`,
      [
        body.key,
        body.label,
        body.description ?? null,
        body.multiplierBp,
        body.durationHours,
        body.coinsCost ?? null,
        body.starsCost ?? null,
        body.iapProductId ?? null,
        body.stackable,
        body.sortOrder,
        auth.user.sub,
      ]
    );

    return NextResponse.json({ success: true, data: { boost: rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
