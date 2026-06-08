export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/jwt';
import { getSession, ACCESS_TOKEN_COOKIE } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const token =
    extractBearerToken(req.headers.get('authorization') ?? '') ??
    req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const payload = await verifyAccessToken(token);
    const session = await getSession(payload.sid);
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({
      user: {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        is_admin: payload.is_admin,
      },
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
