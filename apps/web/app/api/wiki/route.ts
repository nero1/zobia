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
import { and, eq, isNull } from "drizzle-orm";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listWikis } from "@/lib/wiki/repo";
import { createWiki } from "@/lib/wiki/service";
import { getDb, schema } from "@/lib/db/drizzle";

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

    const db = await getDb();
    const rows = await db
      .select({
        plan: schema.users.plan,
        levelCreator: schema.users.levelCreator,
        isAdmin: schema.users.isAdmin,
        isModerator: schema.users.isModerator,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
      .limit(1);
    const user = rows[0];

    const result = await createWiki({
      userId: auth.user.sub,
      userPlan: user?.plan ?? "free",
      userLevelCreator: user?.levelCreator ?? 0,
      isAdmin: !!user?.isAdmin,
      isModerator: !!user?.isModerator,
      name: body.name,
      description: body.description,
      contributePolicy: body.contributePolicy,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
