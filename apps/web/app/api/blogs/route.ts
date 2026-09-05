export const dynamic = "force-dynamic";

/**
 * app/api/blogs/route.ts
 *
 * GET  /api/blogs  — cursor-paginated blog discovery list
 *   ?tab=popular|trending|new|random&cursor=&limit=&q=
 * POST /api/blogs  — create a blog for the caller. Personal by default;
 *   pass `businessAccountId` to create it under a business account the
 *   caller owns instead (additive slot quota — see lib/blogs/limits.ts).
 *   A blog beyond the scope's included quota requires a one-time Credits/
 *   Stars unlock, charged automatically using `paymentCurrency` (or the
 *   first admin-accepted currency if omitted) — see createBlog's
 *   CreateBlogResult.slotSource in the response to tell which happened.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listBlogs } from "@/lib/blogs/repo";
import { createBlog } from "@/lib/blogs/service";

const listQuerySchema = z.object({
  tab: z.enum(["popular", "trending", "new", "random", "subscribed"]).default("popular"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
  q: z.string().optional(),
});

const createBlogSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(100),
  tagline: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  /** Create as a blog under this business account (must be owned by the caller) instead of a personal blog. */
  businessAccountId: z.string().uuid().optional(),
  /** Currency to pay with if this blog is beyond the scope's included quota. Defaults to the first admin-accepted currency. */
  paymentCurrency: z.enum(["credits", "stars"]).optional(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listBlogs(query.tab, query.cursor ?? null, query.limit, query.q, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const body = await validateBody(req, createBlogSchema);
    const result = await createBlog({
      userId: auth.user.sub,
      title: body.title,
      tagline: body.tagline,
      description: body.description,
      businessAccountId: body.businessAccountId,
      paymentCurrency: body.paymentCurrency,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
