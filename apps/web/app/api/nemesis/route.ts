export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/route.ts
 *
 * GET /api/nemesis
 *   Returns the calling user's current nemesis assignment with full data
 *   shaped for the Expo client: me, nemesis, recentActivity, sprintActive.
 *
 * Sub-action routes live in dedicated files (Next.js App Router):
 *   POST /api/nemesis/challenge → app/api/nemesis/challenge/route.ts
 *   POST /api/nemesis/dismiss  → app/api/nemesis/dismiss/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, forbidden } from "@/lib/api/errors";
import { assignNemesis, compareNemesisProgress } from "@/lib/nemesis/nemesisEngine";
import { getTrackLevelForXP } from "@/lib/xp/engine";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Feature gate constants
// ---------------------------------------------------------------------------

const MIN_COMPETITOR_LEVEL_FOR_CHALLENGE = 40;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface NemesisRow {
  user_id: string;
  nemesis_id: string;
  assigned_at: Date | null;
  dismissed_at: Date | null;
  nemesis_username: string;
  nemesis_display_name: string;
  nemesis_avatar_emoji: string;
  nemesis_rank_name: string;
  nemesis_xp_total: bigint;
  nemesis_city: string | null;
}

async function fetchActiveNemesisRow(
  orm: Awaited<ReturnType<typeof getDb>>,
  userId: string
): Promise<NemesisRow | null> {
  const rows = await orm
    .select({
      user_id: schema.nemesisAssignments.userId,
      nemesis_id: schema.nemesisAssignments.nemesisUserId,
      assigned_at: schema.nemesisAssignments.assignedAt,
      dismissed_at: schema.nemesisAssignments.dismissedAt,
      nemesis_username: schema.users.username,
      nemesis_display_name: schema.users.displayName,
      nemesis_avatar_emoji: schema.users.avatarEmoji,
      nemesis_rank_name: schema.users.rankName,
      nemesis_xp_total: schema.users.xpTotal,
      nemesis_city: schema.users.city,
    })
    .from(schema.nemesisAssignments)
    .innerJoin(schema.users, eq(schema.users.id, schema.nemesisAssignments.nemesisUserId))
    .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)))
    .orderBy(desc(schema.nemesisAssignments.assignedAt))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/nemesis
// ---------------------------------------------------------------------------

