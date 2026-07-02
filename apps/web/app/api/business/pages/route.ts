export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/route.ts
 *
 * Business Pages — the account owner's manageable pages (PRD §17). Each
 * business tier gets a slot limit (Starter 2, Growth 10, Enterprise 50,
 * admin-configurable via x_manifest). Sponsored quests and future adverts
 * are attributed to a page.
 *
 * GET  /api/business/pages  — list the caller's pages + slot usage.
 * POST /api/business/pages  — create a page (rejected once the tier's slot
 *   limit is reached).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { generateUniqueSlug } from "@/lib/slug";
import { getBusinessPageLimit } from "@/lib/business/limits";
import { listBusinessPagesForAccount, countActiveBusinessPages } from "@/lib/business/repo";

const createPageSchema = z.object({
  name: z.string().min(2).max(120),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
});

async function getOwnBusinessAccount(userId: string): Promise<{ id: string; tier: string; status: string } | null> {
  const { rows } = await db.query<{ id: string; tier: string; status: string }>(
    `SELECT id, tier, status FROM business_accounts WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const account = await getOwnBusinessAccount(auth.user.sub);
    if (!account) throw notFound("Business account not found");

    const [pages, limit] = await Promise.all([
      listBusinessPagesForAccount(account.id),
      getBusinessPageLimit(account.tier),
    ]);

    return NextResponse.json({
      success: true,
      data: { pages, limit, used: pages.filter((p) => p.status !== "deactivated").length },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const account = await getOwnBusinessAccount(auth.user.sub);
    if (!account) throw notFound("Business account not found");
    if (account.status !== "active") {
      throw forbidden("Your business account must be active to create a page.", "BUSINESS_ACCOUNT_INACTIVE");
    }

    const body = await validateBody(req, createPageSchema);

    const limit = await getBusinessPageLimit(account.tier);
    const pageId = randomUUID();
    const slug = await generateUniqueSlug("business_page", body.name, pageId);

    // BIZ-PAGE-RACE: a plain "count, then insert" has a TOCTOU window —
    // two concurrent POSTs could both read a count below the limit and both
    // insert, exceeding it. Lock the business_accounts row for the duration
    // of the count-check + insert so concurrent creates for the same
    // account serialise (mirrors the atomic-reservation pattern used by
    // business signup's pending-payment guard).
    const { rows } = await db.transaction(async (tx) => {
      await tx.query(`SELECT id FROM business_accounts WHERE id = $1 FOR UPDATE`, [account.id]);
      const used = await countActiveBusinessPages(account.id, tx);
      if (used >= limit) {
        throw forbidden(
          `Your ${account.tier} plan allows up to ${limit} Business Pages. Upgrade your tier or delete a page to free a slot.`,
          "BUSINESS_PAGE_LIMIT_REACHED"
        );
      }
      return tx.query<{ id: string }>(
        `INSERT INTO business_pages
           (id, business_account_id, slug, name, bio, avatar_url, cover_image_url, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
         RETURNING id`,
        [pageId, account.id, slug, body.name.trim(), body.bio?.trim() || null, body.avatarUrl || null, body.coverImageUrl || null]
      );
    });

    return NextResponse.json(
      { success: true, data: { pageId: rows[0].id, slug }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
