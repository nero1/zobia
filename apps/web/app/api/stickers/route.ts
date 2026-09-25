export const dynamic = 'force-dynamic';

/**
 * app/api/stickers/route.ts
 *
 * Sticker pack endpoints.
 *
 * GET /api/stickers
 *   List all sticker packs with unlock status for the caller.
 *   Auth optional — if no user, `unlocked` is always false.
 *
 * POST /api/stickers
 *   Unlock a sticker pack by `packId`.
 *   Deducts coins if `coin_price > 0`.
 *   Requires auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";
import { verifyAccessToken, extractBearerToken } from "@/lib/auth/jwt";
import { getSession, ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const unlockPackSchema = z.object({
  packId: z.string().uuid("packId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface StickerPackRow {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string | null;
  cover_sticker_url: string | null;
  pack_type: "free" | "earnable" | "premium";
  coin_price: number;
  unlock_condition: string | null;
  sticker_count: number;
  is_active: boolean;
  created_at: string;
  unlocked: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/stickers
// ---------------------------------------------------------------------------

/**
 * List all active sticker packs. Auth is optional.
 * When authenticated, each pack includes `unlocked: true/false`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Attempt to extract caller identity (optional auth)
    let userId: string | null = null;

    const bearerToken = extractBearerToken(req.headers.get("authorization"));
    const cookieToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
    const token = bearerToken ?? cookieToken;

    if (token) {
      try {
        const payload = await verifyAccessToken(token);
        const session = await getSession(payload.sid);
        if (session) userId = payload.sub;
      } catch {
        // Ignore invalid token — treat as unauthenticated
      }
    }

    const orm = await getDb();
    const result = await orm.execute<StickerPackRow>(sql`
      SELECT
        sp.id,
        sp.name,
        sp.description,
        COALESCE(sp.cover_sticker_url, sp.cover_emoji) AS cover_sticker_url,
        sp.pack_type,
        sp.unlock_condition,
        sp.coin_price,
        COUNT(s.id)::int AS sticker_count,
        sp.is_active,
        sp.created_at,
        CASE
          WHEN ${userId}::uuid IS NULL THEN FALSE
          WHEN sp.coin_price = 0 THEN TRUE
          ELSE EXISTS (
            SELECT 1 FROM user_sticker_packs usp
            WHERE usp.user_id = ${userId} AND usp.pack_id = sp.id
          )
        END AS unlocked
      FROM sticker_packs sp
      LEFT JOIN stickers s ON s.pack_id = sp.id
      WHERE sp.is_active = TRUE
      GROUP BY sp.id
      ORDER BY sp.created_at DESC
    `);

    return NextResponse.json({ success: true, data: { packs: result.rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/stickers
// ---------------------------------------------------------------------------

/**
 * Unlock a sticker pack. Deducts `coin_price` coins if applicable.
 * Requires authentication.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { packId } = await validateBody(req, unlockPackSchema);
    const userId = auth.user.sub;

    const orm = await getDb();
    await orm.transaction(async (tx) => {
      // Fetch pack details
      const packRows = await tx
        .select({
          id: schema.stickerPacks.id,
          name: schema.stickerPacks.name,
          coin_price: schema.stickerPacks.coinPrice,
          is_active: schema.stickerPacks.isActive,
        })
        .from(schema.stickerPacks)
        .where(eq(schema.stickerPacks.id, packId))
        .limit(1);

      const pack = packRows[0];
      if (!pack) throw notFound("Sticker pack not found");
      if (!pack.is_active) throw badRequest("This sticker pack is no longer available");

      // Check if already unlocked
      const existingRows = await tx
        .select({ id: schema.userStickerPacks.id })
        .from(schema.userStickerPacks)
        .where(and(eq(schema.userStickerPacks.userId, userId), eq(schema.userStickerPacks.packId, packId)))
        .limit(1);
      if (existingRows.length > 0) {
        throw conflict("You have already unlocked this sticker pack");
      }

      // Deduct coins if pack has a price.
      // SYS-CL-03: scope the reference per-user so it stays unique even before
      // the SYS-CL-ROOT index migration lands everywhere.
      if (pack.coin_price > 0) {
        await debitCoins(
          userId,
          pack.coin_price,
          "sticker_pack",
          `sticker_pack:${packId}:${userId}`,
          `Unlocked sticker pack: ${pack.name}`,
          { packId },
          tx
        );
      }

      // Insert unlock record
      await tx.insert(schema.userStickerPacks).values({
        userId,
        packId,
        acquiredAt: sql`NOW()`,
        unlockedAt: sql`NOW()`,
      });
    });

    // Track sticker unlock for badge progression
    // Check if user has unlocked 3+ packs (earns "Sticker Collector" badge)
    try {
      const packCountRows = await orm
        .select({ count: count() })
        .from(schema.userStickerPacks)
        .where(eq(schema.userStickerPacks.userId, userId));
      const totalPacks = Number(packCountRows[0]?.count ?? 0);

      // Award badge at milestones: 1, 3, 5, 10 packs
      const BADGE_MILESTONES: Record<number, string> = {
        1: 'sticker_collector_1',
        3: 'sticker_collector_3',
        5: 'sticker_collector_5',
        10: 'sticker_collector_10',
      };

      const badgeType = BADGE_MILESTONES[totalPacks];
      if (badgeType) {
        // NOTE: original raw SQL targeted ON CONFLICT (user_id, badge_type,
        // reference_id), but the actual unique index in schema.ts is
        // (user_id, badge_key) WHERE badge_key IS NOT NULL — flagged as a
        // schema mismatch, not silently changed. badgeKey is set equal to
        // badgeType here (as the original insert did), so this target is
        // the closest faithful equivalent given the real constraint.
        await orm
          .insert(schema.userBadges)
          .values({
            userId,
            badgeType,
            badgeKey: badgeType,
            referenceId: userId,
            awardedAt: sql`NOW()`,
          })
          .onConflictDoNothing({
            target: [schema.userBadges.userId, schema.userBadges.badgeKey],
          });

        // Notify user of badge
        await orm.insert(schema.notifications).values({
          userId,
          type: "badge_unlocked",
          title: "New Badge!",
          body: `You unlocked the Sticker Collector badge for unlocking ${totalPacks} sticker packs!`,
          metadata: { badgeType, packCount: totalPacks },
        });
      }
    } catch (badgeErr) {
      // Badge tracking is non-critical — log but don't fail the purchase
      logger.error({ err: badgeErr }, '[stickers] badge tracking error');
    }

    return NextResponse.json(
      { success: true, data: { packId, unlocked: true }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
