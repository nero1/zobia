export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { getDb, schema } from "@/lib/db/drizzle";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    if (!z.string().uuid().safeParse(params.questId).success)
      throw badRequest("Invalid campaign identifier");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const cursor = req.nextUrl.searchParams.get("cursor");
    if (cursor && !z.string().uuid().safeParse(cursor).success)
      throw badRequest("Invalid application cursor");
    const db = await getDb();
    const rows = await db
      .select({
        id: schema.sponsoredQuestApplications.id,
        creatorUsername: schema.users.username,
        proof: schema.sponsoredQuestApplications.completionProof,
        completedAt: schema.sponsoredQuestApplications.completedAt,
      })
      .from(schema.sponsoredQuestApplications)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.sponsoredQuestApplications.creatorId),
      )
      .where(
        and(
          eq(schema.sponsoredQuestApplications.questId, params.questId),
          eq(schema.sponsoredQuestApplications.status, "completed"),
          cursor ? gt(schema.sponsoredQuestApplications.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(schema.sponsoredQuestApplications.id))
      .limit(51);
    const items = rows.slice(0, 50);
    return NextResponse.json(
      {
        success: true,
        data: { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null },
        error: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleApiError(error);
  }
});
