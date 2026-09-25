export const dynamic = 'force-dynamic';

/**
 * app/api/admin/store-items/[itemId]/route.ts
 *
 * PATCH /api/admin/store-items/:itemId — toggle a platform store_items row's
 * is_featured flag (used by the Market page's "Featured" section). No admin
 * UI previously existed for this — store_items.is_featured could only be set
 * via seed/migration.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

const updateSchema = z.object({
  isFeatured: z.boolean(),
});

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) => {
    try {
      const { itemId } = await params;
      const body = await validateBody(req, updateSchema);

      const orm = await getDb();
      const rows = await orm
        .update(schema.storeItems)
        .set({ isFeatured: body.isFeatured })
        .where(eq(schema.storeItems.id, itemId))
        .returning({ id: schema.storeItems.id });
      if (!rows[0]) throw notFound("Store item not found");

      return NextResponse.json({ success: true, data: { id: itemId }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
