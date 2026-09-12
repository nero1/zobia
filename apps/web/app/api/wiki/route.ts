export const dynamic = "force-dynamic";

/**
 * app/api/wiki/route.ts
 *
 * GET  /api/wiki  — cursor-paginated wiki discovery list
 *   ?tab=popular|trending|new|random&cursor=&limit=&q=
 * POST /api/wiki  — create a wiki for the caller, subject to the site
 *   admin's creation gate (role/plan/level — see lib/wiki/limits.ts) and
 *   the caller's plan quota.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listWikis } from "@/lib/wiki/repo";
import { createWiki } from "@/lib/wiki/service";
import { db } from "@/lib/db";

const listQuerySchema = z.object({
  tab: z.enum(["popular", "trending", "new", "random"]).default("popular"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
  q: z.string().optional(),
});

const createWikiSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  contributePolicy: z.enum(["everyone", "friends", "selected"]).optional(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listWikis(query.tab, query.cursor ?? null, query.limit, query.q);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const body = await validateBody(req, createWikiSchema);

    const { rows } = await db.query<{ plan: string; level_creator: number; is_admin: boolean; is_moderator: boolean }>(
      `SELECT plan, level_creator, is_admin, COALESCE(is_moderator, false) AS is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const user = rows[0];

    const result = await createWiki({
      userId: auth.user.sub,
      userPlan: user?.plan ?? "free",
      userLevelCreator: user?.level_creator ?? 0,
      isAdmin: !!user?.is_admin,
      isModerator: !!user?.is_moderator,
      name: body.name,
      description: body.description,
      contributePolicy: body.contributePolicy,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
