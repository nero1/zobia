export const dynamic = 'force-dynamic';

/**
 * app/api/creator/sponsored-quests/[questId]/route.ts
 *
 * GET /api/creator/sponsored-quests/[questId]
 *   - Returns detailed view of one sponsored quest including list of applications.
 *   - Requires authentication.
 *
 * PATCH /api/creator/sponsored-quests/[questId]
 *   - Admin updates quest fields (toggle is_active, update deadline).
 *   - Requires admin auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const patchQuestSchema = z.object({
  isActive: z.boolean().optional(),
  deadline: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/creator/sponsored-quests/[questId]
// ---------------------------------------------------------------------------

/**
 * Detailed view of one sponsored quest with its applications.
 */
export const GET = withAuth(
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

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

      const orm = await getDb();

      // Fetch quest
      const questRows = await orm
        .select({
          id: schema.sponsoredQuests.id,
          brandName: schema.sponsoredQuests.brandName,
          title: schema.sponsoredQuests.title,
          description: schema.sponsoredQuests.description,
          requirements: schema.sponsoredQuests.requirements,
          rewardCoins: schema.sponsoredQuests.rewardCoins,
          creatorSharePercent: schema.sponsoredQuests.creatorSharePercent,
          platformSharePercent: schema.sponsoredQuests.platformSharePercent,
          maxApplications: schema.sponsoredQuests.maxApplications,
          deadline: schema.sponsoredQuests.deadline,
          isActive: schema.sponsoredQuests.isActive,
          createdAt: schema.sponsoredQuests.createdAt,
        })
        .from(schema.sponsoredQuests)
        .where(eq(schema.sponsoredQuests.id, questId));
      const quest = questRows[0];
      if (!quest) throw notFound("Sponsored quest not found");

      // Fetch applications with creator profile info
      const applications = await orm
        .select({
          id: schema.sponsoredQuestApplications.id,
          questId: schema.sponsoredQuestApplications.questId,
          creatorId: schema.sponsoredQuestApplications.creatorId,
          roomId: schema.sponsoredQuestApplications.roomId,
          status: schema.sponsoredQuestApplications.status,
          appliedAt: schema.sponsoredQuestApplications.appliedAt,
          creatorUsername: schema.users.username,
          creatorDisplayName: schema.users.displayName,
          creatorAvatarEmoji: schema.users.avatarEmoji,
          creatorTier: schema.users.creatorTier,
        })
        .from(schema.sponsoredQuestApplications)
        .innerJoin(schema.users, eq(schema.users.id, schema.sponsoredQuestApplications.creatorId))
        .where(eq(schema.sponsoredQuestApplications.questId, questId))
        .orderBy(asc(schema.sponsoredQuestApplications.appliedAt));

      return NextResponse.json({
        success: true,
        data: {
          quest,
          applications,
          applicationCount: applications.length,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/creator/sponsored-quests/[questId]
// ---------------------------------------------------------------------------

/**
 * Admin updates a sponsored quest (toggle is_active, update deadline).
 */
export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: Promise<{ questId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { questId } = await params;

      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const body = await validateBody(req, patchQuestSchema);

      const orm = await getDb();

      // Verify quest exists
      const existing = await orm
        .select({ id: schema.sponsoredQuests.id })
        .from(schema.sponsoredQuests)
        .where(eq(schema.sponsoredQuests.id, questId));
      if (!existing[0]) throw notFound("Sponsored quest not found");

      // Build dynamic update
      const updates: Partial<typeof schema.sponsoredQuests.$inferInsert> = {};
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (body.deadline !== undefined) updates.deadline = new Date(body.deadline);

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({
          success: true,
          data: { updated: false, questId },
          error: null,
        });
      }

      await orm.update(schema.sponsoredQuests).set(updates).where(eq(schema.sponsoredQuests.id, questId));

      return NextResponse.json({
        success: true,
        data: { updated: true, questId },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
