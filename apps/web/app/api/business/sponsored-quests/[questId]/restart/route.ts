export const dynamic = 'force-dynamic';

/**
 * app/api/business/sponsored-quests/[questId]/restart/route.ts
 *
 * POST — restart a Sponsored Quest the system auto-paused because the
 * business account was banned or its subscription/tier lapsed
 * (lib/business/downgradeSweep.ts / lib/plans/subscriptionSweep.ts /
 * the admin "ban" action). Per product decision, an auto-paused quest is
 * never resumed automatically — the owner must come back here once the
 * underlying account issue is resolved (subscription renewed, tier
 * restored, account unbanned) and explicitly restart it.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { canSubmitSponsoredQuests } from "@/lib/business/limits";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

export const POST = withAuth(
  async (_req: NextRequest, { params, auth }: { params: Promise<{ questId: string }>; auth: AuthContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      const { questId } = await params;

      const { rows } = await db.query<{
        id: string;
        auto_paused: boolean;
        is_active: boolean;
        tier: string;
        account_status: string;
      }>(
        `SELECT sq.id, sq.auto_paused, sq.is_active, ba.tier, ba.status AS account_status
         FROM sponsored_quests sq
         JOIN business_accounts ba ON ba.id = sq.business_account_id
         WHERE sq.id = $1 AND ba.user_id = $2 AND sq.deleted_at IS NULL LIMIT 1`,
        [questId, auth.user.sub]
      );
      const quest = rows[0];
      if (!quest) throw notFound("Sponsored quest not found");
      if (!quest.auto_paused) throw conflict("This quest was not auto-paused — nothing to restart.");
      if (quest.account_status !== "active") {
        throw forbidden("Your business account must be active (subscription current, not banned) before restarting this quest.", "BUSINESS_ACCOUNT_NOT_ACTIVE");
      }
      if (!canSubmitSponsoredQuests(quest.tier)) {
        throw forbidden("Sponsored Quests require the Business Growth tier or higher.", "BUSINESS_TIER_TOO_LOW");
      }

      await db.query(
        `UPDATE sponsored_quests
         SET is_active = TRUE, auto_paused = FALSE, pause_reason = NULL, paused_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [questId]
      );
      await syncSponsoredQuestTemplate(db, questId);

      return NextResponse.json({ success: true, data: { questId, restarted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
