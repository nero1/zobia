export const dynamic = 'force-dynamic';

/**
 * app/api/admin/boosts/[boostId]/route.ts
 *
 * PATCH /api/admin/boosts/:boostId — update a boost type (e.g. toggle
 * is_active, adjust pricing, add an iapProductId after creating the
 * matching Play Console product).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";

const updateBoostSchema = z.object({
  label: z.string().min(2).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  multiplierBp: z.number().int().min(0).max(10000).optional(),
  durationHours: z.number().int().positive().optional(),
  coinsCost: z.number().int().nonnegative().nullable().optional(),
  starsCost: z.number().int().nonnegative().nullable().optional(),
  iapProductId: z.string().max(200).nullable().optional(),
  stackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params }: { params: Promise<{ boostId: string }> }) => {
    try {
      const { boostId } = await params;
      const body = await validateBody(req, updateBoostSchema);

      // NOTE: `boost_types` is not present in lib/db/schema.ts (schema/DB
      // mismatch — reported separately), so this update is expressed via the
      // `sql` template rather than the Drizzle query builder.
      const fieldMap: Record<string, string> = {
        label: "label",
        description: "description",
        multiplierBp: "multiplier_bp",
        durationHours: "duration_hours",
        coinsCost: "coins_cost",
        starsCost: "stars_cost",
        iapProductId: "iap_product_id",
        stackable: "stackable",
        isActive: "is_active",
        sortOrder: "sort_order",
      };

      const sets = [];
      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body && (body as Record<string, unknown>)[key] !== undefined) {
          const value = (body as Record<string, unknown>)[key];
          sets.push(sql`${sql.raw(column)} = ${value}`);
        }
      }
      if (sets.length === 0) {
        throw badRequest("No fields to update");
      }

      const orm = await getDb();
      const { rows } = await orm.execute<{ id: string }>(sql`
        UPDATE boost_types SET ${sql.join(sets, sql`, `)}, updated_at = NOW()
        WHERE id = ${boostId} RETURNING id
      `);
      if (!rows[0]) throw notFound("Boost type not found");

      return NextResponse.json({ success: true, data: { id: boostId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