/**
 * Returns the user's current nemesis with XP delta comparison.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const manifest = await loadManifest();
    if (!manifest.features.nemesisSystem) {
      return NextResponse.json({ nemesis: null, me: null, recentActivity: [], sprintActive: false });
    }

    const orm = await getDb();

    let nemesisRow = await fetchActiveNemesisRow(orm, userId);

    if (!nemesisRow) {
      // No nemesis — try to assign one (assignNemesis() itself declines for
      // an opted-out user, so surface that distinctly from "no match yet").
      const newAssignment = await assignNemesis(userId, orm);
      if (!newAssignment) {
        // NOTE: users.nemesis_opt_out is not present in lib/db/schema.ts
        // (schema mismatch — flagged, not silently patched). Queried via raw
        // sql`` until the column is added to the Drizzle schema.
        const optOutResult = await orm.execute<{ nemesis_opt_out: boolean }>(
          sql`SELECT COALESCE(nemesis_opt_out, false) AS nemesis_opt_out FROM users WHERE id = ${userId}`
        );
        return NextResponse.json({
          success: true,
          data: { nemesis: null, optedOut: optOutResult.rows[0]?.nemesis_opt_out === true },
          error: null,
        });
      }

      // Refetch with profile — must use nemesis_user_id (the active FK column)
      // and filter by is_active since dismissed_at is only set by the dismiss route
      nemesisRow = await fetchActiveNemesisRow(orm, userId);
      if (!nemesisRow) {
        return NextResponse.json({ success: true, data: { nemesis: null }, error: null });
      }
    }

    // Fetch the calling user's own profile data (including competitor XP for level gate UI)
    const myRows = await orm
      .select({
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
        xp_total: sql<string>`COALESCE(${schema.users.xpTotal}, 0)`,
        xp_competitor: sql<string>`COALESCE(${schema.users.xpCompetitor}, 0)`,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const me = myRows[0];

    // XP comparison
    const comparison = await compareNemesisProgress(userId, nemesisRow.nemesis_id, "main", orm);

    // Recent XP activity for both parties (last 20 events combined).
    // xp_ledger stores the action label in `source` and the awarded amount in
    // `amount` (the canonical columns written by safeAwardXP — see
    // apps/web/lib/xp/safeAwardXP.ts). The `xp_net`/`action` columns were
    // dropped in migration 0020 and never repopulated.
    const activityResult = await orm.execute<{
      id: string;
      user_id: string;
      action: string;
      xp_net: number;
      created_at: string;
    }>(sql`
      (SELECT id, user_id, source AS action,
              amount AS xp_net, created_at
       FROM xp_ledger
       WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 10)
      UNION ALL
      (SELECT id, user_id, source AS action,
              amount AS xp_net, created_at
       FROM xp_ledger
       WHERE user_id = ${nemesisRow.nemesis_id} AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC LIMIT 10)
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const recentActivity = activityResult.rows.map((a) => ({
      id: a.id,
      userId: a.user_id,
      description: (a.action ?? "unknown activity").replace(/_/g, " "),
      xpEarned: a.xp_net,
      createdAt: a.created_at,
    }));

    // Check if there is an active sprint challenge between these two users
    const sprintRows = await orm
      .select({ id: schema.nemesisChallenges.id, expires_at: schema.nemesisChallenges.expiresAt })
      .from(schema.nemesisChallenges)
      .where(
        and(
          or(
            and(eq(schema.nemesisChallenges.challengerId, userId), eq(schema.nemesisChallenges.challengedId, nemesisRow.nemesis_id)),
            and(eq(schema.nemesisChallenges.challengerId, nemesisRow.nemesis_id), eq(schema.nemesisChallenges.challengedId, userId))
          ),
          eq(schema.nemesisChallenges.status, "pending"),
          gt(schema.nemesisChallenges.expiresAt, sql`NOW()`)
        )
      )
      .orderBy(desc(schema.nemesisChallenges.createdAt))
      .limit(1);
    const activeSprint = sprintRows[0] ?? null;

    // A pending challenge sent TO this user (by anyone — not necessarily
    // their current nemesis, since a nemesis reassignment can happen while a
    // challenge is still awaiting response) that they can accept.
    const incomingRows = await orm
      .select({
        id: schema.nemesisChallenges.id,
        challenger_id: schema.nemesisChallenges.challengerId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
      })
      .from(schema.nemesisChallenges)
      .innerJoin(schema.users, eq(schema.users.id, schema.nemesisChallenges.challengerId))
      .where(and(eq(schema.nemesisChallenges.challengedId, userId), eq(schema.nemesisChallenges.status, "pending")))
      .orderBy(desc(schema.nemesisChallenges.createdAt))
      .limit(1);
    const incomingChallenge = incomingRows[0]
      ? {
          challengeId: incomingRows[0].id,
          challengerId: incomingRows[0].challenger_id,
          challengerUsername: incomingRows[0].username,
          challengerDisplayName: incomingRows[0].display_name,
          challengerAvatarEmoji: incomingRows[0].avatar_emoji,
        }
      : null;

    const competitorTrackInfo = getTrackLevelForXP("competitor", Number(me?.xp_competitor ?? 0));

    return NextResponse.json({
      me: {
        userId,
        username: me?.username ?? "",
        displayName: me?.display_name ?? "",
        avatarEmoji: me?.avatar_emoji ?? "😊",
        xp: comparison.userXP,
        competitorLevel: competitorTrackInfo.level,
      },
      nemesis: {
        userId: nemesisRow.nemesis_id,
        username: nemesisRow.nemesis_username,
        displayName: nemesisRow.nemesis_display_name,
        avatarEmoji: nemesisRow.nemesis_avatar_emoji,
        xp: comparison.nemesisXP,
      },
      recentActivity,
      sprintActive: activeSprint !== null,
      sprintEndsAt: activeSprint?.expires_at ?? null,
      incomingChallenge,
      // Legacy fields for web client compatibility
      comparison: {
        userXP: comparison.userXP,
        nemesisXP: comparison.nemesisXP,
        delta: comparison.delta,
        userIsAhead: comparison.userIsAhead,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/nemesis  — redirects to sub-routes for clarity
// NOTE: actual POST actions live at:
//   /api/nemesis/challenge  (challenge/route.ts)
//   /api/nemesis/dismiss    (dismiss/route.ts)
// This stub is kept so any stale client calling POST /api/nemesis with an
// action body still gets a helpful error rather than a 405.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use POST /api/nemesis/challenge or POST /api/nemesis/dismiss.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const manifest = await loadManifest();
    if (!manifest.features.nemesisSystem) {
      return NextResponse.json({ success: false, data: null, error: { code: "FEATURE_DISABLED", message: "Nemesis system is currently disabled" } }, { status: 503 });
    }
    // Read action from request body — stale clients may POST here instead of
    // the dedicated /api/nemesis/challenge or /api/nemesis/dismiss sub-routes.
    const body = await req.json().catch(() => ({})) as { action?: string };
    const action = body.action;

    const orm = await getDb();

    if (action === "dismiss") {
      // Dismiss current assignment
      const updateResult = await orm
        .update(schema.nemesisAssignments)
        .set({ isActive: false })
        .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)));

      // Assign a new nemesis
      const newAssignment = await assignNemesis(userId, orm);

      return NextResponse.json({
        success: true,
        data: {
          dismissed: (updateResult.rowCount ?? 0) > 0,
          newNemesisAssigned: !!newAssignment,
          newNemesisId: newAssignment?.nemesis_id ?? null,
        },
        error: null,
      });
    }

    if (action === "challenge") {
      // Get current nemesis
      const nemesisResult = await orm
        .select({ nemesisUserId: schema.nemesisAssignments.nemesisUserId })
        .from(schema.nemesisAssignments)
        .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)))
        .orderBy(desc(schema.nemesisAssignments.assignedAt))
        .limit(1);
      const nemesisId = nemesisResult[0]?.nemesisUserId;
      if (!nemesisId) throw notFound("No active nemesis to challenge");

      // Enforce Competitor Track Level 40 gate (PRD §7)
      const xpRows = await orm
        .select({ xpCompetitor: schema.users.xpCompetitor })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      const competitorXP = Number(xpRows[0]?.xpCompetitor ?? 0);
      const competitorTrackInfo = getTrackLevelForXP("competitor", competitorXP);
      if (competitorTrackInfo.level < MIN_COMPETITOR_LEVEL_FOR_CHALLENGE) {
        throw forbidden(
          `You must reach Competitor Track Level ${MIN_COMPETITOR_LEVEL_FOR_CHALLENGE} to challenge users to XP sprints.`,
          "LEVEL_GATE",
          { level: MIN_COMPETITOR_LEVEL_FOR_CHALLENGE }
        );
      }

      // Check no challenge already pending
      const existingChallenge = await orm
        .select({ id: schema.nemesisChallenges.id })
        .from(schema.nemesisChallenges)
        .where(
          and(
            eq(schema.nemesisChallenges.challengerId, userId),
            gt(schema.nemesisChallenges.expiresAt, sql`NOW()`),
            eq(schema.nemesisChallenges.status, "pending")
          )
        )
        .limit(1);
      if (existingChallenge.length > 0) {
        throw conflict("You already have a pending challenge", "CHALLENGE_ALREADY_ACTIVE");
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await orm.insert(schema.nemesisChallenges).values({
        challengerId: userId,
        challengedId: nemesisId,
        status: "pending",
        expiresAt,
      });

      // Queue notification (best-effort — don't fail if notifications table doesn't exist)
      try {
        await orm.insert(schema.notifications).values({
          userId: nemesisId,
          type: "nemesis_challenge",
          payload: { challenger_id: userId, expires_at: expiresAt.toISOString() },
        });
      } catch {
        // Notification table may not exist yet — log but don't fail
      }

      return NextResponse.json({
        success: true,
        data: { challengeSent: true, expiresAt: expiresAt.toISOString() },
        error: null,
      });
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: "UNKNOWN_ACTION", message: "Unknown action" } },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
