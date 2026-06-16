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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";
import { verifyAccessToken, extractBearerToken } from "@/lib/auth/jwt";
import { getSession, ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

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

    const { rows } = await db.query<StickerPackRow>(
      `SELECT
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
           WHEN $1::uuid IS NULL THEN FALSE
           WHEN sp.coin_price = 0 THEN TRUE
           ELSE EXISTS (
             SELECT 1 FROM user_sticker_packs usp
             WHERE usp.user_id = $1 AND usp.pack_id = sp.id
           )
         END AS unlocked
       FROM sticker_packs sp
       LEFT JOIN stickers s ON s.pack_id = sp.id
       WHERE sp.is_active = TRUE
       GROUP BY sp.id
       ORDER BY sp.created_at DESC`,
      [userId]
    );

    return NextResponse.json({ success: true, data: { packs: rows }, error: null });
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

    await db.transaction(async (tx) => {
      // Fetch pack details
      const { rows: packRows } = await tx.query<{
        id: string;
        name: string;
        coin_price: number;
        is_active: boolean;
      }>(
        `SELECT id, name, coin_price, is_active FROM sticker_packs WHERE id = $1 LIMIT 1`,
        [packId]
      );

      const pack = packRows[0];
      if (!pack) throw notFound("Sticker pack not found");
      if (!pack.is_active) throw badRequest("This sticker pack is no longer available");

      // Check if already unlocked
      const { rows: existingRows } = await tx.query<{ id: string }>(
        `SELECT id FROM user_sticker_packs WHERE user_id = $1 AND pack_id = $2 LIMIT 1`,
        [userId, packId]
      );
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
      await tx.query(
        `INSERT INTO user_sticker_packs (user_id, pack_id, acquired_at, unlocked_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [userId, packId]
      );
    });

    // Track sticker unlock for badge progression
    // Check if user has unlocked 3+ packs (earns "Sticker Collector" badge)
    try {
      const { rows: packCount } = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM user_sticker_packs WHERE user_id = $1`,
        [userId]
      );
      const totalPacks = parseInt(packCount[0]?.count ?? "0", 10);

      // Award badge at milestones: 1, 3, 5, 10 packs
      const BADGE_MILESTONES: Record<number, string> = {
        1: 'sticker_collector_1',
        3: 'sticker_collector_3',
        5: 'sticker_collector_5',
        10: 'sticker_collector_10',
      };

      const badgeType = BADGE_MILESTONES[totalPacks];
      if (badgeType) {
        await db.query(
          `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, awarded_at)
           VALUES ($1, $2, $2, $1, NOW())
           ON CONFLICT (user_id, badge_type, reference_id) DO NOTHING`,
          [userId, badgeType]
        );

        // Notify user of badge
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'badge_unlocked', 'New Badge!', $2, $3, NOW())`,
          [
            userId,
            `You unlocked the Sticker Collector badge for unlocking ${totalPacks} sticker packs!`,
            JSON.stringify({ badgeType, packCount: totalPacks })
          ]
        );
      }
    } catch (badgeErr) {
      // Badge tracking is non-critical — log but don't fail the purchase
      console.error('[stickers] badge tracking error:', badgeErr);
    }

    return NextResponse.json(
      { success: true, data: { packId, unlocked: true }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
