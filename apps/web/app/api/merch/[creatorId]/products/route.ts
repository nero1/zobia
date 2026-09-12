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

    // Get store for creator
    const { rows: storeRows } = await db.query<{ id: string }>(
      `SELECT id FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
      [creatorId]
    );
    if (!storeRows[0]) throw notFound("Merch store not found for this creator");

    const { rows } = await db.query<MerchProductRow>(
      `SELECT id, store_id, name, description, product_type,
              price_kobo::TEXT AS price_kobo, image_url, is_active, stock,
              referral_enabled, referral_commission_pct::TEXT AS referral_commission_pct, created_at
       FROM merch_products
       WHERE store_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [storeRows[0].id]
    );

    const products = rows.map((p) => ({
      ...p,
      priceKobo: parseInt(p.price_kobo, 10),
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
      const eligibility = await getMerchSellerEligibility(userId, db);
      if (!eligibility.qualified) {
        throw forbidden(MERCH_SELLER_INELIGIBLE_MESSAGE);
      }

      // Get store for creator
      const { rows: storeRows } = await db.query<{ id: string }>(
        `SELECT id FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
        [userId]
      );
      if (!storeRows[0]) throw notFound("Merch store not found. Create a store first.");

      const body = await validateBody(req, createProductSchema);

      // KYC gate — high-value products require the seller to hold the
      // matching KYC tier (admin-configurable thresholds, see lib/kyc/thresholds.ts).
      // Business-account sellers use the business threshold; a verified
      // business_account's own verification_status is a separate, already-
      // enforced gate (checked by getMerchSellerEligibility above).
      {
        const { rows: kycRows } = await db.query<{ kyc_tier: number }>(
          `SELECT kyc_tier FROM users WHERE id = $1`,
          [userId]
        );
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
        const { rows: storeSettingRows } = await db.query<{ physical_goods_enabled: boolean }>(
          `SELECT physical_goods_enabled FROM merch_stores WHERE creator_id = $1 LIMIT 1`,
          [userId]
        );
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

      const { rows } = await db.query<MerchProductRow>(
        `INSERT INTO merch_products
           (store_id, name, description, product_type, price_kobo, is_active, stock,
            referral_enabled, referral_commission_pct, created_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, NOW())
         RETURNING id, store_id, name, description, product_type,
                   price_kobo::TEXT AS price_kobo, image_url, is_active, stock,
                   referral_enabled, referral_commission_pct::TEXT AS referral_commission_pct, created_at`,
        [
          storeRows[0].id,
          body.name,
          body.description ?? null,
          body.product_type,
          body.price_kobo,
          body.stock ?? null,
          referralEnabled,
          referralCommissionPct,
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
