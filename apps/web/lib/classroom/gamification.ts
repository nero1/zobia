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

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
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

type Queryable = Pick<TransactionClient, "query">;

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

  const { rows: ledgerRows } = await client.query<{ id: string }>(
    `INSERT INTO classroom_points_ledger (room_id, user_id, amount, source, reference_id, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (room_id, user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.roomId, input.userId, rule.points, input.source, input.referenceId]
  );

  if (!ledgerRows[0]) {
    const standing = await readPoints(input.roomId, input.userId, client);
    return { ...EMPTY_RESULT, points: standing.points, level: standing.level };
  }

  // RETURNING yields the pre-existing `level` (this statement never touches it),
  // so we get old level + new points in one round trip.
  const { rows } = await client.query<{ points: string; level: number }>(
    `INSERT INTO classroom_member_points (room_id, user_id, points, level, updated_at)
     VALUES ($1, $2, GREATEST($3::bigint, 0), 1, NOW())
     ON CONFLICT (room_id, user_id) DO UPDATE
       SET points = GREATEST(classroom_member_points.points + $3::bigint, 0),
           updated_at = NOW()
     RETURNING points, level`,
    [input.roomId, input.userId, rule.points]
  );
  const points = Number(rows[0]?.points ?? 0);
  const oldLevel = rows[0]?.level ?? 1;
  const level = levelForPoints(points);

  if (level !== oldLevel) {
    await client.query(
      `UPDATE classroom_member_points SET level = $3 WHERE room_id = $1 AND user_id = $2`,
      [input.roomId, input.userId, level]
    );
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
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM classroom_posts
        WHERE room_id = $1 AND author_id = $2 AND deleted_at IS NULL`,
      [roomId, userId]
    );
    signals.postCount = Number(rows[0]?.n ?? 0);
  }
  if (checks.includes("likes")) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT (
          COALESCE((SELECT SUM(like_count) FROM classroom_posts
                     WHERE room_id = $1 AND author_id = $2 AND deleted_at IS NULL), 0)
        + COALESCE((SELECT SUM(like_count) FROM classroom_post_comments
                     WHERE room_id = $1 AND author_id = $2 AND deleted_at IS NULL), 0)
        )::text AS n`,
      [roomId, userId]
    );
    signals.likesReceived = Number(rows[0]?.n ?? 0);
  }
  if (checks.includes("lessons")) {
    const { rows } = await client.query<{ n: string; total: number }>(
      `SELECT COUNT(*)::text AS n,
              (SELECT COALESCE(jsonb_array_length(curriculum->'modules'), 0)
                 FROM rooms WHERE id = $1) AS total
         FROM classroom_lesson_completions
        WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    const done = Number(rows[0]?.n ?? 0);
    const total = Number(rows[0]?.total ?? 0);
    signals.lessonsCompleted = done;
    signals.courseCompleted = total > 0 && done >= total;
  }

  const qualified = badgesForSignals(signals);
  if (qualified.length === 0) return [];

  const { rows } = await client.query<{ badge_key: ClassroomBadgeKey }>(
    `INSERT INTO classroom_member_badges (room_id, user_id, badge_key, awarded_at)
     SELECT $1, $2, k, NOW() FROM unnest($3::text[]) AS k
     ON CONFLICT (room_id, user_id, badge_key) DO NOTHING
     RETURNING badge_key`,
    [roomId, userId, qualified]
  );
  return rows.map((r) => r.badge_key);
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
  const { rows } = await client.query<{ points: string; level: number }>(
    `SELECT points, level FROM classroom_member_points WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  return { points: Number(rows[0]?.points ?? 0), level: rows[0]?.level ?? 1 };
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

  let rows: Row[];
  if (period === "all") {
    ({ rows } = await db.query<Row>(
      `SELECT mp.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
              mp.points::text AS points, mp.level
         FROM classroom_member_points mp
         JOIN users u ON u.id = mp.user_id AND u.deleted_at IS NULL
        WHERE mp.room_id = $1 AND mp.points > 0
        ORDER BY mp.points DESC, mp.updated_at ASC
        LIMIT 100`,
      [roomId]
    ));
  } else {
    const days = period === "7d" ? 7 : 30;
    ({ rows } = await db.query<Row>(
      `SELECT l.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
              SUM(l.amount)::text AS points, mp.level
         FROM classroom_points_ledger l
         JOIN users u ON u.id = l.user_id AND u.deleted_at IS NULL
         LEFT JOIN classroom_member_points mp ON mp.room_id = l.room_id AND mp.user_id = l.user_id
        WHERE l.room_id = $1 AND l.created_at >= NOW() - ($2::int * INTERVAL '1 day')
        GROUP BY l.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url, mp.level
       HAVING SUM(l.amount) > 0
        ORDER BY SUM(l.amount) DESC, l.user_id
        LIMIT 100`,
      [roomId, days]
    ));
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
  const [{ rows: pRows }, { rows: bRows }] = await Promise.all([
    db.query<{ points: string; rank: string | null }>(
      `SELECT mp.points::text AS points,
              (SELECT COUNT(*) + 1 FROM classroom_member_points o
                WHERE o.room_id = mp.room_id AND o.points > mp.points)::text AS rank
         FROM classroom_member_points mp
        WHERE mp.room_id = $1 AND mp.user_id = $2`,
      [roomId, userId]
    ),
    db.query<{ badge_key: ClassroomBadgeKey; awarded_at: string }>(
      `SELECT badge_key, awarded_at FROM classroom_member_badges
        WHERE room_id = $1 AND user_id = $2 ORDER BY awarded_at`,
      [roomId, userId]
    ),
  ]);
  const points = Number(pRows[0]?.points ?? 0);
  return {
    ...levelProgress(points),
    rank: pRows[0] && points > 0 ? Number(pRows[0].rank) : null,
    badges: bRows
      .filter((b) => b.badge_key in CLASSROOM_BADGES)
      .map((b) => ({ key: b.badge_key, awardedAt: new Date(b.awarded_at).toISOString() })),
  };
}

/** Level lookup for many users at once (feed author chips). */
export async function getLevelsForUsers(roomId: string, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const { rows } = await db.query<{ user_id: string; level: number }>(
    `SELECT user_id, level FROM classroom_member_points WHERE room_id = $1 AND user_id = ANY($2::uuid[])`,
    [roomId, Array.from(new Set(userIds))]
  );
  for (const r of rows) out.set(r.user_id, r.level);
  return out;
}
