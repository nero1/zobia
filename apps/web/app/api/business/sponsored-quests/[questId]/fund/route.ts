export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  badRequest,
  handleApiError,
  notFound,
  forbidden,
} from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { fundSponsoredQuest } from "@/lib/quests/sponsoredFunding";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { canSubmitSponsoredQuests } from "@/lib/business/limits";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    if (!z.string().uuid().safeParse(params.questId).success)
      throw badRequest("Invalid campaign identifier");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(
        req,
        z.object({
          maxReserveCoins: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER),
        }),
      ),
      db = await getDb();
    const funding = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub))
        .for("no key update");
      const owned = await tx.execute<{ tier: string }>(
        sql`SELECT b.tier FROM sponsored_quests q JOIN business_accounts b ON b.id=q.business_account_id WHERE q.id=${params.questId} AND b.user_id=${auth.user.sub} AND q.deleted_at IS NULL FOR UPDATE OF q FOR SHARE OF b`,
      );
      if (!owned.rows.length) throw notFound("Campaign not found");
      if (!canSubmitSponsoredQuests(owned.rows[0].tier))
        throw forbidden("Business Growth tier or higher is required");
      return fundSponsoredQuest(
        tx,
        params.questId,
        auth.user.sub,
        body.maxReserveCoins,
      );
    });
    await syncSponsoredQuestTemplate(db, params.questId);
    return NextResponse.json({
      success: true,
      data: {
        questId: params.questId,
        reservedCoins: funding.reservedCoins.toString(),
      },
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
