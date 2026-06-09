export const dynamic = 'force-dynamic';

/**
 * app/api/merch/[creatorId]/products/route.ts
 *
 * GET /api/merch/:creatorId/products
 *   List products for a creator's store. No auth required.
 *
 * POST /api/merch/:creatorId/products
 *   Create a product (store owner only).
 *   Body: { name, description, product_type, price_kobo, stock }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createProductSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  product_type: z.enum(["digital", "physical", "course_material"]).default("digital"),
  price_kobo: z.number().int().positive(),
  stock: z.number().int().nonnegative().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MerchProductRow {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  product_type: string;
  price_kobo: string;
  image_url: string | null;
  is_active: boolean;
  stock: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/merch/:creatorId/products
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { creatorId: string } }
): Promise<NextResponse> {
  try {
    const { creatorId } = await params;

    // Get store for creator
    const { rows: storeRows } = await db.query<{ id: string }>(
      `SELECT id FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
      [creatorId]
    );
    if (!storeRows[0]) throw notFound("Merch store not found for this creator");

    const { rows } = await db.query<MerchProductRow>(
      `SELECT id, store_id, name, description, product_type,
              price_kobo::TEXT AS price_kobo, image_url, is_active, stock, created_at
       FROM merch_products
       WHERE store_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [storeRows[0].id]
    );

    const products = rows.map((p) => ({
      ...p,
      priceKobo: parseInt(p.price_kobo, 10),
    }));

    return NextResponse.json({
      success: true,
      data: { products },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/merch/:creatorId/products
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { creatorId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { creatorId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      if (userId !== creatorId) {
        throw forbidden("You can only add products to your own store");
      }

      // Verify Elite+ tier (per PRD §14: Merch Store is Elite tier+)
      const { rows: tierRows } = await db.query<{ is_creator: boolean; creator_tier: string | null }>(
        `SELECT is_creator, creator_tier FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (!tierRows[0]?.is_creator) throw forbidden("Creator account required");
      const tier = tierRows[0]?.creator_tier ?? "";
      if (!["elite", "icon", "zobia_icon"].includes(tier)) {
        throw forbidden("Merch stores are available to Elite, Icon, and Zobia Icon creators only");
      }

      // Get store for creator
      const { rows: storeRows } = await db.query<{ id: string }>(
        `SELECT id FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
        [userId]
      );
      if (!storeRows[0]) throw notFound("Merch store not found. Create a store first.");

      const body = await validateBody(req, createProductSchema);

      // Gate physical products on admin + creator toggles
      if (body.product_type === "physical") {
        const manifest = await loadManifest();
        if (!manifest.features.physicalGoodsEnabled) {
          throw forbidden("Physical goods sales are not enabled on this platform");
        }
        const { rows: storeSettingRows } = await db.query<{ physical_goods_enabled: boolean }>(
          `SELECT physical_goods_enabled FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
          [userId]
        );
        if (!storeSettingRows[0]?.physical_goods_enabled) {
          throw forbidden("You must enable physical goods on your store before creating physical products");
        }
      }

      const { rows } = await db.query<MerchProductRow>(
        `INSERT INTO merch_products
           (store_id, name, description, product_type, price_kobo, is_active, stock, created_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW())
         RETURNING id, store_id, name, description, product_type,
                   price_kobo::TEXT AS price_kobo, image_url, is_active, stock, created_at`,
        [
          storeRows[0].id,
          body.name,
          body.description ?? null,
          body.product_type,
          body.price_kobo,
          body.stock ?? null,
        ]
      );

      return NextResponse.json(
        {
          success: true,
          data: {
            product: {
              ...rows[0],
              priceKobo: parseInt(rows[0].price_kobo, 10),
            },
          },
          error: null,
        },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
