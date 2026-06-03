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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREATOR_SHARE_PCT = 80;
const PLATFORM_FEE_PCT = 20;
const XP_AWARD_MERCH_PURCHASE = 50;

// ---------------------------------------------------------------------------
// POST /api/merch/:creatorId/products/:productId/purchase
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    _req: NextRequest,
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

      // Cannot buy your own product
      if (userId === creatorId) {
        throw forbidden("You cannot purchase your own merch");
      }

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

        // Calculate creator share and platform fee
        const creatorShareKobo = Math.floor((priceKobo * CREATOR_SHARE_PCT) / 100);
        const platformFeeKobo = priceKobo - creatorShareKobo;

        // Create merch order
        const { rows: orderRows } = await tx.query<{ id: string }>(
          `INSERT INTO merch_orders
             (product_id, buyer_id, creator_id, amount_kobo, creator_share_kobo,
              platform_fee_kobo, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())
           RETURNING id`,
          [
            productId,
            userId,
            creatorId,
            priceKobo,
            creatorShareKobo,
            platformFeeKobo,
          ]
        );
        const orderId = orderRows[0].id;

        // Credit 80% to creator earnings
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, stream, gross_kobo, net_kobo, reference_id, created_at)
           VALUES ($1, 'merch', $2, $3, $4, NOW())`,
          [creatorId, priceKobo, creatorShareKobo, orderId]
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
             (user_id, amount, track, action, xp_amount, xp_net, source, reference_id, created_at)
           VALUES ($1, $2, 'social', 'merch_purchase', $2, $2, 'merch_purchase', $3, NOW())`,
          [userId, XP_AWARD_MERCH_PURCHASE, orderId]
        );

        return {
          orderId,
          productId,
          priceCoins,
          priceKobo,
          creatorShareKobo,
          platformFeeKobo,
          newCoinBalance: newBalance,
          xpAwarded: XP_AWARD_MERCH_PURCHASE,
        };
      });

      return NextResponse.json(
        { success: true, data: result, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
