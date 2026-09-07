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

    // is_moderator/is_support/is_senior_support are looked up fresh here
    // (rather than trusted from the access token) — this is the lightweight
    // identity endpoint client pages use for role-gated UI (e.g. the
    // leaderboards Plan column, and the /gate44/support/* client-side
    // "who am I" checks used alongside the middleware edge pre-filter).
    const { rows } = await db.query<{ is_moderator: boolean; is_support: boolean; is_senior_support: boolean }>(
      `SELECT is_moderator, COALESCE(is_support, false) AS is_support, COALESCE(is_senior_support, false) AS is_senior_support
       FROM users WHERE id = $1`,
      [payload.sub]
    );

    return NextResponse.json({
      user: {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        is_admin: payload.is_admin,
        is_moderator: rows[0]?.is_moderator ?? false,
        is_support: rows[0]?.is_support ?? false,
        is_senior_support: rows[0]?.is_senior_support ?? false,
        // Set only while an admin is impersonating this account — see
        // lib/auth/session.ts createSession() and components/admin/ImpersonationBanner.tsx.
        impersonatedBy: payload.impersonated_by ?? null,
      },
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
