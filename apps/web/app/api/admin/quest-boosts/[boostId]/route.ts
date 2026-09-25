export const dynamic = 'force-dynamic';

/**
 * app/api/admin/quest-boosts/[boostId]/route.ts
 *
 * DELETE — end a quest-category boost early (or clean up a mistaken one).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
// NOTE: `questFeatureBoosts` is defined in lib/db/schema.ts but omitted from
// the `schema` bundle object exported from there (a pre-existing gap,
// reported rather than silently added to the shared schema) — imported
// directly.
import { questFeatureBoosts } from "@/lib/db/schema";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withAdminAuth(
  async (_req: NextRequest, { params, auth }: { params: Promise<{ boostId: string }>; auth: AdminContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { boostId } = await params;
      if (!UUID_RE.test(boostId)) throw badRequest("boostId must be a valid UUID");

      const orm = await getDb();
      const deleted = await orm
        .delete(questFeatureBoosts)
        .where(eq(questFeatureBoosts.id, boostId))
        .returning({ id: questFeatureBoosts.id });
      if (deleted.length === 0) throw notFound("Boost not found");

      return NextResponse.json({ success: true, data: { boostId, deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
