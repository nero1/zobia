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
import { db } from "@/lib/db";
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
      const creatorResult = await db.query<CreatorRow>(
        `SELECT is_creator, creator_tier
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [userId]
      );
      const creator = creatorResult.rows[0];
      if (!creator?.is_creator) {
        throw forbidden("Creator account required");
      }
      const hasL20Unlock = await hasTrackUnlock(userId, "creator_verified_badge_quest_marketplace", db);
      if (!creator.creator_tier || (!ELIGIBLE_TIERS.has(creator.creator_tier) && !hasL20Unlock)) {
        throw forbidden(
          "Verified tier or Creator Track Level 20 is required to apply for sponsored quests"
        );
      }

      // 2. Fetch the quest and verify it's active and deadline not passed
      const questResult = await db.query<SponsoredQuestRow>(
        `SELECT id, is_active, deadline, max_applications
         FROM sponsored_quests
         WHERE id = $1`,
        [questId]
      );
      const quest = questResult.rows[0];
      if (!quest) throw notFound("Sponsored quest not found");
      if (!quest.is_active) throw badRequest("This sponsored quest is no longer active");
      if (new Date(quest.deadline) < new Date()) {
        throw badRequest("The deadline for this sponsored quest has passed");
      }

      // 3. Check max_applications limit
      const appCountResult = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sponsored_quest_applications WHERE quest_id = $1`,
        [questId]
      );
      const currentCount = appCountResult.rows[0]?.count ?? 0;
      if (currentCount >= quest.max_applications) {
        throw conflict(
          "This sponsored quest has reached its maximum number of applications",
          "MAX_APPLICATIONS_REACHED"
        );
      }

      // 4. Prevent duplicate application
      const dupCheck = await db.query<{ id: string }>(
        `SELECT id FROM sponsored_quest_applications
         WHERE quest_id = $1 AND creator_id = $2
         LIMIT 1`,
        [questId, userId]
      );
      if (dupCheck.rows.length > 0) {
        throw conflict(
          "You have already applied for this sponsored quest",
          "ALREADY_APPLIED"
        );
      }

      const body = await validateBody(req, applySchema);

      // Verify the room belongs to this creator
      const roomCheck = await db.query<{ id: string }>(
        `SELECT id FROM rooms WHERE id = $1 AND creator_id = $2 AND is_active = TRUE LIMIT 1`,
        [body.roomId, userId]
      );
      if (!roomCheck.rows[0]) {
        throw badRequest("Room not found or does not belong to your creator account");
      }

      // 5. Insert application — use 'applied' so complete route can find it
      const insertResult = await db.query<{ id: string }>(
        `INSERT INTO sponsored_quest_applications
           (quest_id, creator_id, room_id, status, applied_at)
         VALUES ($1, $2, $3, 'applied', NOW())
         RETURNING id`,
        [questId, userId, body.roomId]
      );
      const application = insertResult.rows[0];

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
