/**
 * lib/classroom/stats.ts
 *
 * Creator-panel analytics for classrooms — one classroom, or every classroom
 * a creator owns (the Studio summary). Depth is gated by
 * lib/classroom/limits.ts. Reads are cached exactly like
 * GET /api/creator/dashboard: 15s in-process + 60s Redis, keyed per
 * classroom/creator AND tier (so an upgrade shows richer stats at once).
 *
 * Revenue is read from creator_earnings (source_type 'classroom_enrolment',
 * reference_id = classroom_enrolments.id) — the same rows the shared payout
 * pipeline pays out from.
 *
 * NOTE: the aggregate queries below (correlated subqueries, LATERAL joins,
 * generate_series calendars) are executed via Drizzle's `sql` template tag
 * through the typed `getDb()` instance rather than rebuilt with the fluent
 * query builder — expressing them with the builder would add real risk of
 * subtly changing the aggregation semantics for no behavioural benefit. This
 * still runs through the shared Drizzle/pg.Pool connection, not the legacy
 * legacy raw-SQL adapter.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";
import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";
import { logger } from "@/lib/logger";
import { getClassroomLeaderboard, type ClassroomLeaderboardEntry } from "@/lib/classroom/gamification";
import { parseModules } from "@/lib/classroom/curriculum";
import { statsTierAtLeast, type ClassroomStatsTier } from "@/lib/classroom/limits";

const MEM_TTL_MS = 15_000;
const REDIS_TTL_S = 60;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const mem = memGet<T>(key);
  if (mem) return mem;
  try {
    const hit = await redis.get(key);
    if (hit) {
      const parsed = JSON.parse(hit) as T;
      memSet(key, parsed, MEM_TTL_MS);
      return parsed;
    }
  } catch {
    // Cache miss / Redis blip — fall through to Postgres.
  }
  const value = await load();
  memSet(key, value, MEM_TTL_MS);
  redis.setex(key, REDIS_TTL_S, JSON.stringify(value)).catch((err: unknown) => {
    logger.warn({ err, key }, "[classroom:stats] cache write failed");
  });
  return value;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------
// Per-classroom stats
// ---------------------------------------------------------------------------

export interface ClassroomStatsBasic {
  members: number;
  paidMembers: number;
  revenueAllTimeKobo: number;
  posts: number;
  lessons: number;
  upcomingEvents: number;
  moderators: number;
}

export interface ClassroomStatsMore {
  newMembers7d: number;
  newMembers30d: number;
  activeMembers7d: number;
  revenue30dKobo: number;
  comments: number;
  likes: number;
  courseCompletions: number;
  /** 0-100: lesson completions / (members × lessons). */
  lessonCompletionRate: number;
  quizAttempts: number;
  /** 0-100. */
  quizPassRate: number;
  shares: number;
  pageViews30d: number;
}

export interface ClassroomDailyPoint {
  day: string;
  enrolments: number;
  revenueKobo: number;
  pageViews: number;
  posts: number;
}

export interface ClassroomStatsDetailed {
  daily: ClassroomDailyPoint[];
  lessonFunnel: Array<{ moduleId: string; title: string; completions: number }>;
  topContributors: ClassroomLeaderboardEntry[];
  /** 0-100: 30-day enrolments / 30-day page views. Null with no views. */
  viewToEnrolmentRate: number | null;
}

export interface ClassroomStats {
  tier: ClassroomStatsTier;
  basic: ClassroomStatsBasic;
  more: ClassroomStatsMore | null;
  detailed: ClassroomStatsDetailed | null;
}

