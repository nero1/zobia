export const dynamic = 'force-dynamic';

/**
 * app/api/admin/store-items/route.ts
 *
 * GET /api/admin/store-items — list platform store items (coin/star packs,
 * cosmetics/themes) so admin can search one to feature on the Market page.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface AdminStoreItemRow {
  id: string;
  name: string;
  item_type: string;
  cosmetic_type: string | null;
  is_active: boolean;
  is_featured: boolean;
}

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const orm = await getDb();
    const { rows } = await orm.execute<AdminStoreItemRow & Record<string, unknown>>(sql`
      SELECT id, name, item_type, cosmetic_type, is_active, is_featured
       FROM store_items
       WHERE (${q} = '' OR name ILIKE '%' || ${q} || '%')
       ORDER BY item_type ASC, sort_order ASC
       LIMIT 100
    `);
    return NextResponse.json({ success: true, data: { items: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
