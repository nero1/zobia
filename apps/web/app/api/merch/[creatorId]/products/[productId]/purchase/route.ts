/**
 * app/api/merch/[creatorId]/products/[productId]/purchase/route.ts
 *
 * POST /api/merch/:creatorId/products/:productId/purchase
 *   Purchase a merch product.
 *   - Deducts coins from buyer (convert kobo to coins: price_kobo / 100)
 *   - Creates a merch_order record
 *   - Credits 80% to creator via creator_earnings
 *   - Awards XP to buyer
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendEmail } from "@/lib/notifications/email";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREATOR_SHARE_PCT = 80;
const PLATFORM_FEE_PCT = 20;
const XP_AWARD_MERCH_PURCHASE = 50;

const purchaseSchema = z.object({
  shippingName:    z.string().max(200).optional(),
  shippingAddress: z.string().max(500).optional(),
  shippingCity:    z.string().max(100).optional(),
  shippingCountry: z.string().max(100).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/merch/:creatorId/products/:productId/purchase
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { creatorId: string; productId: string };
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { creatorId, productId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
      await requireFeatureEnabled("merchStore");

      // Cannot buy your own product
      if (userId === creatorId) {
        throw forbidden("You cannot purchase your own merch");
      }

      const body = await validateBody(req, purchaseSchema);

      // Fetch creator tier for revenue share calculation
      const { rows: creatorRows } = await db.query<{ creator_tier: string | null }>(
        `SELECT creator_tier FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [creatorId]
      );
      const creatorTier = creatorRows[0]?.creator_tier ?? null;

      const result = await db.transaction(async (tx) => {
        // Fetch product with store verification
        const { rows: productRows } = await tx.query<{
          id: string;
          store_id: string;
          name: string;
          price_kobo: string;
          is_active: boolean;
          stock: number | null;
          product_type: string;
        }>(
          `SELECT mp.id, mp.store_id, mp.name, mp.price_kobo::TEXT AS price_kobo,
                  mp.is_active, mp.stock, mp.product_type
           FROM merch_products mp
           JOIN merch_stores ms ON ms.id = mp.store_id
           WHERE mp.id = $1 AND ms.creator_id = $2
           FOR UPDATE`,
          [productId, creatorId]
        );
        if (!productRows[0]) throw notFound("Product not found");
        const product = productRows[0];
        if (!product.is_active) throw notFound("Product is no longer available");

        // Check stock
        if (product.stock !== null && product.stock <= 0) {
          throw conflict("Product is out of stock");
        }

        // Physical products require shipping details
        if (product.product_type === "physical") {
          if (!body.shippingName || !body.shippingAddress || !body.shippingCity || !body.shippingCountry) {
            throw badRequest("Shipping name, address, city, and country are required for physical products");
          }
        }

        // Convert price: kobo / 100 = coins
        const priceKobo = parseInt(product.price_kobo, 10);
        const priceCoins = Math.ceil(priceKobo / 100);

        // Check duplicate purchase for digital products
        if (product.product_type === "digital") {
          const { rows: existingOrder } = await tx.query<{ id: string }>(
            `SELECT id FROM merch_orders
             WHERE product_id = $1 AND buyer_id = $2
               AND status != 'refunded'
             LIMIT 1`,
            [productId, userId]
          );
          if (existingOrder.length > 0) {
            throw conflict("You already own this digital product");
          }
        }

        // Fetch and lock buyer's coin balance
        const { rows: userRows } = await tx.query<{ coin_balance: number }>(
          `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [userId]
        );
        if (!userRows[0]) throw notFound("User not found");
        const { coin_balance } = userRows[0];

        if (coin_balance < priceCoins) {
          throw forbidden(`Insufficient coins. This item costs ${priceCoins} coins.`);
        }

        // Deduct coins from buyer
        const newBalance = coin_balance - priceCoins;
        await tx.query(
          `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
          [newBalance, userId]
        );

        // Log coin transaction
        await tx.query(
          `INSERT INTO coin_ledger
             (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
           VALUES ($1, $2, $3, $4, 'merch_purchase', $5, NOW())`,
          [
            userId,
            -priceCoins,
            coin_balance,
            newBalance,
            `Purchased merch: ${product.name}`,
          ]
        );

        // Calculate creator share and platform fee (85% for Icon, 80% otherwise)
        const effectiveSharePct = creatorTier === 'icon' ? 85 : CREATOR_SHARE_PCT;
        const creatorShareKobo = Math.floor((priceKobo * effectiveSharePct) / 100);
        const platformFeeKobo = priceKobo - creatorShareKobo;

        // Create merch order (with optional shipping details for physical products)
        const { rows: orderRows } = await tx.query<{ id: string }>(
          `INSERT INTO merch_orders
             (product_id, buyer_id, creator_id, amount_kobo, creator_share_kobo,
              platform_fee_kobo, status,
              shipping_name, shipping_address, shipping_city, shipping_country,
              created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, NOW())
           RETURNING id`,
          [
            productId,
            userId,
            creatorId,
            priceKobo,
            creatorShareKobo,
            platformFeeKobo,
            body.shippingName ?? null,
            body.shippingAddress ?? null,
            body.shippingCity ?? null,
            body.shippingCountry ?? null,
          ]
        );
        const orderId = orderRows[0].id;

        // Credit 80% to creator earnings (use canonical schema column names)
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id, created_at)
           VALUES ($1, 'merch', $2, $3, $4, $5, NOW())`,
          [creatorId, priceKobo, platformFeeKobo, creatorShareKobo, orderId]
        );
        await tx.query(
          `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
                            updated_at = NOW() WHERE id = $2`,
          [creatorShareKobo, creatorId]
        );

        // Decrement stock if limited
        if (product.stock !== null) {
          await tx.query(
            `UPDATE merch_products SET stock = stock - 1 WHERE id = $1`,
            [productId]
          );
        }

        // Award XP to buyer
        await tx.query(
          `UPDATE users
           SET xp_total = xp_total + $1,
               xp_social = xp_social + $1,
               updated_at = NOW()
           WHERE id = $2`,
          [XP_AWARD_MERCH_PURCHASE, userId]
        );

        await tx.query(
          `INSERT INTO xp_ledger
             (user_id, amount, track, source, base_amount, reference_id, created_at)
           VALUES ($1, $2, 'social', 'merch_purchase', $2, $3, NOW())`,
          [userId, XP_AWARD_MERCH_PURCHASE, orderId]
        );

        return {
          orderId,
          productId,
          productName: product.name,
          productType: product.product_type,
          priceCoins,
          priceKobo,
          creatorShareKobo,
          platformFeeKobo,
          newCoinBalance: newBalance,
          xpAwarded: XP_AWARD_MERCH_PURCHASE,
        };
      });

      // Notify seller — in-app, push, and email (fire-and-forget, non-blocking)
      const shippingDesc = result.productType === 'physical' && body.shippingCity
        ? ` — shipping to ${body.shippingCity}, ${body.shippingCountry}`
        : '';
      void (async () => {
        try {
          // 1. In-app notification
          await db.query(
            `INSERT INTO user_notifications (user_id, type, title, body, metadata, created_at)
             VALUES ($1, 'new_merch_order', $2, $3, $4, NOW())`,
            [
              creatorId,
              `New order: ${result.productName}`,
              `You have a new order for "${result.productName}"${shippingDesc}.`,
              JSON.stringify({ orderId: result.orderId, productId, buyerId: userId }),
            ]
          );
          // 2. Push notification
          await sendPushNotification(
            creatorId,
            'New Merch Order!',
            `Someone ordered "${result.productName}"${shippingDesc}.`,
            { action: '/creator/orders', priority: 'high' }
          );
          // 3. Email notification
          const { rows: creatorEmailRows } = await db.query<{ email: string }>(
            `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [creatorId]
          );
          const creatorEmail = creatorEmailRows[0]?.email;
          if (creatorEmail) {
            await sendEmail(
              creatorEmail,
              `New order: ${result.productName}`,
              `You have a new order for "${result.productName}"${shippingDesc}.\n\nOrder ID: ${result.orderId}\nEarnings: ₦${(result.creatorShareKobo / 100).toFixed(2)}\n\nLog in to Zobia to manage your orders.`,
              undefined,
              'transactional'
            );
          }
        } catch {
          // Non-fatal — seller notification failure must not affect buyer experience
        }
      })();

      return NextResponse.json(
        { success: true, data: result, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
