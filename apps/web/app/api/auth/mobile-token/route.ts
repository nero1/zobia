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

const ExchangeSchema = z.object({
  code: z.string().min(1).max(128),
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

    const { code } = await validateBody(req, ExchangeSchema);

    // Atomically GET-and-DEL to make the code single-use (no getdel in interface)
    const raw = await redis.eval(
      `local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v`,
      1,
      `mobile_exchange:${code}`
    ) as string | null;
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
