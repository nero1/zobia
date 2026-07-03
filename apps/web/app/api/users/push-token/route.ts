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
import { db } from "@/lib/db";
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

    await db.query(
      `INSERT INTO user_push_tokens (user_id, token, platform, device_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (user_id, token)
       DO UPDATE SET platform = $3, device_id = COALESCE($4, user_push_tokens.device_id), updated_at = NOW()`,
      [userId, body.token, body.platform, body.deviceId ?? null]
    );

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

    await db.query(
      `DELETE FROM user_push_tokens WHERE user_id = $1 AND token = $2`,
      [userId, body.token]
    );

    return NextResponse.json({ success: true, data: { unregistered: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
