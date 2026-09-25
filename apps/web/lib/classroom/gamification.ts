/**
 * lib/classroom/gamification.ts
 *
 * Per-classroom points / levels / badges / leaderboard.
 *
 * Follows the entity-scoped leaderboard pattern already used for games
 * (lib/games/leaderboard.ts: game_best_scores) and guild wars
 * (war_contributions): a per-entity materialised table read with a plain
 * ORDER BY, rather than widening leaderboard_snapshots (whose unique key has
 * no entity id) or the users.xp_* columns (one column per track — a
 * per-classroom track can't live there). Classroom standings are therefore
 * never visible platform-wide; only members of that classroom can read them.
 *
 * Every award ALSO earns a smaller global Knowledge-track XP bonus through the
 * canonical safeAwardXP path, so classroom engagement still counts toward the
 * member's platform profile. That bonus is fired only after the caller's
 * transaction commits (safeAwardXP's documented contract) — see
 * `fireKnowledgeBonuses()`.
 */

import { and, desc, asc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import { memGet, memSet, memDelPrefix } from "@/lib/cache/memory";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { insertNotification } from "@/lib/notifications/insert";
import {
  CLASSROOM_POINT_RULES,
  CLASSROOM_BADGES,
  badgesForSignals,
  levelForPoints,
  levelProgress,
  type BadgeSignals,
  type ClassroomBadgeKey,
  type ClassroomPointSource,
  type LevelProgress,
} from "@/lib/classroom/levels";

type Queryable = DbOrTx;

export interface KnowledgeBonus {
  userId: string;
  amount: number;
  source: string;
  referenceId: string;
}

export interface PointsAwardResult {
  awarded: number;
  points: number;
  level: number;
  leveledUp: boolean;
  newBadges: ClassroomBadgeKey[];
  /** Global Knowledge XP to grant once the surrounding transaction commits. */
  knowledgeBonus: KnowledgeBonus | null;
}

export interface AwardInput {
  roomId: string;
  userId: string;
  source: ClassroomPointSource;
  /** Idempotency key for the classroom ledger (unique per room+user+source). */
  referenceId: string;
  /**
   * Idempotency key for the global Knowledge XP bonus. Defaults to
   * `referenceId`; pass a stable key when the classroom award can legitimately
   * repeat (e.g. like → unlike → like) but the XP bonus must not.
   */
  xpReferenceId?: string;
  /** Extra badge signals the caller already knows (e.g. a perfect quiz). */
  badgeSignals?: Pick<BadgeSignals, "perfectQuiz">;
  /** Classroom slug/name for level-up notification copy + deep link. */
  classroom?: { slug: string | null; name: string };
}

const EMPTY_RESULT: Omit<PointsAwardResult, "points" | "level"> = {
  awarded: 0,
  leveledUp: false,
  newBadges: [],
  knowledgeBonus: null,
};

/**
 * Award (or, for negative rules, deduct) classroom points. Idempotent on
 * (roomId, userId, source, referenceId). Must be called inside the caller's
 * transaction when it is part of a larger write (like/lesson/quiz), so the
 * points and the action commit or roll back together.
 */
export async function awardClassroomPoints(input: AwardInput, client: Queryable): Promise<PointsAwardResult> {
  const rule = CLASSROOM_POINT_RULES[input.source];

  const ledgerRows = await client
    .insert(schema.classroomPointsLedger)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      amount: rule.points,
      source: input.source,
      referenceId: input.referenceId,
    })
    .onConflictDoNothing({
      target: [
        schema.classroomPointsLedger.roomId,
        schema.classroomPointsLedger.userId,
        schema.classroomPointsLedger.source,
        schema.classroomPointsLedger.referenceId,
      ],
      where: sql`${schema.classroomPointsLedger.referenceId} IS NOT NULL`,
    })
    .returning({ id: schema.classroomPointsLedger.id });

  if (!ledgerRows[0]) {
    const standing = await readPoints(input.roomId, input.userId, client);
    return { ...EMPTY_RESULT, points: standing.points, level: standing.level };
  }

  // RETURNING yields the pre-existing `level` (this statement never touches it),
  // so we get old level + new points in one round trip.
  const rows = await client
    .insert(schema.classroomMemberPoints)
    .values({
      roomId: input.roomId,
      userId: input.userId,
      points: Math.max(rule.points, 0),
      level: 1,
    })
    .onConflictDoUpdate({
      target: [schema.classroomMemberPoints.roomId, schema.classroomMemberPoints.userId],
      set: {
        points: sql`GREATEST(${schema.classroomMemberPoints.points} + ${rule.points}, 0)`,
        updatedAt: new Date(),
      },
    })
    .returning({ points: schema.classroomMemberPoints.points, level: schema.classroomMemberPoints.level });
  const points = Number(rows[0]?.points ?? 0);
  const oldLevel = rows[0]?.level ?? 1;
  const level = levelForPoints(points);

  if (level !== oldLevel) {
    await client
      .update(schema.classroomMemberPoints)
      .set({ level })
      .where(and(eq(schema.classroomMemberPoints.roomId, input.roomId), eq(schema.classroomMemberPoints.userId, input.userId)));
  }
  const leveledUp = level > oldLevel;

  const newBadges = await evaluateBadges(
    input.roomId,
    input.userId,
    { ...(input.badgeSignals ?? {}), level },
    signalsForSource(input.source),
    client
  );

  if (leveledUp || newBadges.length > 0) {
    await notifyProgress(input, leveledUp ? level : null, newBadges, client);
  }

  invalidateLeaderboardCache(input.roomId);

  return {
    awarded: rule.points,
    points,
    level,
    leveledUp,
    newBadges,
    knowledgeBonus:
      rule.knowledgeXp > 0
        ? {
            userId: input.userId,
            amount: rule.knowledgeXp,
            source: `classroom_${input.source}`,
            referenceId: input.xpReferenceId ?? `${input.roomId}:${input.referenceId}`,
          }
        : null,
  };
}

