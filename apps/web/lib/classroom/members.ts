/**
 * lib/classroom/members.ts
 *
 * Member roster + moderator management for a classroom.
 *
 * Moderators are picked by the creator from the classroom's own enrolled
 * members (free or paid enrolments alike) and stored in
 * classroom_moderators, which mirrors wiki_collaborators' shape
 * (is_moderator, moderator_granted_by, moderator_granted_at, status).
 * Revoking keeps the row (status = 'removed') for the audit trail.
 */

import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { insertNotification } from "@/lib/notifications/insert";
import type { ClassroomRecord } from "@/lib/classroom/access";

export interface ClassroomMemberView {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  paid: boolean;
  enrolledAt: string;
  lastActiveAt: string | null;
  completedAt: string | null;
  mutedUntil: string | null;
  isModerator: boolean;
  points: number;
  level: number;
  lessonsCompleted: number;
}

type MemberRow = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  avatar_url: string | null;
  paid: boolean;
  enrolled_at: string;
  last_active_at: string | null;
  completed_at: string | null;
  muted_until: string | null;
  is_moderator: boolean;
  points: string | null;
  level: number | null;
  lessons_completed: string;
};

export async function listMembers(
  classroomId: string,
  opts: { search?: string | null; filter?: "all" | "moderators" | "paid" | "muted"; limit?: number; offset?: number }
): Promise<{ members: ClassroomMemberView[]; total: number }> {
  const orm = await getDb();
  const where = [sql`ce.room_id = ${classroomId}`, sql`u.deleted_at IS NULL`];
  if (opts.search && opts.search.trim()) {
    const pattern = `%${opts.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(u.username ILIKE ${pattern} OR u.display_name ILIKE ${pattern})`);
  }
  if (opts.filter === "moderators") where.push(sql`cm.id IS NOT NULL`);
  if (opts.filter === "paid") where.push(sql`ce.paid = TRUE`);
  if (opts.filter === "muted") where.push(sql`ce.muted_until > NOW()`);

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const joinsSql = sql`
    FROM classroom_enrolments ce
    JOIN users u ON u.id = ce.user_id
    LEFT JOIN classroom_moderators cm
           ON cm.room_id = ce.room_id AND cm.user_id = ce.user_id AND cm.status = 'active' AND cm.is_moderator = TRUE`;
  const whereSql = sql.join(where, sql` AND `);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    orm.execute<MemberRow>(sql`
      SELECT ce.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
              ce.paid, ce.enrolled_at, ce.last_active_at, ce.completed_at, ce.muted_until,
              (cm.id IS NOT NULL) AS is_moderator,
              mp.points::text AS points, mp.level,
              (SELECT COUNT(*) FROM classroom_lesson_completions lc
                WHERE lc.room_id = ce.room_id AND lc.user_id = ce.user_id)::text AS lessons_completed
       ${joinsSql}
       LEFT JOIN classroom_member_points mp ON mp.room_id = ce.room_id AND mp.user_id = ce.user_id
       WHERE ${whereSql}
       ORDER BY (cm.id IS NOT NULL) DESC, COALESCE(mp.points, 0) DESC, ce.enrolled_at ASC
       LIMIT ${limit} OFFSET ${offset}
    `),
    orm.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n ${joinsSql} WHERE ${whereSql}`),
  ]);

  return {
    total: Number(countRows[0]?.n ?? 0),
    members: rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name ?? r.username,
      avatarEmoji: r.avatar_emoji,
      avatarUrl: r.avatar_url,
      paid: r.paid,
      enrolledAt: new Date(r.enrolled_at).toISOString(),
      lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      mutedUntil: r.muted_until && new Date(r.muted_until).getTime() > Date.now() ? new Date(r.muted_until).toISOString() : null,
      isModerator: r.is_moderator,
      points: Number(r.points ?? 0),
      level: r.level ?? 1,
      lessonsCompleted: Number(r.lessons_completed),
    })),
  };
}

// ---------------------------------------------------------------------------
// Moderators
// ---------------------------------------------------------------------------

export interface ClassroomModeratorView {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  grantedAt: string | null;
  grantedBy: string | null;
}

export async function listModerators(classroomId: string): Promise<ClassroomModeratorView[]> {
  const orm = await getDb();
  const gb = alias(schema.users, "gb");
  const rows = await orm
    .select({
      userId: schema.classroomModerators.userId,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarEmoji: schema.users.avatarEmoji,
      moderatorGrantedAt: schema.classroomModerators.moderatorGrantedAt,
      grantedByUsername: gb.username,
    })
    .from(schema.classroomModerators)
    .innerJoin(schema.users, eq(schema.users.id, schema.classroomModerators.userId))
    .leftJoin(gb, eq(gb.id, schema.classroomModerators.moderatorGrantedBy))
    .where(
      and(
        eq(schema.classroomModerators.roomId, classroomId),
        eq(schema.classroomModerators.status, "active"),
        eq(schema.classroomModerators.isModerator, true)
      )
    )
    .orderBy(sql`${schema.classroomModerators.moderatorGrantedAt} ASC NULLS LAST`);

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName ?? r.username,
    avatarEmoji: r.avatarEmoji,
    grantedAt: r.moderatorGrantedAt ? new Date(r.moderatorGrantedAt).toISOString() : null,
    grantedBy: r.grantedByUsername,
  }));
}

/** Maximum active moderators per classroom. */
export const MAX_CLASSROOM_MODERATORS = 20;

export async function grantModerator(classroom: ClassroomRecord, targetUserId: string, grantedBy: string): Promise<void> {
  if (targetUserId === classroom.creatorId) throw badRequest("The creator already has full control of this classroom.");

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // Only enrolled members (paid or free) can be moderators.
    const [enrolRow] = await tx
      .select({ id: schema.classroomEnrolments.id })
      .from(schema.classroomEnrolments)
      .innerJoin(schema.users, and(eq(schema.users.id, schema.classroomEnrolments.userId), sql`${schema.users.deletedAt} IS NULL`))
      .where(and(eq(schema.classroomEnrolments.roomId, classroom.id), eq(schema.classroomEnrolments.userId, targetUserId)));
    if (!enrolRow) throw badRequest("Only members of this classroom can be made moderators.", "CLASSROOM_NOT_MEMBER");

    // Serialise concurrent grants on the classroom so the cap holds.
    await tx.select({ id: schema.rooms.id }).from(schema.rooms).where(eq(schema.rooms.id, classroom.id)).for("update");
    const [{ n }] = await tx
      .select({ n: sql<string>`COUNT(*)` })
      .from(schema.classroomModerators)
      .where(
        and(
          eq(schema.classroomModerators.roomId, classroom.id),
          eq(schema.classroomModerators.status, "active"),
          eq(schema.classroomModerators.isModerator, true),
          sql`${schema.classroomModerators.userId} <> ${targetUserId}::uuid`
        )
      );
    if (Number(n ?? 0) >= MAX_CLASSROOM_MODERATORS) {
      throw conflict(`A classroom can have at most ${MAX_CLASSROOM_MODERATORS} moderators.`, "CLASSROOM_MODERATOR_LIMIT");
    }

    const rows = await tx
      .insert(schema.classroomModerators)
      .values({
        roomId: classroom.id,
        userId: targetUserId,
        role: "moderator",
        isModerator: true,
        moderatorGrantedBy: grantedBy,
        moderatorGrantedAt: new Date(),
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.classroomModerators.roomId, schema.classroomModerators.userId],
        set: {
          isModerator: true,
          status: "active",
          moderatorGrantedBy: sql`excluded.moderator_granted_by`,
          moderatorGrantedAt: new Date(),
          updatedAt: new Date(),
        },
        setWhere: sql`${schema.classroomModerators.status} <> 'active' OR ${schema.classroomModerators.isModerator} = FALSE`,
      })
      .returning({ inserted: sql<boolean>`TRUE` });
    if (!rows[0]) throw conflict("This member is already a moderator.", "CLASSROOM_ALREADY_MODERATOR");

    await insertNotification(
      tx,
      targetUserId,
      "classroom_moderator_granted",
      `🛡️ You're now a moderator of ${classroom.name}`,
      "You can now help run this classroom's community.",
      { roomId: classroom.id, classroomSlug: classroom.slug }
    );
  });
  logger.info({ roomId: classroom.id, targetUserId, grantedBy }, "[classroom:moderators] moderator granted");
}

