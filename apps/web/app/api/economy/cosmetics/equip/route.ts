export const dynamic = 'force-dynamic';

/**
 * app/api/economy/cosmetics/equip/route.ts
 *
 * POST /api/economy/cosmetics/equip
 *
 * Sets a cosmetic as "active" for the requesting user.
 * Only one cosmetic per cosmetic_type can be active at a time — e.g. a user
 * can only have one active profile_frame, one active title, etc.
 *
 * When a profile_frame is activated, users.active_cosmetic_frame_id is updated.
 * When a title is activated, users.active_cosmetic_title is set to the item name.
 *
 * Auth: required (withAuth).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";

const equipSchema = z.object({
  /** UUID of the store_items row to equip (must already be owned). */
  itemId: z.string().uuid("itemId must be a valid UUID"),
  /** Pass true to unequip (deactivate without equipping another). */
  unequip: z.boolean().optional().default(false),
});

interface OwnedCosmeticRow {
  id: string;
  cosmetic_type: string;
  store_item_id: string;
}

interface StoreItemRow {
  id: string;
  name: string;
  cosmetic_type: string;
}

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, equipSchema);
    const userId = auth.user.sub;

    // 1. Verify the user owns this item
    const { rows: ownedRows } = await db.query<OwnedCosmeticRow>(
      `SELECT uc.id, uc.cosmetic_type, uc.store_item_id
       FROM user_cosmetics uc
       WHERE uc.user_id = $1 AND uc.store_item_id = $2
       LIMIT 1`,
      [userId, body.itemId]
    );

    if (!ownedRows[0]) {
      throw forbidden("You do not own this cosmetic item");
    }

    const owned = ownedRows[0];

    // 2. Get item details for updating user profile fields
    const { rows: itemRows } = await db.query<StoreItemRow>(
      `SELECT id, name, cosmetic_type FROM store_items WHERE id = $1 LIMIT 1`,
      [body.itemId]
    );
    const item = itemRows[0];
    if (!item) throw badRequest("Cosmetic item no longer exists");

    await db.transaction(async (tx) => {
      // Deactivate all cosmetics of the same type for this user
      await tx.query(
        `UPDATE user_cosmetics
         SET is_active = FALSE
         WHERE user_id = $1 AND cosmetic_type = $2`,
        [userId, owned.cosmetic_type]
      );

      if (!body.unequip) {
        // Activate the selected cosmetic
        await tx.query(
          `UPDATE user_cosmetics SET is_active = TRUE
           WHERE user_id = $1 AND store_item_id = $2`,
          [userId, body.itemId]
        );

        // Sync quick-read columns on the users table
        if (item.cosmetic_type === "profile_frame") {
          await tx.query(
            `UPDATE users SET active_cosmetic_frame_id = $1, updated_at = NOW() WHERE id = $2`,
            [body.itemId, userId]
          );
        } else if (item.cosmetic_type === "title") {
          await tx.query(
            `UPDATE users SET active_cosmetic_title = $1, updated_at = NOW() WHERE id = $2`,
            [item.name, userId]
          );
        }
      } else {
        // Unequip — clear the quick-read column
        if (item.cosmetic_type === "profile_frame") {
          await tx.query(
            `UPDATE users SET active_cosmetic_frame_id = NULL, updated_at = NOW() WHERE id = $1`,
            [userId]
          );
        } else if (item.cosmetic_type === "title") {
          await tx.query(
            `UPDATE users SET active_cosmetic_title = NULL, updated_at = NOW() WHERE id = $1`,
            [userId]
          );
        }
      }
    });

    return NextResponse.json({
      itemId: body.itemId,
      cosmeticType: owned.cosmetic_type,
      isActive: !body.unequip,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
