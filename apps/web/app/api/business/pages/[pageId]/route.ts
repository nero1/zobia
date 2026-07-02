export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/[pageId]/route.ts
 *
 * GET    — page details + its posts (owner or platform moderator/admin only).
 * PATCH  — update name/bio/avatar/cover.
 * DELETE — remove the page, freeing a slot for the account's tier.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";
import { getBusinessPageById, listBusinessPagePosts } from "@/lib/business/repo";

interface PageCtx {
  params: Promise<{ pageId: string }>;
  auth: AuthContext;
}

const updatePageSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
});

async function assertOwnerOrModerator(pageId: string, userId: string): Promise<{ pageId: string; businessAccountId: string }> {
  const { rows } = await db.query<{ id: string; business_account_id: string; owner_user_id: string }>(
    `SELECT bp.id, bp.business_account_id, ba.user_id AS owner_user_id
     FROM business_pages bp
     JOIN business_accounts ba ON ba.id = bp.business_account_id
     WHERE bp.id = $1 AND bp.deleted_at IS NULL LIMIT 1`,
    [pageId]
  );
  if (!rows[0]) throw notFound("Business page not found");
  if (rows[0].owner_user_id !== userId && !(await isUserModeratorOrAdmin(userId))) {
    throw forbidden("Only the page owner or a moderator can manage this page.");
  }
  return { pageId: rows[0].id, businessAccountId: rows[0].business_account_id };
}

export const GET = withAuth(async (_req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const page = await getBusinessPageById(pageId);
    if (!page) throw notFound("Business page not found");
    const posts = await listBusinessPagePosts(pageId);

    return NextResponse.json({ success: true, data: { page, posts }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const body = await validateBody(req, updatePageSchema);
    const setParts: string[] = ["updated_at = NOW()"];
    const values: SqlParam[] = [pageId];
    let idx = 2;
    const fieldMap: Record<string, string> = {
      name: "name",
      bio: "bio",
      avatarUrl: "avatar_url",
      coverImageUrl: "cover_image_url",
    };
    for (const [jsKey, col] of Object.entries(fieldMap)) {
      const val = (body as Record<string, unknown>)[jsKey];
      if (val !== undefined) {
        setParts.push(`${col} = $${idx++}`);
        values.push(val as SqlParam);
      }
    }
    if (setParts.length > 1) {
      await db.query(`UPDATE business_pages SET ${setParts.join(", ")} WHERE id = $1`, values);
    }

    return NextResponse.json({ success: true, data: { pageId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    await db.query(`UPDATE business_pages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [pageId]);
    // Any sponsored quests attributed to this page keep their history but lose the live attribution.
    await db.query(`UPDATE sponsored_quests SET is_active = FALSE WHERE business_page_id = $1 AND is_active = TRUE`, [pageId]);

    return NextResponse.json({ success: true, data: { pageId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
