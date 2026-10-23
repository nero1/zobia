import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { redis } from '@/lib/redis';
import { validateBody } from '@/lib/api/middleware';
import { handleApiError } from '@/lib/api/errors';
import { enforceRateLimit, getClientIp, RATE_LIMITS } from '@/lib/security/rateLimit';

export async function POST(req: NextRequest) {
  try {
    await enforceRateLimit(getClientIp(req), 'ip', RATE_LIMITS.auth);
    const { code } = await validateBody(req,z.object({code:z.string().min(16).max(128)}).strict());
    const token = await redis.getdel(`web_pre_auth:${code}`);
    if (!token) return NextResponse.json({ error: 'Code expired or invalid' }, { status: 401 });
    return NextResponse.json({ token },{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return handleApiError(error); }
}
