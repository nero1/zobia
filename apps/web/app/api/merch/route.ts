/**
 * app/api/merch/route.ts
 *
 * GET /api/merch
 *   List all active merch stores with their products.
 *   Optional query param: ?creatorId= to filter by creator.
 *   No auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MerchStoreRow {
  store_id: string;
  creator_id: string;
  store_name: string;
  store_description: string | null;
  store_created_at: string;
  product_id: string | null;
  product_name: string | null;
  product_description: string | null;
  product_type: string | null;
  price_kobo: string | null;
  is_active: boolean | null;
  stock: number | null;
  product_created_at: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/merch
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const creatorId = searchParams.get("creatorId");

    const params: string[] = [];
    let whereClause = `WHERE ms.is_active = TRUE`;

    if (creatorId) {
      params.push(creatorId);
      whereClause += ` AND ms.creator_id = $1`;
    }

    const { rows } = await db.query<MerchStoreRow>(
      `SELECT
         ms.id AS store_id,
         ms.creator_id,
         ms.name AS store_name,
         ms.description AS store_description,
         ms.created_at AS store_created_at,
         mp.id AS product_id,
         mp.name AS product_name,
         mp.description AS product_description,
         mp.product_type,
         mp.price_kobo::TEXT AS price_kobo,
         mp.is_active,
         mp.stock,
         mp.created_at AS product_created_at
       FROM merch_stores ms
       LEFT JOIN merch_products mp ON mp.store_id = ms.id AND mp.is_active = TRUE
       ${whereClause}
       ORDER BY ms.created_at DESC, mp.created_at ASC`,
      params
    );

    // Group products by store
    const storesMap = new Map<
      string,
      {
        storeId: string;
        creatorId: string;
        name: string;
        description: string | null;
        createdAt: string;
        products: Array<{
          id: string;
          name: string;
          description: string | null;
          productType: string;
          priceKobo: number;
          stock: number | null;
          createdAt: string;
        }>;
      }
    >();

    for (const row of rows) {
      if (!storesMap.has(row.store_id)) {
        storesMap.set(row.store_id, {
          storeId: row.store_id,
          creatorId: row.creator_id,
          name: row.store_name,
          description: row.store_description,
          createdAt: row.store_created_at,
          products: [],
        });
      }

      if (row.product_id) {
        storesMap.get(row.store_id)!.products.push({
          id: row.product_id,
          name: row.product_name!,
          description: row.product_description,
          productType: row.product_type!,
          priceKobo: parseInt(row.price_kobo ?? "0", 10),
          stock: row.stock,
          createdAt: row.product_created_at!,
        });
      }
    }

    const stores = Array.from(storesMap.values());

    return NextResponse.json({
      success: true,
      data: { stores },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
