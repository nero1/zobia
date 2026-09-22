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

import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db/interface";
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

interface MemberRow {
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
}

export async function listMembers(
  classroomId: string,
  opts: { search?: string | null; filter?: "all" | "moderators" | "paid" | "muted"; limit?: number; offset?: number }
): Promise<{ members: ClassroomMemberView[]; total: number }> {
  const params: SqlParam[] = [classroomId];
  const where = ["ce.room_id = $1", "u.deleted_at IS NULL"];
  if (opts.search && opts.search.trim()) {
    params.push(`%${opts.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(u.username ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`);
  }
  if (opts.filter === "moderators") where.push("cm.id IS NOT NULL");
  if (opts.filter === "paid") where.push("ce.paid = TRUE");
  if (opts.filter === "muted") where.push("ce.muted_until > NOW()");

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const joins = `
    FROM classroom_enrolments ce
    JOIN users u ON u.id = ce.user_id
    LEFT JOIN classroom_moderators cm
           ON cm.room_id = ce.room_id AND cm.user_id = ce.user_id AND cm.status = 'active' AND cm.is_moderator = TRUE`;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query<MemberRow>(
      `SELECT ce.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
              ce.paid, ce.enrolled_at, ce.last_active_at, ce.completed_at, ce.muted_until,
              (cm.id IS NOT NULL) AS is_moderator,
              mp.points::text AS points, mp.level,
              (SELECT COUNT(*) FROM classroom_lesson_completions lc
                WHERE lc.room_id = ce.room_id AND lc.user_id = ce.user_id)::text AS lessons_completed
       ${joins}
       LEFT JOIN classroom_member_points mp ON mp.room_id = ce.room_id AND mp.user_id = ce.user_id
       ${whereSql}
       ORDER BY (cm.id IS NOT NULL) DESC, COALESCE(mp.points, 0) DESC, ce.enrolled_at ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    db.query<{ n: string }>(`SELECT COUNT(*)::text AS n ${joins} ${whereSql}`, params),
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
  const { rows } = await db.query<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_emoji: string;
    moderator_granted_at: string | null;
    granted_by_username: string | null;
  }>(
    `SELECT cm.user_id, u.username, u.display_name, u.avatar_emoji, cm.moderator_granted_at,
            gb.username AS granted_by_username
       FROM classroom_moderators cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN users gb ON gb.id = cm.moderator_granted_by
      WHERE cm.room_id = $1 AND cm.status = 'active' AND cm.is_moderator = TRUE
      ORDER BY cm.moderator_granted_at ASC NULLS LAST`,
    [classroomId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name ?? r.username,
    avatarEmoji: r.avatar_emoji,
    grantedAt: r.moderator_granted_at ? new Date(r.moderator_granted_at).toISOString() : null,
    grantedBy: r.granted_by_username,
  }));
}

/** Maximum active moderators per classroom. */
export const MAX_CLASSROOM_MODERATORS = 20;

export async function grantModerator(classroom: ClassroomRecord, targetUserId: string, grantedBy: string): Promise<void> {
  if (targetUserId === classroom.creatorId) throw badRequest("The creator already has full control of this classroom.");

  await db.transaction(async (tx) => {
    // Only enrolled members (paid or free) can be moderators.
    const { rows: enrolRows } = await tx.query<{ id: string }>(
      `SELECT ce.id FROM classroom_enrolments ce
         JOIN users u ON u.id = ce.user_id AND u.deleted_at IS NULL
        WHERE ce.room_id = $1 AND ce.user_id = $2`,
      [classroom.id, targetUserId]
    );
    if (!enrolRows[0]) throw badRequest("Only members of this classroom can be made moderators.", "CLASSROOM_NOT_MEMBER");

    // Serialise concurrent grants on the classroom so the cap holds.
    await tx.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [classroom.id]);
    const { rows: countRows } = await tx.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM classroom_moderators
        WHERE room_id = $1 AND status = 'active' AND is_moderator = TRUE AND user_id <> $2`,
      [classroom.id, targetUserId]
    );
    if (Number(countRows[0]?.n ?? 0) >= MAX_CLASSROOM_MODERATORS) {
      throw conflict(`A classroom can have at most ${MAX_CLASSROOM_MODERATORS} moderators.`, "CLASSROOM_MODERATOR_LIMIT");
    }

    const { rows } = await tx.query<{ inserted: boolean }>(
      `INSERT INTO classroom_moderators
         (room_id, user_id, role, is_moderator, moderator_granted_by, moderator_granted_at, status, created_at, updated_at)
       VALUES ($1, $2, 'moderator', TRUE, $3, NOW(), 'active', NOW(), NOW())
       ON CONFLICT (room_id, user_id) DO UPDATE
         SET is_moderator = TRUE, status = 'active',
             moderator_granted_by = EXCLUDED.moderator_granted_by,
             moderator_granted_at = NOW(), updated_at = NOW()
         WHERE classroom_moderators.status <> 'active' OR classroom_moderators.is_moderator = FALSE
       RETURNING TRUE AS inserted`,
      [classroom.id, targetUserId, grantedBy]
    );
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
  const { rowCount } = await db.query(
    `UPDATE classroom_moderators
        SET is_moderator = FALSE, status = 'removed', updated_at = NOW()
      WHERE room_id = $1 AND user_id = $2 AND status = 'active'`,
    [classroom.id, targetUserId]
  );
  if (rowCount === 0) throw notFound("Moderator not found");
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

  // Moderators can't mute each other — only the creator (or staff) can.
  if (!actor.isCreatorOrStaff) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM classroom_moderators WHERE room_id = $1 AND user_id = $2 AND status = 'active'`,
      [classroom.id, targetUserId]
    );
    if (rows[0]) throw badRequest("Only the creator can mute a moderator.");
  }

  const { rows } = await db.query<{ muted_until: string | null }>(
    `UPDATE classroom_enrolments
        SET muted_until = CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + ($3::int * INTERVAL '1 hour') END,
            muted_by = CASE WHEN $3::int IS NULL THEN NULL ELSE $4::uuid END
      WHERE room_id = $1 AND user_id = $2
      RETURNING muted_until`,
    [classroom.id, targetUserId, durationHours, actor.userId]
  );
  if (!rows[0]) throw notFound("Member not found");
  logger.info({ roomId: classroom.id, targetUserId, actorId: actor.userId, durationHours }, "[classroom:members] mute updated");
  return { mutedUntil: rows[0].muted_until ? new Date(rows[0].muted_until).toISOString() : null };
}
