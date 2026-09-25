export const dynamic = 'force-dynamic';

/**
 * app/api/council/join/route.ts
 *
 * POST /api/council/join
 *
 * Accept a Platform Council invitation and insert the user into
 * platform_council_members. Users are only eligible if they have received
 * a council_invitation notification in the current month cycle.
 *
 * PRD §15: Top 50 users by legacy_score are invited in the last 7 days of
 * each month. They join by accepting the invitation here.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden, conflict } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";

export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("platformCouncil");
    const userId = auth.user.sub;

    const orm = await getDb();

    // PRD §15: Council requires Prestige 5 or above
    const [userRow] = await orm
      .select({ prestigeCount: schema.users.prestigeCount, legacyScore: schema.users.legacyScore, username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRow) {
      throw forbidden("User not found");
    }
    if ((userRow.prestigeCount ?? 0) < 5) {
      throw forbidden("Platform Council membership requires Prestige 5 or above");
    }

    // Verify there is a pending council_invitation notification for this user
    // issued within the last 14 days (covers the invitation + acceptance window)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [invite] = await orm
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.type, "council_invitation"),
          gte(schema.notifications.createdAt, fourteenDaysAgo)
        )
      )
      .limit(1);

    if (!invite) {
      throw forbidden("No pending council invitation found for your account");
    }

    // Check if user is already an active council member
    const [existing] = await orm
      .select({ id: schema.platformCouncilMembers.id })
      .from(schema.platformCouncilMembers)
      .where(and(eq(schema.platformCouncilMembers.userId, userId), isNull(schema.platformCouncilMembers.leftAt)))
      .limit(1);

    if (existing) {
      throw conflict("You are already an active Platform Council member");
    }

    const cycleMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    await orm.transaction(async (tx) => {
      // Close out any previous council seat for this user (handles re-joiners)
      await tx
        .update(schema.platformCouncilMembers)
        .set({ leftAt: new Date() })
        .where(and(eq(schema.platformCouncilMembers.userId, userId), isNull(schema.platformCouncilMembers.leftAt)));

      // Insert the new membership — ON CONFLICT prevents duplicates from
      // concurrent requests racing past the outer existence check (IMP-IDMP-01).
      const [inserted] = await tx
        .insert(schema.platformCouncilMembers)
        .values({
          userId,
          cycleMonth,
          legacyScore: userRow.legacyScore,
        })
        .onConflictDoNothing({
          target: [schema.platformCouncilMembers.userId, schema.platformCouncilMembers.cycleMonth],
        })
        .returning({ id: schema.platformCouncilMembers.id });
      if (!inserted) {
        throw conflict("You have already joined the Platform Council this cycle");
      }

      // Mark the invitation notification as read
      await tx
        .update(schema.notifications)
        .set({ isRead: true })
        .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, "council_invitation")));
    });

    return NextResponse.json({
      success: true,
      data: {
        cycleMonth,
        legacyScore: Number(userRow.legacyScore),
        message: "Welcome to the Platform Council! Your voice shapes Zobia.",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
