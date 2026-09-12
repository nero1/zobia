export const dynamic = 'force-dynamic';

/**
 * app/api/admin/quest-boosts/[boostId]/route.ts
 *
 * DELETE — end a quest-category boost early (or clean up a mistaken one).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

      const { rowCount } = await db.query(`DELETE FROM quest_feature_boosts WHERE id = $1`, [boostId]);
      if (!rowCount) throw notFound("Boost not found");

      return NextResponse.json({ success: true, data: { boostId, deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