/**
 * Grant the global Knowledge-track XP bonuses collected from one or more
 * awards. Call AFTER the transaction that produced them has committed.
 */
export function fireKnowledgeBonuses(results: Array<PointsAwardResult | null | undefined>): void {
  for (const r of results) {
    const b = r?.knowledgeBonus;
    if (!b) continue;
    safeAwardXPFireAndForget(b.userId, b.amount, "knowledge", b.source, b.referenceId);
  }
}

type BadgeCheck = "posts" | "likes" | "lessons";

function signalsForSource(source: ClassroomPointSource): BadgeCheck[] {
  switch (source) {
    case "like_received":
      return ["likes"];
    case "lesson_completed":
    case "course_completed":
      return ["lessons"];
    default:
      return [];
  }
}

/**
 * Evaluate + award badges. `checks` limits which (count) queries run so a
 * like never re-counts lessons. Returns only badges newly awarded now.
 */
export async function evaluateBadges(
  roomId: string,
  userId: string,
  known: BadgeSignals,
  checks: BadgeCheck[],
  client: Queryable
): Promise<ClassroomBadgeKey[]> {
  const signals: BadgeSignals = { ...known };

  if (checks.includes("posts")) {
    const [row] = await client
      .select({ n: sql<string>`COUNT(*)` })
      .from(schema.classroomPosts)
      .where(
        and(
          eq(schema.classroomPosts.roomId, roomId),
          eq(schema.classroomPosts.authorId, userId),
          sql`${schema.classroomPosts.deletedAt} IS NULL`
        )
      );
    signals.postCount = Number(row?.n ?? 0);
  }
  if (checks.includes("likes")) {
    const [row] = await client.execute<{ n: string }>(sql`
      SELECT (
          COALESCE((SELECT SUM(like_count) FROM classroom_posts
                     WHERE room_id = ${roomId} AND author_id = ${userId} AND deleted_at IS NULL), 0)
        + COALESCE((SELECT SUM(like_count) FROM classroom_post_comments
                     WHERE room_id = ${roomId} AND author_id = ${userId} AND deleted_at IS NULL), 0)
        )::text AS n
    `).then((r) => r.rows);
    signals.likesReceived = Number(row?.n ?? 0);
  }
  if (checks.includes("lessons")) {
    const [row] = await client.execute<{ n: string; total: number }>(sql`
      SELECT COUNT(*)::text AS n,
              (SELECT COALESCE(jsonb_array_length(curriculum->'modules'), 0)
                 FROM rooms WHERE id = ${roomId}) AS total
         FROM classroom_lesson_completions
        WHERE room_id = ${roomId} AND user_id = ${userId}
    `).then((r) => r.rows);
    const done = Number(row?.n ?? 0);
    const total = Number(row?.total ?? 0);
    signals.lessonsCompleted = done;
    signals.courseCompleted = total > 0 && done >= total;
  }

  const qualified = badgesForSignals(signals);
  if (qualified.length === 0) return [];

  const rows = await client
    .insert(schema.classroomMemberBadges)
    .values(qualified.map((badgeKey) => ({ roomId, userId, badgeKey })))
    .onConflictDoNothing({
      target: [schema.classroomMemberBadges.roomId, schema.classroomMemberBadges.userId, schema.classroomMemberBadges.badgeKey],
    })
    .returning({ badgeKey: schema.classroomMemberBadges.badgeKey });
  return rows.map((r) => r.badgeKey as ClassroomBadgeKey);
}

