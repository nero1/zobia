export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/jwt';
import { getSession, ACCESS_TOKEN_COOKIE } from '@/lib/auth/session';
import { enforceRateLimit, getClientIp, RATE_LIMITS } from '@/lib/security/rateLimit';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  // IP-level rate limit before any token work — prevents unauthenticated polling
  const ip = getClientIp(req);
  await enforceRateLimit(ip, "ip", RATE_LIMITS.apiRead);

  const token =
    extractBearerToken(req.headers.get('authorization') ?? '') ??
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const payload = await verifyAccessToken(token);

    // User-level rate limit after identity is established
    await enforceRateLimit(payload.sub, "user", RATE_LIMITS.apiRead);

    const session = await getSession(payload.sid);
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    // is_moderator isn't carried on the access token (unlike is_admin), so
    // it's looked up fresh here — this is the lightweight identity endpoint
    // client pages use for role-gated UI (e.g. the leaderboards Plan column).
    const { rows } = await db.query<{ is_moderator: boolean }>(
      `SELECT is_moderator FROM users WHERE id = $1`,
      [payload.sub]
    );

    return NextResponse.json({
      user: {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        is_admin: payload.is_admin,
        is_moderator: rows[0]?.is_moderator ?? false,
      },
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
