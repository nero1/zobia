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
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import type { SqlParam } from "@/lib/db/interface";

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

      const sets: string[] = [];
      const values: SqlParam[] = [];
      for (const [key, column] of Object.entries(fieldMap)) {
        if (key in body && (body as Record<string, unknown>)[key] !== undefined) {
          values.push((body as Record<string, unknown>)[key] as SqlParam);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (sets.length === 0) {
        throw badRequest("No fields to update");
      }
      values.push(boostId);

      const { rows } = await db.query(
        `UPDATE boost_types SET ${sets.join(", ")}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING id`,
        values
      );
      if (!rows[0]) throw notFound("Boost type not found");

      return NextResponse.json({ success: true, data: { id: boostId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
