export const dynamic = 'force-dynamic';

/**
 * app/api/merch/[creatorId]/route.ts
 *
 * GET /api/merch/:creatorId
 *   Get a specific creator's merch store and products.
 *   No auth required.
 *
 * POST /api/merch/:creatorId
 *   Create or update a merch store (creator only).
 *   Body: { name, description }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const upsertStoreSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

const storeSettingsSchema = z.object({
  physicalGoodsEnabled: z.boolean().optional(),
  defaultFulfillmentMethod: z.enum(["manual", "partner"]).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MerchStoreRow {
  id: string;
  creator_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

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
// GET /api/merch/:creatorId
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> }
): Promise<NextResponse> {
  try {
    const { creatorId } = await params;

    const { rows: storeRows } = await db.query<MerchStoreRow>(
      `SELECT id, creator_id, name, description, is_active, created_at
       FROM merch_stores
       WHERE creator_id = $1 LIMIT 1`,
      [creatorId]
    );

    if (!storeRows[0]) throw notFound("Merch store not found");

    const store = storeRows[0];

    const { rows: productRows } = await db.query<MerchProductRow>(
      `SELECT id, store_id, name, description, product_type,
              price_kobo::TEXT AS price_kobo, image_url, is_active, stock, created_at
       FROM merch_products
       WHERE store_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [store.id]
    );

    const products = productRows.map((p) => ({
      ...p,
      priceKobo: parseInt(p.price_kobo, 10),
    }));

    return NextResponse.json({
      success: true,
      data: { store, products },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/merch/:creatorId  — upsert store
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
        throw forbidden("You can only manage your own merch store");
      }

      // Verify caller is an Elite+ creator (per PRD §14: Merch Store is Elite tier+)
      const { rows: userRows } = await db.query<{ is_creator: boolean; creator_tier: string | null }>(
        `SELECT is_creator, creator_tier FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (!userRows[0]?.is_creator) {
        throw forbidden("Creator account required");
      }
      const tier = userRows[0]?.creator_tier ?? "";
      if (!["elite", "icon", "zobia_icon"].includes(tier)) {
        throw forbidden("Merch stores are available to Elite, Icon, and Zobia Icon creators only");
      }

      const body = await validateBody(req, upsertStoreSchema);

      const { rows } = await db.query<MerchStoreRow>(
        `INSERT INTO merch_stores (creator_id, name, description, is_active, created_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (creator_id) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description
         RETURNING id, creator_id, name, description, is_active, created_at`,
        [userId, body.name, body.description ?? null]
      );

      return NextResponse.json(
        { success: true, data: { store: rows[0] }, error: null },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/merch/:creatorId  — update physical goods store settings
// ---------------------------------------------------------------------------

export const PATCH = withAuth(
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
        throw forbidden("You can only manage your own merch store");
      }

      const manifest = await loadManifest();

      const body = await validateBody(req, storeSettingsSchema);

      if (body.physicalGoodsEnabled === true && !manifest.features.physicalGoodsEnabled) {
        throw forbidden("Physical goods sales are not enabled on this platform");
      }

      if (body.defaultFulfillmentMethod === "partner" && !manifest.features.physicalGoodsPartnerFulfillment) {
        throw badRequest(
          "Partner fulfillment integration is coming soon.",
          "PARTNER_FULFILLMENT_COMING_SOON"
        );
      }

      const { rows: storeRows } = await db.query<{ id: string }>(
        `SELECT id FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
        [userId]
      );
      if (!storeRows[0]) throw notFound("Merch store not found. Create a store first.");

      await db.query(
        `UPDATE merch_stores
         SET physical_goods_enabled   = COALESCE($1, physical_goods_enabled),
             default_fulfillment_method = COALESCE($2, default_fulfillment_method),
             updated_at = NOW()
         WHERE creator_id = $3`,
        [
          body.physicalGoodsEnabled ?? null,
          body.defaultFulfillmentMethod ?? null,
          userId,
        ]
      );

      return NextResponse.json({
        success: true,
        data: { physicalGoodsEnabled: body.physicalGoodsEnabled, defaultFulfillmentMethod: body.defaultFulfillmentMethod },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
