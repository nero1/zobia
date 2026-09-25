export const dynamic = 'force-dynamic';

/**
 * app/api/users/push-token/route.ts
 *
 * Register or update a push notification token for the authenticated user.
 *
 * POST /api/users/push-token
 *   - Body: { token: string, platform: "android" | "ios" | "web" }
 *   - Upserts the token into user_push_tokens. For `platform: "web"` (ZSB-17,
 *     PWA Web Push), `token` is a JSON-stringified PushSubscription object
 *     (endpoint + p256dh/auth keys), not a bearer token string — see
 *     lib/push/webPush.ts (client) and lib/notifications/webPush.ts (server).
 *   - Returns: { success: true }
 *
 * DELETE /api/users/push-token
 *   - Body: { token: string }
 *   - Removes the (user_id, token) row — called on logout (ZSB-05) so a
 *     second account signing into the same device doesn't keep receiving
 *     pushes meant for the previous, now-logged-out account.
 *   - Returns: { success: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const pushTokenSchema = z.object({
  // 2048 (not 512): a JSON-stringified Web Push PushSubscription — endpoint
  // URL + base64 p256dh/auth keys — can run a few hundred bytes longer than
  // an Expo/FCM token string.
  token: z.string().min(1).max(2048),
  platform: z.enum(["android", "ios", "web"]),
  deviceId: z.string().min(1).max(255).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/users/push-token
// ---------------------------------------------------------------------------

/**
 * Register or update the user's push notification token.
 * Upserts by (user_id, platform) — one token per platform per user.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    await enforceRateLimit(userId, "user", {
      limit: 10,
      windowMs: 60 * 1000,
      name: "push-token:register",
    });

    const body = await validateBody(req, pushTokenSchema);

    const db = await getDb();
    await db
      .insert(schema.userPushTokens)
      .values({
        userId,
        token: body.token,
        platform: body.platform,
        deviceId: body.deviceId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.userPushTokens.userId, schema.userPushTokens.token],
        set: {
          platform: body.platform,
          deviceId: sql`COALESCE(${body.deviceId ?? null}, ${schema.userPushTokens.deviceId})`,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, data: { registered: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/push-token
// ---------------------------------------------------------------------------

const pushTokenUnregisterSchema = z.object({
  token: z.string().min(1).max(2048),
});

/**
 * Unregister a push notification token (called on logout).
 */
export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    await enforceRateLimit(userId, "user", {
      limit: 10,
      windowMs: 60 * 1000,
      name: "push-token:unregister",
    });

    const body = await validateBody(req, pushTokenUnregisterSchema);

    const db = await getDb();
    await db
      .delete(schema.userPushTokens)
      .where(
        and(
          eq(schema.userPushTokens.userId, userId),
          eq(schema.userPushTokens.token, body.token)
        )
      );

    return NextResponse.json({ success: true, data: { unregistered: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
