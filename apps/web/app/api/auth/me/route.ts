export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/jwt';
import { getSession, ACCESS_TOKEN_COOKIE } from '@/lib/auth/session';
import { enforceRateLimit, getClientIp, RATE_LIMITS } from '@/lib/security/rateLimit';
import { getDb, schema } from '@/lib/db/drizzle';
import { eq } from 'drizzle-orm';

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
    const orm = await getDb();
    const rows = await orm
      .select({
        isModerator: schema.users.isModerator,
        isSupport: schema.users.isSupport,
        isSeniorSupport: schema.users.isSeniorSupport,
      })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub));

    return NextResponse.json({
      user: {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        is_admin: payload.is_admin,
        is_moderator: rows[0]?.isModerator ?? false,
        is_support: rows[0]?.isSupport ?? false,
        is_senior_support: rows[0]?.isSeniorSupport ?? false,
        // Set only while an admin is impersonating this account — see
        // lib/auth/session.ts createSession() and components/admin/ImpersonationBanner.tsx.
        impersonatedBy: payload.impersonated_by ?? null,
      },
      // Epoch-ms the current access token expires at — read from the JWT's
      // own `exp` claim (already verified above), so this costs nothing
      // extra. Powers the client-side session-expiry countdown warning
      // (lib/auth/sessionExpiryBus.ts); null only if the token is somehow
      // missing a standard `exp` claim.
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null,
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