export async function getClassroomStats(roomId: string, tier: ClassroomStatsTier): Promise<ClassroomStats> {
  return cached(`classroom:stats:${roomId}:${tier}`, async () => {
    const orm = await getDb();
    const [room] = await orm.select({ curriculum: schema.rooms.curriculum }).from(schema.rooms).where(eq(schema.rooms.id, roomId));
    const modules = parseModules(room?.curriculum);

    const { rows: b } = await orm.execute<Record<string, string>>(sql`
      SELECT
         (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId}) AS members,
         (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId} AND paid) AS paid_members,
         (SELECT COALESCE(SUM(e.net_amount_kobo), 0) FROM creator_earnings e
            JOIN classroom_enrolments ce ON ce.id::text = e.reference_id
           WHERE ce.room_id = ${roomId} AND e.source_type = 'classroom_enrolment') AS revenue_all,
         (SELECT COUNT(*) FROM classroom_posts WHERE room_id = ${roomId} AND deleted_at IS NULL) AS posts,
         (SELECT COUNT(*) FROM classroom_events WHERE room_id = ${roomId} AND deleted_at IS NULL AND starts_at >= NOW()) AS upcoming_events,
         (SELECT COUNT(*) FROM classroom_moderators WHERE room_id = ${roomId} AND status = 'active' AND is_moderator) AS moderators
    `);
    const basic: ClassroomStatsBasic = {
      members: num(b[0]?.members),
      paidMembers: num(b[0]?.paid_members),
      revenueAllTimeKobo: num(b[0]?.revenue_all),
      posts: num(b[0]?.posts),
      lessons: modules.length,
      upcomingEvents: num(b[0]?.upcoming_events),
      moderators: num(b[0]?.moderators),
    };

    let more: ClassroomStatsMore | null = null;
    if (statsTierAtLeast(tier, "more")) {
      const { rows: m } = await orm.execute<Record<string, string>>(sql`
        SELECT
           (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId} AND enrolled_at >= NOW() - INTERVAL '7 days') AS new_7d,
           (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId} AND enrolled_at >= NOW() - INTERVAL '30 days') AS new_30d,
           (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId} AND last_active_at >= NOW() - INTERVAL '7 days') AS active_7d,
           (SELECT COALESCE(SUM(e.net_amount_kobo), 0) FROM creator_earnings e
              JOIN classroom_enrolments ce ON ce.id::text = e.reference_id
             WHERE ce.room_id = ${roomId} AND e.source_type = 'classroom_enrolment'
               AND e.created_at >= NOW() - INTERVAL '30 days') AS revenue_30d,
           (SELECT COUNT(*) FROM classroom_post_comments WHERE room_id = ${roomId} AND deleted_at IS NULL) AS comments,
           (SELECT COUNT(*) FROM classroom_likes WHERE room_id = ${roomId}) AS likes,
           (SELECT COUNT(*) FROM classroom_enrolments WHERE room_id = ${roomId} AND completed_at IS NOT NULL) AS completions,
           (SELECT COUNT(*) FROM classroom_lesson_completions WHERE room_id = ${roomId}) AS lesson_completions,
           (SELECT COUNT(*) FROM classroom_quiz_attempts a JOIN classroom_quizzes q ON q.id = a.quiz_id WHERE q.room_id = ${roomId}) AS quiz_attempts,
           (SELECT COUNT(*) FROM classroom_quiz_attempts a JOIN classroom_quizzes q ON q.id = a.quiz_id WHERE q.room_id = ${roomId} AND a.passed) AS quiz_passes,
           (SELECT COALESCE(SUM(share_count), 0) FROM classroom_shares WHERE room_id = ${roomId}) AS shares,
           (SELECT COALESCE(SUM(page_views), 0) FROM classroom_daily_stats WHERE room_id = ${roomId} AND day >= CURRENT_DATE - 29) AS views_30d
      `);
      const r = m[0] ?? {};
      const possibleCompletions = basic.members * modules.length;
      const attempts = num(r.quiz_attempts);
      more = {
        newMembers7d: num(r.new_7d),
        newMembers30d: num(r.new_30d),
        activeMembers7d: num(r.active_7d),
        revenue30dKobo: num(r.revenue_30d),
        comments: num(r.comments),
        likes: num(r.likes),
        courseCompletions: num(r.completions),
        lessonCompletionRate: possibleCompletions > 0 ? Math.round((num(r.lesson_completions) / possibleCompletions) * 100) : 0,
        quizAttempts: attempts,
        quizPassRate: attempts > 0 ? Math.round((num(r.quiz_passes) / attempts) * 100) : 0,
        shares: num(r.shares),
        pageViews30d: num(r.views_30d),
      };
    }

    let detailed: ClassroomStatsDetailed | null = null;
    if (statsTierAtLeast(tier, "detailed")) {
      const [{ rows: daily }, { rows: funnel }, topContributors] = await Promise.all([
        orm.execute<{ day: string; enrolments: string; revenue: string; views: string; posts: string }>(sql`
          SELECT d.day::text AS day,
                  (SELECT COUNT(*) FROM classroom_enrolments ce
                    WHERE ce.room_id = ${roomId} AND ce.enrolled_at::date = d.day) AS enrolments,
                  (SELECT COALESCE(SUM(e.net_amount_kobo), 0) FROM creator_earnings e
                     JOIN classroom_enrolments ce ON ce.id::text = e.reference_id
                    WHERE ce.room_id = ${roomId} AND e.source_type = 'classroom_enrolment' AND e.created_at::date = d.day) AS revenue,
                  COALESCE((SELECT page_views FROM classroom_daily_stats s WHERE s.room_id = ${roomId} AND s.day = d.day), 0) AS views,
                  (SELECT COUNT(*) FROM classroom_posts p WHERE p.room_id = ${roomId} AND p.created_at::date = d.day AND p.deleted_at IS NULL) AS posts
             FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, INTERVAL '1 day') AS d(day)
            ORDER BY d.day
        `),
        orm.execute<{ module_id: string; n: string }>(sql`
          SELECT module_id, COUNT(*)::text AS n FROM classroom_lesson_completions WHERE room_id = ${roomId} GROUP BY module_id
        `),
        getClassroomLeaderboard(roomId, "30d", 5),
      ]);
      const funnelMap = new Map(funnel.map((f) => [f.module_id, num(f.n)]));
      const views30 = daily.reduce((s, d) => s + num(d.views), 0);
      const enrol30 = daily.reduce((s, d) => s + num(d.enrolments), 0);
      detailed = {
        daily: daily.map((d) => ({
          day: d.day.slice(0, 10),
          enrolments: num(d.enrolments),
          revenueKobo: num(d.revenue),
          pageViews: num(d.views),
          posts: num(d.posts),
        })),
        lessonFunnel: modules.map((mod) => ({ moduleId: mod.id, title: mod.title, completions: funnelMap.get(mod.id) ?? 0 })),
        topContributors,
        viewToEnrolmentRate: views30 > 0 ? Math.round((enrol30 / views30) * 1000) / 10 : null,
      };
    }

    return { tier, basic, more, detailed };
  });
}

