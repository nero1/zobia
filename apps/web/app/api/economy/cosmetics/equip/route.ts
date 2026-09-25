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
 * NOTE (migration 0022): the 'blog_theme' branch below is legacy — it still
 * writes blogs.theme_store_item_id (by owner_id, which is also stale now
 * that a user can own several blogs — see lib/blogs/service.ts), but
 * rendering no longer reads that column. The current theme catalog/equip
 * flow is lib/blogs/themes.ts + POST /api/blogs/[slug]/themes/equip, which
 * writes blogs.active_theme_id per-blog. This branch is left in place only
 * so an old client hitting this endpoint with a blog_theme item doesn't
 * hard-error; it's a no-op as far as the current theme engine is concerned.
 *
 * Auth: required (withAuth).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, equipSchema);
    const userId = auth.user.sub;

    // 1. Verify the user owns this item
    const orm = await getDb();
    const [owned] = await orm
      .select({
        id: schema.userCosmetics.id,
        cosmetic_type: schema.userCosmetics.cosmeticType,
        store_item_id: schema.userCosmetics.storeItemId,
      })
      .from(schema.userCosmetics)
      .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.storeItemId, body.itemId)))
      .limit(1);

    if (!owned) {
      throw forbidden("You do not own this cosmetic item");
    }

    // 2. Get item details for updating user profile fields
    const [item] = await orm
      .select({ id: schema.storeItems.id, name: schema.storeItems.name, cosmetic_type: schema.storeItems.cosmeticType })
      .from(schema.storeItems)
      .where(eq(schema.storeItems.id, body.itemId))
      .limit(1);
    if (!item) throw badRequest("Cosmetic item no longer exists");

    await orm.transaction(async (tx) => {
      // Deactivate all cosmetics of the same type for this user
      await tx
        .update(schema.userCosmetics)
        .set({ isActive: false })
        .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.cosmeticType, owned.cosmetic_type)));

      if (!body.unequip) {
        // Activate the selected cosmetic
        await tx
          .update(schema.userCosmetics)
          .set({ isActive: true })
          .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.storeItemId, body.itemId)));

        // Sync quick-read columns on the users table
        if (item.cosmetic_type === "profile_frame") {
          await tx
            .update(schema.users)
            .set({ activeCosmeticFrameId: body.itemId, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
        } else if (item.cosmetic_type === "title") {
          await tx
            .update(schema.users)
            .set({ activeCosmeticTitle: item.name, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
        } else if (item.cosmetic_type === "blog_theme") {
          await tx
            .update(schema.blogs)
            .set({ themeStoreItemId: body.itemId, updatedAt: new Date() })
            .where(eq(schema.blogs.ownerId, userId));
        }
      } else {
        // Unequip — clear the quick-read column
        if (item.cosmetic_type === "profile_frame") {
          await tx
            .update(schema.users)
            .set({ activeCosmeticFrameId: null, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
        } else if (item.cosmetic_type === "title") {
          await tx
            .update(schema.users)
            .set({ activeCosmeticTitle: null, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
        } else if (item.cosmetic_type === "blog_theme") {
          await tx
            .update(schema.blogs)
            .set({ themeStoreItemId: null, updatedAt: new Date() })
            .where(eq(schema.blogs.ownerId, userId));
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
