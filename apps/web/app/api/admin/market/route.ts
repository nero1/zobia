export const dynamic = 'force-dynamic';

/**
 * app/api/admin/market/route.ts
 *
 * GET /api/admin/market — search creator items (merch_products) so admin
 * can find one to toggle is_admin_featured/is_sponsored (creator items are
 * sponsored by the creator via a future paid-promotion flow; admin can also
 * grant it directly here for now — see is_sponsored on merch_products).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface AdminMarketProductRow {
  id: string;
  name: string;
  product_type: string;
  price_kobo: string;
  is_active: boolean;
  is_sponsored: boolean;
  is_admin_featured: boolean;
  sponsored_until: string | null;
  creator_username: string;
}

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const orm = await getDb();
    const { rows } = await orm.execute<AdminMarketProductRow & Record<string, unknown>>(sql`
      SELECT mp.id, mp.name, mp.product_type, mp.price_kobo::TEXT AS price_kobo,
             mp.is_active, mp.is_sponsored, mp.is_admin_featured, mp.sponsored_until,
             u.username AS creator_username
      FROM merch_products mp
      JOIN merch_stores ms ON ms.id = mp.store_id
      JOIN users u ON u.id = ms.creator_id
      WHERE (${q} = '' OR mp.name ILIKE '%' || ${q} || '%' OR u.username ILIKE '%' || ${q} || '%')
      ORDER BY mp.created_at DESC
      LIMIT 50
    `);
    return NextResponse.json({ success: true, data: { products: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
