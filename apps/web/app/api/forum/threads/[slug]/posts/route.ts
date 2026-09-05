export const dynamic = "force-dynamic";

/**
 * app/api/forum/threads/[slug]/posts/route.ts
 *
 * POST /api/forum/threads/[slug]/posts — reply to a thread (auth required).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled, getManifestValue } from "@/lib/manifest";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getThreadBySlug, createReply } from "@/lib/bbforum/repo";
import { db } from "@/lib/db";

const createSchema = z.object({ body: z.string().min(2).max(20000) });

export const POST = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ slug: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { slug } = await params;
    const thread = await getThreadBySlug(slug);
    if (!thread) throw notFound("Thread not found");

    const { rows } = await db.query<{ rank_level: number }>(`SELECT COALESCE(rank_level, 1) AS rank_level FROM users WHERE id = $1`, [auth.user.sub]);
    const minLevelRaw = await getManifestValue("bbforum_min_level_to_post");
    const minLevel = minLevelRaw ? parseInt(minLevelRaw, 10) : 1;
    if ((rows[0]?.rank_level ?? 1) < minLevel) {
      throw forbidden(`Reach level ${minLevel} to reply.`, "BBFORUM_LEVEL_TOO_LOW");
    }

    const body = await validateBody(req, createSchema);
    const post = await createReply({ threadId: thread.id, authorId: auth.user.sub, body: body.body });
    return NextResponse.json({ success: true, data: { post }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
