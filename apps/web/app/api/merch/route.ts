export const dynamic = 'force-dynamic';

/**
 * app/api/merch/route.ts
 *
 * GET /api/merch
 *   List all active merch stores with their products.
 *   Optional query param: ?creatorId= to filter by creator.
 *   No auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const whereClause = creatorId
      ? and(eq(schema.merchStores.isActive, true), eq(schema.merchStores.creatorId, creatorId))
      : eq(schema.merchStores.isActive, true);

    const dbRows = await orm
      .select({
        store_id: schema.merchStores.id,
        creator_id: schema.merchStores.creatorId,
        store_name: schema.merchStores.name,
        store_description: schema.merchStores.description,
        store_created_at: schema.merchStores.createdAt,
        product_id: schema.merchProducts.id,
        product_name: schema.merchProducts.name,
        product_description: schema.merchProducts.description,
        product_type: schema.merchProducts.productType,
        price_kobo: schema.merchProducts.priceKobo,
        is_active: schema.merchProducts.isActive,
        stock: schema.merchProducts.stock,
        product_created_at: schema.merchProducts.createdAt,
      })
      .from(schema.merchStores)
      .leftJoin(
        schema.merchProducts,
        and(eq(schema.merchProducts.storeId, schema.merchStores.id), eq(schema.merchProducts.isActive, true))
      )
      .where(whereClause)
      .orderBy(desc(schema.merchStores.createdAt), asc(schema.merchProducts.createdAt));

    const rows: MerchStoreRow[] = dbRows.map((row) => ({
      store_id: row.store_id,
      creator_id: row.creator_id,
      store_name: row.store_name,
      store_description: row.store_description,
      store_created_at: (row.store_created_at ?? new Date()).toString(),
      product_id: row.product_id,
      product_name: row.product_name,
      product_description: row.product_description,
      product_type: row.product_type,
      price_kobo: row.price_kobo !== null ? String(row.price_kobo) : null,
      is_active: row.is_active,
      stock: row.stock,
      product_created_at: row.product_created_at ? row.product_created_at.toString() : null,
    }));

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