async function notifyProgress(
  input: AwardInput,
  newLevel: number | null,
  newBadges: ClassroomBadgeKey[],
  client: Queryable
): Promise<void> {
  const name = input.classroom?.name ?? "your classroom";
  const metadata = { roomId: input.roomId, classroomSlug: input.classroom?.slug ?? null };
  try {
    if (newLevel !== null) {
      await insertNotification(
        client,
        input.userId,
        "classroom_level_up",
        `🎉 Level ${newLevel} in ${name}`,
        `You reached level ${newLevel} in ${name}. Keep contributing!`,
        { ...metadata, level: newLevel }
      );
    }
    for (const key of newBadges) {
      const badge = CLASSROOM_BADGES[key];
      await insertNotification(
        client,
        input.userId,
        "classroom_badge_earned",
        `${badge.emoji} New badge: ${badge.name}`,
        `${badge.description} (${name})`,
        { ...metadata, badgeKey: key }
      );
    }
  } catch (err) {
    // Notification copy must never roll back a points award.
    logger.warn({ err, roomId: input.roomId, userId: input.userId }, "[classroom:gamification] progress notification failed");
  }
}

async function readPoints(roomId: string, userId: string, client: Queryable): Promise<{ points: number; level: number }> {
  const [row] = await client
    .select({ points: schema.classroomMemberPoints.points, level: schema.classroomMemberPoints.level })
    .from(schema.classroomMemberPoints)
    .where(and(eq(schema.classroomMemberPoints.roomId, roomId), eq(schema.classroomMemberPoints.userId, userId)));
  return { points: Number(row?.points ?? 0), level: row?.level ?? 1 };
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = "7d" | "30d" | "all";

export interface ClassroomLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  points: number;
  level: number;
}

const LEADERBOARD_TTL_MS = 30_000;

function leaderboardCacheKey(roomId: string, period: LeaderboardPeriod): string {
  return `classroom:lb:${roomId}:${period}`;
}

function invalidateLeaderboardCache(roomId: string): void {
  memDelPrefix(`classroom:lb:${roomId}:`);
}

/**
 * Classroom leaderboard (top `limit`). All-time reads the materialised
 * classroom_member_points table; 7d/30d sum the ledger for the window.
 * Cached in-process for 30s (no Redis — classroom boards are per-entity and
 * cheap to recompute, and the free-tier Redis budget is reserved for hot
 * platform-wide paths).
 */
