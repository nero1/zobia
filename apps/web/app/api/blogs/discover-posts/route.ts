import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateSearchParams } from '@/lib/api/middleware';
import { handleApiError } from '@/lib/api/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { discoverBlogPosts } from '@/lib/blogs/discovery';
export const dynamic = 'force-dynamic';
const query = z.object({ tab: z.enum(['popular','trending','new','random','subscribed']).default('popular'), cursor: z.string().max(1000).optional(), q: z.string().max(200).optional() });
export const GET = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiRead);
    const { tab, cursor, q } = validateSearchParams(req.nextUrl.searchParams, query);
    return NextResponse.json({ success: true, data: await discoverBlogPosts(auth.user.sub,tab,cursor,q), error: null });
  } catch (error) { return handleApiError(error); }
});
