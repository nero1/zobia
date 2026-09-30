export const dynamic = 'force-dynamic';

/**
 * app/api/admin/portals/hashtags/route.ts
 *
 * GET  /api/admin/portals/hashtags?q=<text>&blocked=1
 *   Tag explorer (includes blocked tags; top by use_count) so admins can find
 *   a tag to curate, merge or block.
 *
 * POST /api/admin/portals/hashtags
 *   { action: "merge",   slug, into }  merge #slug into #into (aliases + links move)
 *   { action: "block",   slug }        blocklist a tag (links removed, portal suppressed)
 *   { action: "unblock", slug }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { mergeHashtags, setHashtagBlocked, resolvePortal } from "@/lib/portals/repo";
import { hashtagActionSchema } from "@/lib/portals/schemas";
import { invalidatePortalCache } from "@/lib/portals/cache";
import { invalidateSuggestionCache } from "@/lib/portals/suggestions";

const querySchema = z.object({
  q: z.string().trim().max(50).default(""),
  blocked: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Invalid query", { issues: parsed.error.issues });
    const { q, blocked, limit } = parsed.data;
    const orm = await getDb();
    const like = `${q.replace(/^#/, "").toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await orm
      .select({
        slug: schema.hashtags.slug,
        display: schema.hashtags.display,
        useCount: schema.hashtags.useCount,
        isBlocked: schema.hashtags.isBlocked,
        aliasOf: schema.hashtags.aliasOf,
        lastUsedAt: schema.hashtags.lastUsedAt,
        hasPortal: sql<boolean>`EXISTS (SELECT 1 FROM portals p WHERE p.hashtag_id = ${schema.hashtags.id})`,
      })
      .from(schema.hashtags)
      .where(and(eq(schema.hashtags.isBlocked, blocked === "1"), sql`${schema.hashtags.slug} LIKE ${like}`))
      .orderBy(desc(schema.hashtags.useCount), schema.hashtags.slug)
      .limit(limit);
    return NextResponse.json({ success: true, data: { hashtags: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, hashtagActionSchema);

    // Capture affected portals BEFORE the change so their caches can be dropped.
    const before = await Promise.all([resolvePortal(body.slug, { includeSuppressed: true }), body.action === "merge" ? resolvePortal(body.into, { includeSuppressed: true }) : null]);

    let data: Record<string, unknown>;
    if (body.action === "merge") {
      data = await mergeHashtags(body.slug, body.into);
      writeAuditLog({ actorId: auth.user.sub, action: "admin_hashtag_merge", targetType: "hashtag", targetId: body.slug, metadata: { into: body.into, ...data } });
    } else {
      await setHashtagBlocked(body.slug, body.action === "block");
      data = { slug: body.slug, blocked: body.action === "block" };
      writeAuditLog({ actorId: auth.user.sub, action: body.action === "block" ? "admin_hashtag_block" : "admin_hashtag_unblock", targetType: "hashtag", targetId: body.slug });
    }

    await Promise.all([
      ...before.filter(Boolean).map((p) => invalidatePortalCache(p!.row.id)),
      invalidateSuggestionCache(),
    ]);
    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