export async function getClassroomLeaderboard(
  roomId: string,
  period: LeaderboardPeriod,
  limit = 50
): Promise<ClassroomLeaderboardEntry[]> {
  const key = leaderboardCacheKey(roomId, period);
  const cached = memGet<ClassroomLeaderboardEntry[]>(key);
  if (cached) return cached.slice(0, limit);

  interface Row {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_emoji: string;
    avatar_url: string | null;
    points: string;
    level: number | null;
  }

  const orm = await getDb();
  let rows: Row[];
  if (period === "all") {
    const r = await orm
      .select({
        user_id: schema.classroomMemberPoints.userId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
        avatar_url: schema.users.avatarUrl,
        points: sql<string>`${schema.classroomMemberPoints.points}::text`,
        level: schema.classroomMemberPoints.level,
      })
      .from(schema.classroomMemberPoints)
      .innerJoin(
        schema.users,
        and(eq(schema.users.id, schema.classroomMemberPoints.userId), sql`${schema.users.deletedAt} IS NULL`)
      )
      .where(and(eq(schema.classroomMemberPoints.roomId, roomId), gt(schema.classroomMemberPoints.points, 0)))
      .orderBy(desc(schema.classroomMemberPoints.points), asc(schema.classroomMemberPoints.updatedAt))
      .limit(100);
    rows = r as Row[];
  } else {
    const days = period === "7d" ? 7 : 30;
    const r = await orm
      .select({
        user_id: schema.classroomPointsLedger.userId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
        avatar_url: schema.users.avatarUrl,
        points: sql<string>`SUM(${schema.classroomPointsLedger.amount})::text`,
        level: schema.classroomMemberPoints.level,
      })
      .from(schema.classroomPointsLedger)
      .innerJoin(
        schema.users,
        and(eq(schema.users.id, schema.classroomPointsLedger.userId), sql`${schema.users.deletedAt} IS NULL`)
      )
      .leftJoin(
        schema.classroomMemberPoints,
        and(
          eq(schema.classroomMemberPoints.roomId, schema.classroomPointsLedger.roomId),
          eq(schema.classroomMemberPoints.userId, schema.classroomPointsLedger.userId)
        )
      )
      .where(
        and(
          eq(schema.classroomPointsLedger.roomId, roomId),
          gte(schema.classroomPointsLedger.createdAt, sql`NOW() - (${days}::int * INTERVAL '1 day')`)
        )
      )
      .groupBy(
        schema.classroomPointsLedger.userId,
        schema.users.username,
        schema.users.displayName,
        schema.users.avatarEmoji,
        schema.users.avatarUrl,
        schema.classroomMemberPoints.level
      )
      .having(sql`SUM(${schema.classroomPointsLedger.amount}) > 0`)
      .orderBy(desc(sql`SUM(${schema.classroomPointsLedger.amount})`), asc(schema.classroomPointsLedger.userId))
      .limit(100);
    rows = r as Row[];
  }

  let rank = 0;
  let prevPoints: number | null = null;
  const entries = rows.map((r, i) => {
    const pts = Number(r.points);
    if (prevPoints === null || pts < prevPoints) rank = i + 1;
    prevPoints = pts;
    return {
      rank,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name ?? r.username,
      avatarEmoji: r.avatar_emoji,
      avatarUrl: r.avatar_url,
      points: pts,
      level: r.level ?? 1,
    };
  });

  memSet(key, entries, LEADERBOARD_TTL_MS);
  return entries.slice(0, limit);
}

export interface MemberStanding extends LevelProgress {
  rank: number | null;
  badges: Array<{ key: ClassroomBadgeKey; awardedAt: string }>;
}

/** A member's own all-time standing in a classroom. */
export async function getMemberStanding(roomId: string, userId: string): Promise<MemberStanding> {
  const orm = await getDb();
  const [{ rows: pRows }, bRows] = await Promise.all([
    orm.execute<{ points: string; rank: string | null }>(sql`
      SELECT mp.points::text AS points,
              (SELECT COUNT(*) + 1 FROM classroom_member_points o
                WHERE o.room_id = mp.room_id AND o.points > mp.points)::text AS rank
         FROM classroom_member_points mp
        WHERE mp.room_id = ${roomId} AND mp.user_id = ${userId}
    `),
    orm
      .select({ badgeKey: schema.classroomMemberBadges.badgeKey, awardedAt: schema.classroomMemberBadges.awardedAt })
      .from(schema.classroomMemberBadges)
      .where(and(eq(schema.classroomMemberBadges.roomId, roomId), eq(schema.classroomMemberBadges.userId, userId)))
      .orderBy(asc(schema.classroomMemberBadges.awardedAt)),
  ]);
  const points = Number(pRows[0]?.points ?? 0);
  return {
    ...levelProgress(points),
    rank: pRows[0] && points > 0 ? Number(pRows[0].rank) : null,
    badges: bRows
      .filter((b) => b.badgeKey in CLASSROOM_BADGES)
      .map((b) => ({ key: b.badgeKey as ClassroomBadgeKey, awardedAt: new Date(b.awardedAt).toISOString() })),
  };
}

/** Level lookup for many users at once (feed author chips). */
export async function getLevelsForUsers(roomId: string, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const orm = await getDb();
  const rows = await orm
    .select({ userId: schema.classroomMemberPoints.userId, level: schema.classroomMemberPoints.level })
    .from(schema.classroomMemberPoints)
    .where(
      and(
        eq(schema.classroomMemberPoints.roomId, roomId),
        inArray(schema.classroomMemberPoints.userId, Array.from(new Set(userIds)))
      )
    );
  for (const r of rows) out.set(r.userId, r.level);
  return out;
}
