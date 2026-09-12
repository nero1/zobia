export const dynamic = 'force-dynamic';

/**
 * app/api/admin/market/[productId]/route.ts
 *
 * PATCH /api/admin/market/:productId — toggle a creator item's Market
 * promotion flags (is_admin_featured, is_sponsored + sponsored_until).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import type { SqlParam } from "@/lib/db/interface";

const updateSchema = z.object({
  isAdminFeatured: z.boolean().optional(),
  isSponsored: z.boolean().optional(),
  /** ISO date the sponsorship expires; null clears it (immediate un-sponsor next read). */
  sponsoredUntil: z.string().datetime().nullable().optional(),
});

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params }: { params: Promise<{ productId: string }> }) => {
    try {
      const { productId } = await params;
      const body = await validateBody(req, updateSchema);

      const sets: string[] = [];
      const values: SqlParam[] = [];
      if (body.isAdminFeatured !== undefined) {
        values.push(body.isAdminFeatured);
        sets.push(`is_admin_featured = $${values.length}`);
      }
      if (body.isSponsored !== undefined) {
        values.push(body.isSponsored);
        sets.push(`is_sponsored = $${values.length}`);
      }
      if (body.sponsoredUntil !== undefined) {
        values.push(body.sponsoredUntil);
        sets.push(`sponsored_until = $${values.length}`);
      }
      if (sets.length === 0) throw badRequest("No fields to update");
      values.push(productId);

      const { rows } = await db.query(
        `UPDATE merch_products SET ${sets.join(", ")}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING id`,
        values
      );
      if (!rows[0]) throw notFound("Product not found");

      return NextResponse.json({ success: true, data: { id: productId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
