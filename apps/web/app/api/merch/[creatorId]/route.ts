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
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { getMerchSellerEligibility, MERCH_SELLER_INELIGIBLE_MESSAGE } from "@/lib/merch/eligibility";

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
// GET /api/merch/:creatorId
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> }
): Promise<NextResponse> {
  try {
    const { creatorId } = await params;
    const orm = await getDb();

    const storeRows = await orm
      .select({
        id: schema.merchStores.id,
        creatorId: schema.merchStores.creatorId,
        name: schema.merchStores.name,
        description: schema.merchStores.description,
        isActive: schema.merchStores.isActive,
        createdAt: schema.merchStores.createdAt,
      })
      .from(schema.merchStores)
      .where(eq(schema.merchStores.creatorId, creatorId))
      .limit(1);

    if (!storeRows[0]) throw notFound("Merch store not found");

    const store = storeRows[0];

    const productRows = await orm
      .select({
        id: schema.merchProducts.id,
        storeId: schema.merchProducts.storeId,
        name: schema.merchProducts.name,
        description: schema.merchProducts.description,
        productType: schema.merchProducts.productType,
        priceKobo: schema.merchProducts.priceKobo,
        imageUrl: schema.merchProducts.imageUrl,
        isActive: schema.merchProducts.isActive,
        stock: schema.merchProducts.stock,
        referralEnabled: schema.merchProducts.referralEnabled,
        referralCommissionPct: schema.merchProducts.referralCommissionPct,
        createdAt: schema.merchProducts.createdAt,
      })
      .from(schema.merchProducts)
      .where(and(eq(schema.merchProducts.storeId, store.id), eq(schema.merchProducts.isActive, true)))
      .orderBy(desc(schema.merchProducts.createdAt));

    // NOTE: response field names are snake_case to match the existing API
    // contract consumed by app/(app)/merch/[creatorId]/page.tsx — do not
    // switch to camelCase here without updating that client.
    const products = productRows.map((p) => ({
      id: p.id,
      store_id: p.storeId,
      name: p.name,
      description: p.description,
      product_type: p.productType,
      price_kobo: p.priceKobo.toString(),
      priceKobo: Number(p.priceKobo),
      image_url: p.imageUrl,
      is_active: p.isActive,
      stock: p.stock,
      referral_enabled: p.referralEnabled,
      referral_commission_pct: p.referralCommissionPct,
      referralCommissionPct: p.referralCommissionPct ? parseFloat(p.referralCommissionPct) : null,
      created_at: p.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: {
        store: {
          id: store.id,
          creator_id: store.creatorId,
          name: store.name,
          description: store.description,
          is_active: store.isActive,
          created_at: store.createdAt,
        },
        products,
      },
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

      // Verify caller is an Elite+ creator or a verified Business account
      // (per PRD §14: Merch Store is Elite tier+, extended to Business accounts).
      const eligibility = await getMerchSellerEligibility(userId);
      if (!eligibility.qualified) {
        throw forbidden(MERCH_SELLER_INELIGIBLE_MESSAGE);
      }

      const body = await validateBody(req, upsertStoreSchema);
      const orm = await getDb();

      const rows = await orm
        .insert(schema.merchStores)
        .values({
          creatorId: userId,
          name: body.name,
          description: body.description ?? null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.merchStores.creatorId,
          set: { name: body.name, description: body.description ?? null },
        })
        .returning({
          id: schema.merchStores.id,
          creatorId: schema.merchStores.creatorId,
          name: schema.merchStores.name,
          description: schema.merchStores.description,
          isActive: schema.merchStores.isActive,
          createdAt: schema.merchStores.createdAt,
        });

      const store = rows[0]
        ? {
            id: rows[0].id,
            creator_id: rows[0].creatorId,
            name: rows[0].name,
            description: rows[0].description,
            is_active: rows[0].isActive,
            created_at: rows[0].createdAt,
          }
        : null;

      return NextResponse.json(
        { success: true, data: { store }, error: null },
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
      const orm = await getDb();

      if (body.physicalGoodsEnabled === true && !manifest.features.physicalGoodsEnabled) {
        throw forbidden("Physical goods sales are not enabled on this platform");
      }

      if (body.defaultFulfillmentMethod === "partner" && !manifest.features.physicalGoodsPartnerFulfillment) {
        throw badRequest(
          "Partner fulfillment integration is coming soon.",
          "PARTNER_FULFILLMENT_COMING_SOON"
        );
      }

      const storeRows = await orm
        .select({ id: schema.merchStores.id })
        .from(schema.merchStores)
        .where(eq(schema.merchStores.creatorId, userId))
        .limit(1);
      if (!storeRows[0]) throw notFound("Merch store not found. Create a store first.");

      await orm
        .update(schema.merchStores)
        .set({
          physicalGoodsEnabled: body.physicalGoodsEnabled ?? undefined,
          defaultFulfillmentMethod: body.defaultFulfillmentMethod ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.merchStores.creatorId, userId));

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