// ---------------------------------------------------------------------------
// Studio summary (all of a creator's classrooms)
// ---------------------------------------------------------------------------

export interface StudioClassroomRow {
  id: string;
  name: string;
  slug: string | null;
  coverEmoji: string;
  isActive: boolean;
  isPublic: boolean;
  showInCreatorListing: boolean;
  enrolmentFeeNgn: number;
  members: number;
  paidMembers: number;
  revenueAllTimeKobo: number;
  revenue30dKobo: number;
  posts30d: number;
  activeMembers7d: number;
  pendingReports: number;
  createdAt: string;
}

export interface StudioSummary {
  tier: ClassroomStatsTier;
  totals: {
    classrooms: number;
    activeClassrooms: number;
    members: number;
    paidMembers: number;
    revenueTodayKobo: number;
    revenueWeekKobo: number;
    revenueMonthKobo: number;
    revenueAllTimeKobo: number;
    pendingReports: number;
  };
  classrooms: StudioClassroomRow[];
  /** 30-day revenue + enrolments across all classrooms — "detailed" tier only. */
  daily: Array<{ day: string; enrolments: number; revenueKobo: number }> | null;
}

export async function getStudioSummary(creatorId: string, tier: ClassroomStatsTier): Promise<StudioSummary> {
  return cached(`classroom:studio:${creatorId}:${tier}`, async () => {
    const orm = await getDb();
    const { rows } = await orm.execute<{
      id: string;
      name: string;
      slug: string | null;
      cover_emoji: string;
      is_active: boolean | null;
      is_public: boolean | null;
      show_in_creator_listing: boolean;
      enrolment_fee_ngn: string | null;
      created_at: string;
      members: string;
      paid_members: string;
      revenue_all: string;
      revenue_30d: string;
      posts_30d: string;
      active_7d: string;
      pending_reports: string;
    }>(sql`
      SELECT r.id, r.name, r.slug, r.cover_emoji, r.is_active, r.is_public, r.show_in_creator_listing,
              r.enrolment_fee_ngn, r.created_at,
              COALESCE(en.members, 0) AS members, COALESCE(en.paid_members, 0) AS paid_members,
              COALESCE(en.active_7d, 0) AS active_7d,
              COALESCE(rev.revenue_all, 0) AS revenue_all, COALESCE(rev.revenue_30d, 0) AS revenue_30d,
              (SELECT COUNT(*) FROM classroom_posts p
                WHERE p.room_id = r.id AND p.deleted_at IS NULL AND p.created_at >= NOW() - INTERVAL '30 days') AS posts_30d,
              (SELECT COUNT(*) FROM classroom_reports cr WHERE cr.room_id = r.id AND cr.status = 'pending') AS pending_reports
         FROM rooms r
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS members,
                  COUNT(*) FILTER (WHERE paid) AS paid_members,
                  COUNT(*) FILTER (WHERE last_active_at >= NOW() - INTERVAL '7 days') AS active_7d
             FROM classroom_enrolments WHERE room_id = r.id
         ) en ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(e.net_amount_kobo) AS revenue_all,
                  SUM(e.net_amount_kobo) FILTER (WHERE e.created_at >= NOW() - INTERVAL '30 days') AS revenue_30d
             FROM creator_earnings e
             JOIN classroom_enrolments ce ON ce.id::text = e.reference_id
            WHERE ce.room_id = r.id AND e.source_type = 'classroom_enrolment'
         ) rev ON TRUE
        WHERE r.creator_id = ${creatorId} AND r.type = 'classroom' AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC
    `);

    const classrooms: StudioClassroomRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      coverEmoji: r.cover_emoji,
      isActive: r.is_active !== false,
      isPublic: r.is_public !== false,
      showInCreatorListing: r.show_in_creator_listing,
      enrolmentFeeNgn: num(r.enrolment_fee_ngn),
      members: num(r.members),
      paidMembers: num(r.paid_members),
      revenueAllTimeKobo: num(r.revenue_all),
      revenue30dKobo: num(r.revenue_30d),
      posts30d: num(r.posts_30d),
      activeMembers7d: num(r.active_7d),
      pendingReports: num(r.pending_reports),
      createdAt: new Date(r.created_at).toISOString(),
    }));

    const { rows: revRows } = await orm.execute<{ today: string; week: string; month: string }>(sql`
      SELECT
         COALESCE(SUM(e.net_amount_kobo) FILTER (WHERE e.created_at >= date_trunc('day', NOW())), 0) AS today,
         COALESCE(SUM(e.net_amount_kobo) FILTER (WHERE e.created_at >= NOW() - INTERVAL '7 days'), 0) AS week,
         COALESCE(SUM(e.net_amount_kobo) FILTER (WHERE e.created_at >= NOW() - INTERVAL '30 days'), 0) AS month
         FROM creator_earnings e
        WHERE e.creator_id = ${creatorId} AND e.source_type = 'classroom_enrolment'
    `);

    let daily: StudioSummary["daily"] = null;
    if (statsTierAtLeast(tier, "detailed")) {
      const { rows: d } = await orm.execute<{ day: string; enrolments: string; revenue: string }>(sql`
        SELECT g.day::text AS day,
                (SELECT COUNT(*) FROM classroom_enrolments ce JOIN rooms r ON r.id = ce.room_id
                  WHERE r.creator_id = ${creatorId} AND ce.enrolled_at::date = g.day) AS enrolments,
                (SELECT COALESCE(SUM(e.net_amount_kobo), 0) FROM creator_earnings e
                  WHERE e.creator_id = ${creatorId} AND e.source_type = 'classroom_enrolment' AND e.created_at::date = g.day) AS revenue
           FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, INTERVAL '1 day') AS g(day)
          ORDER BY g.day
      `);
      daily = d.map((x) => ({ day: x.day.slice(0, 10), enrolments: num(x.enrolments), revenueKobo: num(x.revenue) }));
    }

    return {
      tier,
      totals: {
        classrooms: classrooms.length,
        activeClassrooms: classrooms.filter((c) => c.isActive).length,
        members: classrooms.reduce((s, c) => s + c.members, 0),
        paidMembers: classrooms.reduce((s, c) => s + c.paidMembers, 0),
        revenueTodayKobo: num(revRows[0]?.today),
        revenueWeekKobo: num(revRows[0]?.week),
        revenueMonthKobo: num(revRows[0]?.month),
        revenueAllTimeKobo: classrooms.reduce((s, c) => s + c.revenueAllTimeKobo, 0),
        pendingReports: classrooms.reduce((s, c) => s + c.pendingReports, 0),
      },
      classrooms,
      daily,
    };
  });
}