export async function revokeModerator(classroom: ClassroomRecord, targetUserId: string, revokedBy: string): Promise<void> {
  const orm = await getDb();
  const result = await orm
    .update(schema.classroomModerators)
    .set({ isModerator: false, status: "removed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.classroomModerators.roomId, classroom.id),
        eq(schema.classroomModerators.userId, targetUserId),
        eq(schema.classroomModerators.status, "active")
      )
    )
    .returning({ id: schema.classroomModerators.id });
  if (result.length === 0) throw notFound("Moderator not found");
  logger.info({ roomId: classroom.id, targetUserId, revokedBy }, "[classroom:moderators] moderator revoked");
}

// ---------------------------------------------------------------------------
// Mute (community posting/commenting)
// ---------------------------------------------------------------------------

export async function setMemberMute(
  classroom: ClassroomRecord,
  targetUserId: string,
  actor: { userId: string; isCreatorOrStaff: boolean },
  durationHours: number | null
): Promise<{ mutedUntil: string | null }> {
  if (targetUserId === classroom.creatorId) throw badRequest("The creator can't be muted.");
  if (targetUserId === actor.userId) throw badRequest("You can't mute yourself.");

  const orm = await getDb();

  // Moderators can't mute each other — only the creator (or staff) can.
  if (!actor.isCreatorOrStaff) {
    const [row] = await orm
      .select({ id: schema.classroomModerators.id })
      .from(schema.classroomModerators)
      .where(
        and(
          eq(schema.classroomModerators.roomId, classroom.id),
          eq(schema.classroomModerators.userId, targetUserId),
          eq(schema.classroomModerators.status, "active")
        )
      );
    if (row) throw badRequest("Only the creator can mute a moderator.");
  }

  const mutedUntilExpr =
    durationHours === null ? sql`NULL` : sql`NOW() + (${durationHours}::int * INTERVAL '1 hour')`;
  const mutedByExpr = durationHours === null ? sql`NULL` : sql`${actor.userId}::uuid`;

  const rows = await orm
    .update(schema.classroomEnrolments)
    .set({ mutedUntil: mutedUntilExpr, mutedBy: mutedByExpr })
    .where(and(eq(schema.classroomEnrolments.roomId, classroom.id), eq(schema.classroomEnrolments.userId, targetUserId)))
    .returning({ mutedUntil: schema.classroomEnrolments.mutedUntil });
  if (!rows[0]) throw notFound("Member not found");
  logger.info({ roomId: classroom.id, targetUserId, actorId: actor.userId, durationHours }, "[classroom:members] mute updated");
  return { mutedUntil: rows[0].mutedUntil ? new Date(rows[0].mutedUntil).toISOString() : null };
}
