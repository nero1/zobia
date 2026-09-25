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
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

export const GET = withAdminAuth(async () => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.boostTypes.id,
        key: schema.boostTypes.key,
        label: schema.boostTypes.label,
        description: schema.boostTypes.description,
        multiplier_bp: schema.boostTypes.multiplierBp,
        duration_hours: schema.boostTypes.durationHours,
        coins_cost: schema.boostTypes.coinsCost,
        stars_cost: schema.boostTypes.starsCost,
        iap_product_id: schema.boostTypes.iapProductId,
        stackable: schema.boostTypes.stackable,
        is_active: schema.boostTypes.isActive,
        sort_order: schema.boostTypes.sortOrder,
        created_at: schema.boostTypes.createdAt,
      })
      .from(schema.boostTypes)
      .orderBy(asc(schema.boostTypes.sortOrder), asc(schema.boostTypes.createdAt));
    return NextResponse.json({ success: true, data: { boosts: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, createBoostSchema);

    const orm = await getDb();
    const [existing] = await orm
      .select({ id: schema.boostTypes.id })
      .from(schema.boostTypes)
      .where(eq(schema.boostTypes.key, body.key))
      .limit(1);
    if (existing) {
      throw conflict(`A boost type with key "${body.key}" already exists`);
    }

    const [boost] = await orm
      .insert(schema.boostTypes)
      .values({
        key: body.key,
        label: body.label,
        description: body.description ?? null,
        multiplierBp: body.multiplierBp,
        durationHours: body.durationHours,
        coinsCost: body.coinsCost ?? null,
        starsCost: body.starsCost ?? null,
        iapProductId: body.iapProductId ?? null,
        stackable: body.stackable,
        sortOrder: body.sortOrder,
        createdBy: auth.user.sub,
      })
      .returning({
        id: schema.boostTypes.id,
        key: schema.boostTypes.key,
        label: schema.boostTypes.label,
        description: schema.boostTypes.description,
        multiplier_bp: schema.boostTypes.multiplierBp,
        duration_hours: schema.boostTypes.durationHours,
        coins_cost: schema.boostTypes.coinsCost,
        stars_cost: schema.boostTypes.starsCost,
        iap_product_id: schema.boostTypes.iapProductId,
        stackable: schema.boostTypes.stackable,
        is_active: schema.boostTypes.isActive,
        sort_order: schema.boostTypes.sortOrder,
        created_at: schema.boostTypes.createdAt,
      });

    return NextResponse.json({ success: true, data: { boost }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