/** Best-effort page-view counter for /c/<slug> (one upsert, never blocks render). */
export function recordClassroomView(roomId: string): void {
  getDb()
    .then((orm) =>
      orm
        .insert(schema.classroomDailyStats)
        .values({ roomId, day: sql`CURRENT_DATE`, pageViews: 1 })
        .onConflictDoUpdate({
          target: [schema.classroomDailyStats.roomId, schema.classroomDailyStats.day],
          set: { pageViews: sql`${schema.classroomDailyStats.pageViews} + 1` },
        })
    )
    .catch((err) => logger.warn({ err, roomId }, "[classroom:stats] view counter failed"));
}

/** Record a share (idempotent per user for the share counter; always bumps the daily tally). */
export async function recordClassroomShare(roomId: string, userId: string): Promise<{ shareCount: number }> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.classroomShares)
      .values({ roomId, userId, shareCount: 1 })
      .onConflictDoUpdate({
        target: [schema.classroomShares.roomId, schema.classroomShares.userId],
        set: { shareCount: sql`${schema.classroomShares.shareCount} + 1`, lastSharedAt: new Date() },
      })
      .returning({ shareCount: schema.classroomShares.shareCount });
    await tx
      .insert(schema.classroomDailyStats)
      .values({ roomId, day: sql`CURRENT_DATE`, shares: 1 })
      .onConflictDoUpdate({
        target: [schema.classroomDailyStats.roomId, schema.classroomDailyStats.day],
        set: { shares: sql`${schema.classroomDailyStats.shares} + 1` },
      });
    return { shareCount: row?.shareCount ?? 1 };
  });
}
