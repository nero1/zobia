export const dynamic = 'force-dynamic';

/**
 * app/api/creator/sponsored-quests/[questId]/apply/route.ts
 *
 * POST /api/creator/sponsored-quests/[questId]/apply
 *
 * Verified+ creator applies to run a sponsored quest in one of their Rooms.
 *
 * Flow:
 *   1. Verify caller is a creator with tier >= 'verified'
 *   2. Check quest is active and deadline not passed
 *   3. Check max_applications limit not exceeded
 *   4. Prevent duplicate application (UNIQUE on quest_id + creator_id)
 *   5. Insert into sponsored_quest_applications
 *   6. Return { applicationId, status: 'pending' }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { hasTrackUnlock } from "@/lib/xp/trackMilestones";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatorRow {
  is_creator: boolean;
  creator_tier: string | null;
}

interface SponsoredQuestRow {
  id: string;
  is_active: boolean;
  deadline: string;
  max_applications: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Creator tiers that are eligible to apply for sponsored quests. */
const ELIGIBLE_TIERS = new Set(["verified", "elite", "icon"]);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const applySchema = z.object({
  roomId: z.string().uuid("roomId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// POST /api/creator/sponsored-quests/[questId]/apply
// ---------------------------------------------------------------------------

/**
 * Apply to run a sponsored quest. Requires Verified+ creator tier.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: Promise<{ questId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { questId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      // 1. Verify caller is a Verified+ creator
      const orm = await getDb();
      const [creator] = await orm
        .select({ is_creator: schema.users.isCreator, creator_tier: schema.users.creatorTier })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!creator?.is_creator) {
        throw forbidden("Creator account required");
      }
      const hasL20Unlock = await hasTrackUnlock(userId, "creator_verified_badge_quest_marketplace", orm);
      if (!creator.creator_tier || (!ELIGIBLE_TIERS.has(creator.creator_tier) && !hasL20Unlock)) {
        throw forbidden(
          "Verified tier or Creator Track Level 20 is required to apply for sponsored quests"
        );
      }

      // 2. Fetch the quest and verify it's active and deadline not passed
      const [quest] = await orm
        .select({
          id: schema.sponsoredQuests.id,
          is_active: schema.sponsoredQuests.isActive,
          deadline: schema.sponsoredQuests.deadline,
          max_applications: schema.sponsoredQuests.maxApplications,
        })
        .from(schema.sponsoredQuests)
        .where(eq(schema.sponsoredQuests.id, questId))
        .limit(1);
      if (!quest) throw notFound("Sponsored quest not found");
      if (!quest.is_active) throw badRequest("This sponsored quest is no longer active");
      if (!quest.deadline || new Date(quest.deadline) < new Date()) {
        throw badRequest("The deadline for this sponsored quest has passed");
      }

      // 3. Check max_applications limit
      const [appCountRow] = await orm
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.sponsoredQuestApplications)
        .where(eq(schema.sponsoredQuestApplications.questId, questId));
      const currentCount = appCountRow?.count ?? 0;
      if (quest.max_applications != null && currentCount >= quest.max_applications) {
        throw conflict(
          "This sponsored quest has reached its maximum number of applications",
          "MAX_APPLICATIONS_REACHED"
        );
      }

      // 4. Prevent duplicate application
      const [dupRow] = await orm
        .select({ id: schema.sponsoredQuestApplications.id })
        .from(schema.sponsoredQuestApplications)
        .where(
          and(
            eq(schema.sponsoredQuestApplications.questId, questId),
            eq(schema.sponsoredQuestApplications.creatorId, userId)
          )
        )
        .limit(1);
      if (dupRow) {
        throw conflict(
          "You have already applied for this sponsored quest",
          "ALREADY_APPLIED"
        );
      }

      const body = await validateBody(req, applySchema);

      // Verify the room belongs to this creator
      const [roomRow] = await orm
        .select({ id: schema.rooms.id })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.id, body.roomId),
            eq(schema.rooms.creatorId, userId),
            eq(schema.rooms.isActive, true)
          )
        )
        .limit(1);
      if (!roomRow) {
        throw badRequest("Room not found or does not belong to your creator account");
      }

      // 5. Insert application — use 'applied' so complete route can find it
      const [application] = await orm
        .insert(schema.sponsoredQuestApplications)
        .values({
          questId,
          creatorId: userId,
          roomId: body.roomId,
          status: "applied",
          appliedAt: new Date(),
        })
        .returning({ id: schema.sponsoredQuestApplications.id });

      return NextResponse.json(
        {
          success: true,
          data: {
            applicationId: application.id,
            status: "applied",
          },
          error: null,
        },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
