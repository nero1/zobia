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
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();
      const rows = await orm
        .select({
          id: schema.sponsoredQuests.id,
          autoPaused: schema.sponsoredQuests.autoPaused,
          isActive: schema.sponsoredQuests.isActive,
          tier: schema.businessAccounts.tier,
          accountStatus: schema.businessAccounts.status,
        })
        .from(schema.sponsoredQuests)
        .innerJoin(
          schema.businessAccounts,
          eq(schema.businessAccounts.id, schema.sponsoredQuests.businessAccountId)
        )
        .where(
          and(
            eq(schema.sponsoredQuests.id, questId),
            eq(schema.businessAccounts.userId, auth.user.sub),
            isNull(schema.sponsoredQuests.deletedAt)
          )
        )
        .limit(1);
      const quest = rows[0];
      if (!quest) throw notFound("Sponsored quest not found");
      if (!quest.autoPaused) throw conflict("This quest was not auto-paused — nothing to restart.");
      if (quest.accountStatus !== "active") {
        throw forbidden("Your business account must be active (subscription current, not banned) before restarting this quest.", "BUSINESS_ACCOUNT_NOT_ACTIVE");
      }
      if (!canSubmitSponsoredQuests(quest.tier)) {
        throw forbidden("Sponsored Quests require the Business Growth tier or higher.", "BUSINESS_TIER_TOO_LOW");
      }

      await orm
        .update(schema.sponsoredQuests)
        .set({
          // NOTE (schema mismatch): sponsored_quests has no `updated_at`
          // column in the real DB (db/migrations/0001_consolidated_schema.sql)
          // or in lib/db/schema.ts — the original raw SQL's
          // `updated_at = NOW()` here would have thrown "column does not
          // exist" at runtime. Omitted rather than replicated.
          isActive: true,
          autoPaused: false,
          pauseReason: null,
          pausedAt: null,
        })
        .where(eq(schema.sponsoredQuests.id, questId));
      await syncSponsoredQuestTemplate(orm, questId);

      return NextResponse.json({ success: true, data: { questId, restarted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
