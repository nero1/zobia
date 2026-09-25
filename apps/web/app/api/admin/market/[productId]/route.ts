export const dynamic = 'force-dynamic';

/**
 * app/api/admin/market/[productId]/route.ts
 *
 * PATCH /api/admin/market/:productId — toggle a creator item's Market
 * promotion flags (is_admin_featured, is_sponsored + sponsored_until).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";

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

      const updates: Partial<typeof schema.merchProducts.$inferInsert> = {};
      if (body.isAdminFeatured !== undefined) updates.isAdminFeatured = body.isAdminFeatured;
      if (body.isSponsored !== undefined) updates.isSponsored = body.isSponsored;
      if (body.sponsoredUntil !== undefined) {
        updates.sponsoredUntil = body.sponsoredUntil === null ? null : new Date(body.sponsoredUntil);
      }
      if (Object.keys(updates).length === 0) throw badRequest("No fields to update");
      updates.updatedAt = new Date();

      const orm = await getDb();
      const [row] = await orm
        .update(schema.merchProducts)
        .set(updates)
        .where(eq(schema.merchProducts.id, productId))
        .returning({ id: schema.merchProducts.id });
      if (!row) throw notFound("Product not found");

      return NextResponse.json({ success: true, data: { id: productId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
