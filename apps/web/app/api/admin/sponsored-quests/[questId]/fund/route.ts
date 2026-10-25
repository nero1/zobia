export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/drizzle";
import { fundSponsoredQuest } from "@/lib/quests/sponsoredFunding";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
export const POST = withAdminAuth(
  async (req: NextRequest, { params, auth }) => {
    try {
      if (!z.string().uuid().safeParse(params.questId).success)
        throw badRequest("Invalid campaign identifier");
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const body = await validateBody(
        req,
        z.object({
          maxReserveCoins: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER),
        }),
      );
      const db = await getDb();
      const funding = await db.transaction((tx) =>
        fundSponsoredQuest(
          tx,
          params.questId,
          auth.user.sub,
          body.maxReserveCoins,
        ),
      );
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
  },
);
