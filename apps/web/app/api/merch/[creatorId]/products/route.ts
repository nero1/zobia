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
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest, getManifestValue } from "@/lib/manifest";
import { getRequiredKycTier, meetsRequiredKycTier } from "@/lib/kyc/thresholds";
import { getMerchSellerEligibility, MERCH_SELLER_INELIGIBLE_MESSAGE } from "@/lib/merch/eligibility";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createProductSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  product_type: z.enum(["digital", "physical", "course_material"]).default("digital"),
  price_kobo: z.number().int().positive(),
  stock: z.number().int().nonnegative().nullable().optional(),
  // Market referral program opt-in. referral_commission_pct is only used for
  // product_type = 'physical' (digital items use the platform-wide tier1/
  // tier2 rate, see lib/referrals/commissions.ts).
  referral_enabled: z.boolean().optional().default(false),
  referral_commission_pct: z.number().min(1).max(100).optional(),
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
  referral_enabled: boolean;
  referral_commission_pct: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/merch/:creatorId/products
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> }
): Promise<NextResponse> {
  try {
    const { creatorId } = await params;

    const orm = await getDb();

    // Get store for creator
    const storeRows = await orm
      .select({ id: schema.merchStores.id })
      .from(schema.merchStores)
      .where(eq(schema.merchStores.creatorId, creatorId))
      .limit(1);
    if (!storeRows[0]) throw notFound("Merch store not found for this creator");

    const dbRows = await orm
      .select({
        id: schema.merchProducts.id,
        store_id: schema.merchProducts.storeId,
        name: schema.merchProducts.name,
        description: schema.merchProducts.description,
        product_type: schema.merchProducts.productType,
        price_kobo: schema.merchProducts.priceKobo,
        image_url: schema.merchProducts.imageUrl,
        is_active: schema.merchProducts.isActive,
        stock: schema.merchProducts.stock,
        referral_enabled: schema.merchProducts.referralEnabled,
        referral_commission_pct: schema.merchProducts.referralCommissionPct,
        created_at: schema.merchProducts.createdAt,
      })
      .from(schema.merchProducts)
      .where(and(eq(schema.merchProducts.storeId, storeRows[0].id), eq(schema.merchProducts.isActive, true)))
      .orderBy(desc(schema.merchProducts.createdAt));

    const products = dbRows.map((p) => ({
      ...p,
      price_kobo: String(p.price_kobo),
      created_at: p.created_at ? p.created_at.toISOString() : null,
      priceKobo: Number(p.price_kobo),
      referralCommissionPct: p.referral_commission_pct ? parseFloat(p.referral_commission_pct) : null,
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

      // Verify Elite+ creator OR verified Business account (per PRD §14:
      // Merch Store is Elite tier+, extended to Business accounts).
      const eligibility = await getMerchSellerEligibility(userId);
      if (!eligibility.qualified) {
        throw forbidden(MERCH_SELLER_INELIGIBLE_MESSAGE);
      }

      const orm = await getDb();

      // Get store for creator
      const storeRows = await orm
        .select({ id: schema.merchStores.id })
        .from(schema.merchStores)
        .where(eq(schema.merchStores.creatorId, userId))
        .limit(1);
      if (!storeRows[0]) throw notFound("Merch store not found. Create a store first.");

      const body = await validateBody(req, createProductSchema);

      // KYC gate — high-value products require the seller to hold the
      // matching KYC tier (admin-configurable thresholds, see lib/kyc/thresholds.ts).
      // Business-account sellers use the business threshold; a verified
      // business_account's own verification_status is a separate, already-
      // enforced gate (checked by getMerchSellerEligibility above).
      {
        const kycRows = await orm
          .select({ kyc_tier: schema.users.kycTier })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        const requiredTier = await getRequiredKycTier(eligibility.accountType, { kobo: body.price_kobo });
        if (requiredTier > 0 && !meetsRequiredKycTier(kycRows[0]?.kyc_tier ?? 0, requiredTier)) {
          throw forbidden(
            `Selling a product priced this high requires Tier ${requiredTier} identity verification. Complete it from your KYC settings first.`,
            "KYC_TIER_REQUIRED",
            { requiredTier }
          );
        }
      }

      // Gate physical products on admin + creator toggles
      if (body.product_type === "physical") {
        const manifest = await loadManifest();
        if (!manifest.features.physicalGoodsEnabled) {
          throw forbidden("Physical goods sales are not enabled on this platform");
        }
        const storeSettingRows = await orm
          .select({ physical_goods_enabled: schema.merchStores.physicalGoodsEnabled })
          .from(schema.merchStores)
          .where(eq(schema.merchStores.creatorId, userId))
          .limit(1);
        if (!storeSettingRows[0]?.physical_goods_enabled) {
          throw forbidden("You must enable physical goods on your store before creating physical products");
        }
      }

      // Market referral program opt-in validation.
      let referralEnabled = body.referral_enabled ?? false;
      let referralCommissionPct: number | null = null;
      if (referralEnabled) {
        const isPhysical = body.product_type === "physical";
        const flagKey = isPhysical ? "market_referral_physical_enabled" : "market_referral_digital_enabled";
        const flagValue = await getManifestValue(flagKey);
        if (flagValue !== "true") {
          throw forbidden("The referral program is not currently enabled for this item type");
        }
        if (isPhysical) {
          const minPctStr = await getManifestValue("market_referral_physical_min_pct");
          const minPct = minPctStr ? parseFloat(minPctStr) : 1;
          const pct = body.referral_commission_pct ?? minPct;
          if (pct < minPct) {
            throw forbidden(`Referral commission on a physical item must be at least ${minPct}%`);
          }
          referralCommissionPct = pct;
        }
        // Digital items don't need a creator-set %: the platform-wide
        // tier1/tier2 rate applies automatically (lib/referrals/commissions.ts).
      } else {
        referralEnabled = false;
      }

      const inserted = await orm
        .insert(schema.merchProducts)
        .values({
          storeId: storeRows[0].id,
          name: body.name,
          description: body.description ?? null,
          productType: body.product_type,
          priceKobo: BigInt(body.price_kobo),
          isActive: true,
          stock: body.stock ?? null,
          referralEnabled,
          referralCommissionPct: referralCommissionPct !== null ? String(referralCommissionPct) : null,
        })
        .returning({
          id: schema.merchProducts.id,
          store_id: schema.merchProducts.storeId,
          name: schema.merchProducts.name,
          description: schema.merchProducts.description,
          product_type: schema.merchProducts.productType,
          price_kobo: schema.merchProducts.priceKobo,
          image_url: schema.merchProducts.imageUrl,
          is_active: schema.merchProducts.isActive,
          stock: schema.merchProducts.stock,
          referral_enabled: schema.merchProducts.referralEnabled,
          referral_commission_pct: schema.merchProducts.referralCommissionPct,
          created_at: schema.merchProducts.createdAt,
        });

      const row = inserted[0];

      return NextResponse.json(
        {
          success: true,
          data: {
            product: {
              ...row,
              price_kobo: String(row.price_kobo),
              created_at: row.created_at ? row.created_at.toISOString() : null,
              priceKobo: Number(row.price_kobo),
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
