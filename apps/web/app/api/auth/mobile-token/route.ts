export const dynamic = 'force-dynamic';

/**
 * app/api/auth/mobile-token/route.ts
 *
 * POST /api/auth/mobile-token
 *
 * Exchanges a one-time mobile OAuth exchange code (stored in Redis) for the
 * actual access + refresh tokens.  Called by the Expo app immediately after
 * receiving the OAuth deep-link redirect that contains only a `code` param.
 *
 * The code is single-use and expires after 90 seconds.
 *
 * Security properties:
 *  - Tokens are never exposed in a URL (no browser history / server logs risk).
 *  - Code is consumed on first use (atomic GETDEL prevents replay).
 *  - Short TTL (90 s) limits the window for code interception.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { redis } from "@/lib/redis";
import { validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

const ExchangeSchema = z
  .object({
    // Exactly one of `code` or `pre_auth_code` must be provided.
    // `code` is the single-use OAuth exchange code (normal login flow).
    // `pre_auth_code` is the opaque token from the 2FA deep-link (2FA flow).
    code: z.string().min(1).max(128).optional(),
    pre_auth_code: z.string().min(1).max(128).optional(),
  })
  .refine((d) => !!d.code || !!d.pre_auth_code, {
    message: "Either code or pre_auth_code is required",
  });

interface ExchangePayload {
  accessToken: string;
  refreshToken: string;
  userId: string;
  onboardingCompleted: boolean;
  authUser?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.auth);

    const { code, pre_auth_code } = await validateBody(req, ExchangeSchema);

    // If a pre_auth_code is present, resolve it to the actual pre-auth token first.
    // This allows the mobile 2FA flow to pass an opaque code in the deep-link URL
    // rather than the raw JWT, preventing token exposure in logs/history.
    if (pre_auth_code) {
      const preAuthToken = await redis.getdel(`mobile_pre_auth:${pre_auth_code}`);
      if (!preAuthToken) {
        throw badRequest("Invalid or expired pre-auth code", "INVALID_PRE_AUTH_CODE");
      }
      return NextResponse.json({ preAuthToken });
    }

    if (!code) {
      // Handled by Zod refine — should not reach here
      throw badRequest("code is required", "MISSING_CODE");
    }

    // Atomically consume the one-time code. Use the RedisClient getdel adapter
    // instead of Lua eval so this works on both ioredis and Upstash REST.
    const raw = await redis.getdel(`mobile_exchange:${code}`);
    if (!raw) {
      throw badRequest("Invalid or expired exchange code", "INVALID_EXCHANGE_CODE");
    }

    const payload = JSON.parse(raw) as ExchangePayload;

    return NextResponse.json({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      userId: payload.userId,
      onboardingCompleted: payload.onboardingCompleted,
      user: payload.authUser ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
