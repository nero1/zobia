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
import { and, eq, ne, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { generateUniqueSlug } from "@/lib/slug";
import { getBusinessPageLimit } from "@/lib/business/limits";
import { listBusinessPagesForAccount } from "@/lib/business/repo";

const createPageSchema = z.object({
  name: z.string().min(2).max(120),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
});

async function getOwnBusinessAccount(userId: string): Promise<{ id: string; tier: string; status: string } | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.businessAccounts.id,
      tier: schema.businessAccounts.tier,
      status: schema.businessAccounts.status,
    })
    .from(schema.businessAccounts)
    .where(eq(schema.businessAccounts.userId, userId))
    .limit(1);
  return row ?? null;
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
    const orm = await getDb();
    const newPageId = await orm.transaction(async (tx) => {
      await tx
        .select({ id: schema.businessAccounts.id })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.id, account.id))
        .for("update");

      const [{ count }] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.businessPages)
        .where(
          and(
            eq(schema.businessPages.businessAccountId, account.id),
            isNull(schema.businessPages.deletedAt),
            ne(schema.businessPages.status, "deactivated")
          )
        );

      if (count >= limit) {
        throw forbidden(
          `Your ${account.tier} plan allows up to ${limit} Business Pages. Upgrade your tier or delete a page to free a slot.`,
          "BUSINESS_PAGE_LIMIT_REACHED"
        );
      }

      const [inserted] = await tx
        .insert(schema.businessPages)
        .values({
          id: pageId,
          businessAccountId: account.id,
          slug,
          name: body.name.trim(),
          bio: body.bio?.trim() || null,
          avatarUrl: body.avatarUrl || null,
          coverImageUrl: body.coverImageUrl || null,
          status: "active",
        })
        .returning({ id: schema.businessPages.id });

      return inserted.id;
    });

    return NextResponse.json(
      { success: true, data: { pageId: newPageId, slug }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
