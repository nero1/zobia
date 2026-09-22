/**
 * lib/classroom/community.ts
 *
 * The classroom-scoped community feed: posts, one level of threaded
 * comments, likes (1 like = 1 classroom point for the author, Skool-style)
 * and member reports. Authorization is decided by the caller via
 * lib/classroom/access.ts before any of these run; the functions here only
 * enforce data invariants (target belongs to this classroom, not locked,
 * not deleted, not self-liking, ...).
 */

import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { insertNotification, insertNotificationBatch } from "@/lib/notifications/insert";
import {
  awardClassroomPoints,
  evaluateBadges,
  fireKnowledgeBonuses,
  getLevelsForUsers,
  type PointsAwardResult,
} from "@/lib/classroom/gamification";
import type { ClassroomRecord, ClassroomViewer } from "@/lib/classroom/access";

type Queryable = Pick<TransactionClient, "query">;

export interface ClassroomAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  level: number;
  isCreator: boolean;
  isModerator: boolean;
}

export interface ClassroomPostView {
  id: string;
  category: string;
  title: string | null;
  body: string;
  isPinned: boolean;
  isLocked: boolean;
  isHidden: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  author: ClassroomAuthor;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ClassroomCommentView {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  isHidden: boolean;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: ClassroomAuthor;
  canDelete: boolean;
}

interface AuthorRow {
  author_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  avatar_url: string | null;
  author_is_moderator: boolean;
}

async function authorLevels(roomId: string, rows: AuthorRow[]): Promise<Map<string, number>> {
  return getLevelsForUsers(
    roomId,
    rows.map((r) => r.author_id)
  );
}

function toAuthor(row: AuthorRow, classroom: ClassroomRecord, levels: Map<string, number>): ClassroomAuthor {
  return {
    id: row.author_id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    avatarEmoji: row.avatar_emoji,
    avatarUrl: row.avatar_url,
    level: levels.get(row.author_id) ?? 1,
    isCreator: row.author_id === classroom.creatorId,
    isModerator: row.author_is_moderator,
  };
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export interface FeedQuery {
  category?: string | null;
  cursor?: string | null;
  limit?: number;
  sort?: "activity" | "new" | "top";
}

interface PostRow extends AuthorRow {
  id: string;
  category: string;
  title: string | null;
  body: string;
  is_pinned: boolean;
  is_locked: boolean;
  is_hidden: boolean;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

const POST_SELECT = `
  SELECT p.id, p.category, p.title, p.body, p.is_pinned, p.is_locked, p.is_hidden,
         p.like_count, p.comment_count, p.created_at, p.updated_at, p.last_activity_at,
         p.author_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
         (cm.id IS NOT NULL) AS author_is_moderator,
         (l.id IS NOT NULL) AS liked_by_me
    FROM classroom_posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN classroom_moderators cm
           ON cm.room_id = p.room_id AND cm.user_id = p.author_id AND cm.status = 'active'
    LEFT JOIN classroom_likes l ON l.post_id = p.id AND l.user_id = $2
`;

function toPostView(
  r: PostRow,
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  levels: Map<string, number>
): ClassroomPostView {
  const isAuthor = viewer.userId === r.author_id;
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    isPinned: r.is_pinned,
    isLocked: r.is_locked,
    isHidden: r.is_hidden,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    likedByMe: r.liked_by_me,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at,
    author: toAuthor(r, classroom, levels),
    canEdit: isAuthor && classroom.isActive,
    canDelete: isAuthor || viewer.can.managePosts,
  };
}

/** Keyset-paginated feed. Pinned posts always lead the first page. */
export async function listPosts(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  q: FeedQuery
): Promise<{ posts: ClassroomPostView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
  const sort = q.sort ?? "activity";
  const params: SqlParam[] = [classroom.id, viewer.userId];
  const where = ["p.room_id = $1", "p.deleted_at IS NULL"];
  // Hidden posts stay visible to moderators (so they can be restored) and to
  // their own author; everyone else never sees them.
  if (!viewer.can.managePosts) {
    params.push(viewer.userId);
    where.push(`(p.is_hidden = FALSE OR p.author_id = $${params.length})`);
  }
  if (q.category) {
    params.push(q.category);
    where.push(`p.category = $${params.length}`);
  }

  const orderExpr =
    sort === "new"
      ? "date_trunc('milliseconds', p.created_at)"
      : sort === "top"
        ? "p.like_count"
        : "date_trunc('milliseconds', p.last_activity_at)";
  // Cursor = "<pinned 0|1>|<sort value>|<id>" — opaque to clients.
  if (q.cursor) {
    const [pinnedStr, sortVal, id] = q.cursor.split("|");
    if (pinnedStr === undefined || sortVal === undefined || !id) throw badRequest("Invalid cursor");
    const pinned = pinnedStr === "1";
    params.push(pinned, sort === "top" ? Number(sortVal) : sortVal, id);
    const a = params.length - 2;
    const b = params.length - 1;
    const c = params.length;
    // Timestamps are compared at millisecond precision — the cursor carries an
    // ISO string, which cannot represent Postgres' microseconds.
    const cast = sort === "top" ? "::int" : "::timestamptz";
    where.push(
      `(p.is_pinned < $${a} OR (p.is_pinned = $${a} AND (${orderExpr} < $${b}${cast} OR (${orderExpr} = $${b}${cast} AND p.id < $${c}::uuid))))`
    );
  }
  params.push(limit + 1);

  const { rows } = await db.query<PostRow>(
    `${POST_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY p.is_pinned DESC, ${orderExpr} DESC, p.id DESC
     LIMIT $${params.length}`,
    params
  );

  const page = rows.slice(0, limit);
  const levels = await authorLevels(classroom.id, page);
  const last = page[page.length - 1];
  const sortValue = (r: PostRow): string =>
    sort === "top"
      ? String(r.like_count)
      : new Date(sort === "new" ? r.created_at : r.last_activity_at).toISOString();
  return {
    posts: page.map((r) => toPostView(r, classroom, viewer, levels)),
    nextCursor: rows.length > limit && last ? `${last.is_pinned ? "1" : "0"}|${sortValue(last)}|${last.id}` : null,
  };
}

export async function getPost(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  postId: string
): Promise<ClassroomPostView> {
  const { rows } = await db.query<PostRow>(
    `${POST_SELECT} WHERE p.id = $1 AND p.room_id = $3 AND p.deleted_at IS NULL LIMIT 1`,
    [postId, viewer.userId, classroom.id]
  );
  const row = rows[0];
  if (!row) throw notFound("Post not found");
  if (row.is_hidden && !viewer.can.managePosts && row.author_id !== viewer.userId) {
    throw notFound("Post not found");
  }
  const levels = await authorLevels(classroom.id, [row]);
  return toPostView(row, classroom, viewer, levels);
}

// ---------------------------------------------------------------------------
// Post writes
// ---------------------------------------------------------------------------

export interface PostInput {
  title?: string | null;
  body: string;
  category?: string | null;
}

function resolveCategory(classroom: ClassroomRecord, requested: string | null | undefined, viewer: ClassroomViewer): string {
  const categories = classroom.settings.postCategories;
  const match = requested
    ? categories.find((c) => c.toLowerCase() === requested.trim().toLowerCase())
    : undefined;
  const category = match ?? categories[0];
  // "Announcements" is reserved for the creator/moderators when present.
  if (category.toLowerCase() === "announcements" && !(viewer.can.managePosts || viewer.isModerator)) {
    throw forbidden("Only the creator or a moderator can post announcements.", "CLASSROOM_FORBIDDEN");
  }
  return category;
}

export async function createPost(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  input: PostInput
): Promise<ClassroomPostView> {
  if (!viewer.userId) throw forbidden();
  const category = resolveCategory(classroom, input.category, viewer);

  const post = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO classroom_posts (room_id, author_id, category, title, body, created_at, updated_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       RETURNING id`,
      [classroom.id, viewer.userId, category, input.title?.trim() || null, input.body.trim()]
    );
    const id = rows[0]!.id;
    await tx.query(
      `UPDATE classroom_enrolments SET last_active_at = NOW() WHERE room_id = $1 AND user_id = $2`,
      [classroom.id, viewer.userId]
    );
    await evaluateBadges(classroom.id, viewer.userId!, {}, ["posts"], tx);
    return id;
  });

  // Announcements notify every enrolled member (outside the transaction).
  if (category.toLowerCase() === "announcements") {
    notifyMembers(classroom, viewer.userId, "classroom_announcement", `📣 ${classroom.name}`, input.title?.trim() || input.body.trim().slice(0, 120)).catch(
      (err) => logger.warn({ err, roomId: classroom.id }, "[classroom:community] announcement fan-out failed")
    );
  }

  return getPost(classroom, viewer, post);
}

export async function updatePost(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  postId: string,
  patch: Partial<PostInput> & { isPinned?: boolean; isLocked?: boolean; isHidden?: boolean }
): Promise<ClassroomPostView> {
  const { rows } = await db.query<{ author_id: string }>(
    `SELECT author_id FROM classroom_posts WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
    [postId, classroom.id]
  );
  const row = rows[0];
  if (!row) throw notFound("Post not found");
  const isAuthor = row.author_id === viewer.userId;

  const sets: string[] = [];
  const params: SqlParam[] = [postId];
  const contentEdit = patch.body !== undefined || patch.title !== undefined || patch.category !== undefined;
  if (contentEdit) {
    if (!isAuthor || !classroom.isActive) throw forbidden("Only the author can edit this post.", "CLASSROOM_FORBIDDEN");
    if (patch.body !== undefined) {
      params.push(patch.body.trim());
      sets.push(`body = $${params.length}`);
    }
    if (patch.title !== undefined) {
      params.push(patch.title?.trim() || null);
      sets.push(`title = $${params.length}`);
    }
    if (patch.category !== undefined) {
      params.push(resolveCategory(classroom, patch.category, viewer));
      sets.push(`category = $${params.length}`);
    }
  }
  const modEdit = patch.isPinned !== undefined || patch.isLocked !== undefined || patch.isHidden !== undefined;
  if (modEdit) {
    if (!viewer.can.managePosts) throw forbidden("Only the creator or a moderator can do this.", "CLASSROOM_FORBIDDEN");
    if (patch.isPinned !== undefined) {
      params.push(patch.isPinned);
      sets.push(`is_pinned = $${params.length}`);
    }
    if (patch.isLocked !== undefined) {
      params.push(patch.isLocked);
      sets.push(`is_locked = $${params.length}`);
    }
    if (patch.isHidden !== undefined) {
      params.push(patch.isHidden, patch.isHidden ? viewer.userId : null);
      sets.push(`is_hidden = $${params.length - 1}`, `hidden_by = $${params.length}`, `hidden_at = ${patch.isHidden ? "NOW()" : "NULL"}`);
    }
  }
  if (sets.length === 0) throw badRequest("Nothing to update");

  await db.query(`UPDATE classroom_posts SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
  if (modEdit) {
    logger.info(
      { roomId: classroom.id, postId, moderatorId: viewer.userId, patch: { isPinned: patch.isPinned, isLocked: patch.isLocked, isHidden: patch.isHidden } },
      "[classroom:moderation] post updated"
    );
  }
  return getPost(classroom, viewer, postId);
}

export async function deletePost(classroom: ClassroomRecord, viewer: ClassroomViewer, postId: string): Promise<void> {
  const { rows } = await db.query<{ author_id: string }>(
    `SELECT author_id FROM classroom_posts WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
    [postId, classroom.id]
  );
  const row = rows[0];
  if (!row) throw notFound("Post not found");
  if (row.author_id !== viewer.userId && !viewer.can.managePosts) {
    throw forbidden("You can't delete this post.", "CLASSROOM_FORBIDDEN");
  }
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE classroom_posts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [postId]);
    // Close any open reports against the post — the content is gone.
    await tx.query(
      `UPDATE classroom_reports SET status = 'resolved_removed', resolved_by = $2, resolved_at = NOW()
        WHERE post_id = $1 AND status = 'pending'`,
      [postId, viewer.userId]
    );
  });
  if (row.author_id !== viewer.userId) {
    logger.info({ roomId: classroom.id, postId, moderatorId: viewer.userId }, "[classroom:moderation] post deleted by moderator");
  }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

interface CommentRow extends AuthorRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  is_hidden: boolean;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
}

export async function listComments(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  postId: string
): Promise<ClassroomCommentView[]> {
  // Visibility of the post itself is re-checked (hidden posts 404 for non-mods).
  await getPost(classroom, viewer, postId);
  const params: SqlParam[] = [postId, viewer.userId, classroom.id];
  let hiddenFilter = "";
  if (!viewer.can.managePosts) {
    params.push(viewer.userId);
    hiddenFilter = `AND (c.is_hidden = FALSE OR c.author_id = $${params.length})`;
  }
  const { rows } = await db.query<CommentRow>(
    `SELECT c.id, c.post_id, c.parent_id, c.body, c.is_hidden, c.like_count, c.created_at,
            c.author_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
            (cm.id IS NOT NULL) AS author_is_moderator,
            (l.id IS NOT NULL) AS liked_by_me
       FROM classroom_post_comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN classroom_moderators cm
              ON cm.room_id = c.room_id AND cm.user_id = c.author_id AND cm.status = 'active'
       LEFT JOIN classroom_likes l ON l.comment_id = c.id AND l.user_id = $2
      WHERE c.post_id = $1 AND c.room_id = $3 AND c.deleted_at IS NULL ${hiddenFilter}
      ORDER BY c.created_at ASC
      LIMIT 500`,
    params
  );
  const levels = await authorLevels(classroom.id, rows);
  return rows.map((r) => ({
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id,
    body: r.body,
    isHidden: r.is_hidden,
    likeCount: r.like_count,
    likedByMe: r.liked_by_me,
    createdAt: r.created_at,
    author: toAuthor(r, classroom, levels),
    canDelete: r.author_id === viewer.userId || viewer.can.managePosts,
  }));
}

export async function createComment(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  postId: string,
  input: { body: string; parentId?: string | null }
): Promise<ClassroomCommentView> {
  if (!viewer.userId) throw forbidden();
  const commentId = await db.transaction(async (tx) => {
    const { rows: postRows } = await tx.query<{ author_id: string; is_locked: boolean; is_hidden: boolean; title: string | null }>(
      `SELECT author_id, is_locked, is_hidden, title FROM classroom_posts
        WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [postId, classroom.id]
    );
    const post = postRows[0];
    if (!post || (post.is_hidden && !viewer.can.managePosts)) throw notFound("Post not found");
    if (post.is_locked && !viewer.can.managePosts) throw forbidden("Comments are closed on this post.", "CLASSROOM_POST_LOCKED");

    let parentAuthor: string | null = null;
    if (input.parentId) {
      const { rows: parentRows } = await tx.query<{ author_id: string; parent_id: string | null }>(
        `SELECT author_id, parent_id FROM classroom_post_comments
          WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL`,
        [input.parentId, postId]
      );
      const parent = parentRows[0];
      if (!parent) throw badRequest("The comment you're replying to no longer exists.");
      // One level of threading: replies to a reply attach to its top-level parent.
      if (parent.parent_id) input.parentId = parent.parent_id;
      parentAuthor = parent.author_id;
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO classroom_post_comments (post_id, room_id, author_id, parent_id, body, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      [postId, classroom.id, viewer.userId, input.parentId ?? null, input.body.trim()]
    );
    await tx.query(
      `UPDATE classroom_posts SET comment_count = comment_count + 1, last_activity_at = NOW() WHERE id = $1`,
      [postId]
    );
    await tx.query(
      `UPDATE classroom_enrolments SET last_active_at = NOW() WHERE room_id = $1 AND user_id = $2`,
      [classroom.id, viewer.userId]
    );

    const notifyIds = new Set<string>();
    if (post.author_id !== viewer.userId) notifyIds.add(post.author_id);
    if (parentAuthor && parentAuthor !== viewer.userId) notifyIds.add(parentAuthor);
    for (const uid of notifyIds) {
      await insertNotification(
        tx,
        uid,
        "classroom_post_reply",
        `💬 New reply in ${classroom.name}`,
        input.body.trim().slice(0, 140),
        { roomId: classroom.id, classroomSlug: classroom.slug, postId }
      );
    }
    return rows[0]!.id;
  });

  const all = await listComments(classroom, viewer, postId);
  const created = all.find((c) => c.id === commentId);
  if (!created) throw notFound("Comment not found");
  return created;
}

export async function deleteComment(classroom: ClassroomRecord, viewer: ClassroomViewer, commentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ author_id: string; post_id: string }>(
      `SELECT author_id, post_id FROM classroom_post_comments
        WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [commentId, classroom.id]
    );
    const row = rows[0];
    if (!row) throw notFound("Comment not found");
    if (row.author_id !== viewer.userId && !viewer.can.managePosts) {
      throw forbidden("You can't delete this comment.", "CLASSROOM_FORBIDDEN");
    }
    // Soft-delete the comment and its replies; keep comment_count accurate.
    const { rows: gone } = await tx.query<{ id: string }>(
      `UPDATE classroom_post_comments SET deleted_at = NOW(), updated_at = NOW()
        WHERE (id = $1 OR parent_id = $1) AND deleted_at IS NULL
        RETURNING id`,
      [commentId]
    );
    await tx.query(
      `UPDATE classroom_posts SET comment_count = GREATEST(comment_count - $2, 0) WHERE id = $1`,
      [row.post_id, gone.length]
    );
    await tx.query(
      `UPDATE classroom_reports SET status = 'resolved_removed', resolved_by = $2, resolved_at = NOW()
        WHERE comment_id = ANY($1::uuid[]) AND status = 'pending'`,
      [gone.map((g) => g.id), viewer.userId]
    );
    if (row.author_id !== viewer.userId) {
      logger.info({ roomId: classroom.id, commentId, moderatorId: viewer.userId }, "[classroom:moderation] comment deleted by moderator");
    }
  });
}

export async function setCommentHidden(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  commentId: string,
  hidden: boolean
): Promise<void> {
  if (!viewer.can.managePosts) throw forbidden("Only the creator or a moderator can do this.", "CLASSROOM_FORBIDDEN");
  const { rowCount } = await db.query(
    `UPDATE classroom_post_comments
        SET is_hidden = $3, hidden_by = $4, hidden_at = ${hidden ? "NOW()" : "NULL"}, updated_at = NOW()
      WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
    [commentId, classroom.id, hidden, hidden ? viewer.userId : null]
  );
  if (rowCount === 0) throw notFound("Comment not found");
  logger.info({ roomId: classroom.id, commentId, moderatorId: viewer.userId, hidden }, "[classroom:moderation] comment visibility changed");
}

// ---------------------------------------------------------------------------
// Likes (1 like = 1 classroom point for the author)
// ---------------------------------------------------------------------------

export type LikeTarget = { kind: "post"; id: string } | { kind: "comment"; id: string };

export async function setLike(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  target: LikeTarget,
  liked: boolean
): Promise<{ liked: boolean; likeCount: number }> {
  if (!viewer.userId) throw forbidden();
  const table = target.kind === "post" ? "classroom_posts" : "classroom_post_comments";
  const col = target.kind === "post" ? "post_id" : "comment_id";
  const userId = viewer.userId;

  let award: PointsAwardResult | null = null;
  const result = await db.transaction(async (tx) => {
    const { rows: targetRows } = await tx.query<{ author_id: string; like_count: number; is_hidden: boolean }>(
      `SELECT author_id, like_count, is_hidden FROM ${table}
        WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [target.id, classroom.id]
    );
    const row = targetRows[0];
    if (!row || (row.is_hidden && !viewer.can.managePosts)) throw notFound("Not found");
    const selfLike = row.author_id === userId;

    if (liked) {
      const { rows: ins } = await tx.query<{ id: string }>(
        `INSERT INTO classroom_likes (room_id, user_id, ${col}, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [classroom.id, userId, target.id]
      );
      if (ins.length === 0) return { liked: true, likeCount: row.like_count };
      const { rows: upd } = await tx.query<{ like_count: number }>(
        `UPDATE ${table} SET like_count = like_count + 1 WHERE id = $1 RETURNING like_count`,
        [target.id]
      );
      if (!selfLike) {
        award = await awardClassroomPoints(
          {
            roomId: classroom.id,
            userId: row.author_id,
            source: "like_received",
            referenceId: `like:${ins[0]!.id}`,
            // Stable across like/unlike/like so the global XP bonus is earned once per liker+target.
            xpReferenceId: `classroom_like:${target.id}:${userId}`,
            classroom: { slug: classroom.slug, name: classroom.name },
          },
          tx
        );
      }
      return { liked: true, likeCount: upd[0]?.like_count ?? row.like_count + 1 };
    }

    const { rows: del } = await tx.query<{ id: string }>(
      `DELETE FROM classroom_likes WHERE user_id = $1 AND ${col} = $2 RETURNING id`,
      [userId, target.id]
    );
    if (del.length === 0) return { liked: false, likeCount: row.like_count };
    const { rows: upd } = await tx.query<{ like_count: number }>(
      `UPDATE ${table} SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1 RETURNING like_count`,
      [target.id]
    );
    if (!selfLike) {
      await awardClassroomPoints(
        {
          roomId: classroom.id,
          userId: row.author_id,
          source: "like_removed",
          referenceId: `unlike:${del[0]!.id}`,
        },
        tx
      );
    }
    return { liked: false, likeCount: upd[0]?.like_count ?? Math.max(row.like_count - 1, 0) };
  });

  fireKnowledgeBonuses([award]);
  return result;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "sexual_content",
  "misinformation",
  "scam",
  "off_topic",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Pending reports on one target at which it is escalated to platform staff (/gate44/classrooms). */
const ESCALATION_THRESHOLD = 3;

export async function createReport(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  input: { target: LikeTarget; reason: ReportReason; details?: string | null }
): Promise<{ reported: true }> {
  if (!viewer.userId) throw forbidden();
  const table = input.target.kind === "post" ? "classroom_posts" : "classroom_post_comments";
  const col = input.target.kind === "post" ? "post_id" : "comment_id";

  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ author_id: string }>(
      `SELECT author_id FROM ${table} WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
      [input.target.id, classroom.id]
    );
    const row = rows[0];
    if (!row) throw notFound("Not found");
    if (row.author_id === viewer.userId) throw badRequest("You can't report your own content.");

    const { rows: ins } = await tx.query<{ id: string }>(
      `INSERT INTO classroom_reports (room_id, reporter_id, ${col}, reason, details, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [classroom.id, viewer.userId, input.target.id, input.reason, input.details?.trim() || null]
    );
    if (ins.length === 0) throw conflict("You've already reported this.", "CLASSROOM_ALREADY_REPORTED");

    const { rows: countRows } = await tx.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM classroom_reports WHERE ${col} = $1 AND status = 'pending'`,
      [input.target.id]
    );
    if (Number(countRows[0]?.n ?? 0) >= ESCALATION_THRESHOLD) {
      await tx.query(
        `UPDATE classroom_reports SET escalated = TRUE WHERE ${col} = $1 AND status = 'pending'`,
        [input.target.id]
      );
    }
  });
  return { reported: true };
}

export interface ClassroomReportView {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  escalated: boolean;
  createdAt: string;
  reporter: { id: string; username: string };
  target: {
    kind: "post" | "comment";
    id: string;
    postId: string;
    body: string;
    isHidden: boolean;
    author: { id: string; username: string };
  };
}

interface ReportRow {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  escalated: boolean;
  created_at: string;
  reporter_id: string;
  reporter_username: string;
  post_id: string | null;
  comment_id: string | null;
  target_post_id: string;
  target_body: string;
  target_hidden: boolean;
  target_author_id: string;
  target_author_username: string;
  room_id?: string;
  room_name?: string;
  room_slug?: string | null;
}

export const REPORT_SELECT = `
  SELECT r.id, r.reason, r.details, r.status, r.escalated, r.created_at,
         r.reporter_id, ru.username AS reporter_username, r.post_id, r.comment_id,
         COALESCE(p.id, c.post_id) AS target_post_id,
         COALESCE(p.body, c.body) AS target_body,
         COALESCE(p.is_hidden, c.is_hidden) AS target_hidden,
         COALESCE(p.author_id, c.author_id) AS target_author_id,
         au.username AS target_author_username,
         r.room_id, rm.name AS room_name, rm.slug AS room_slug
    FROM classroom_reports r
    JOIN users ru ON ru.id = r.reporter_id
    JOIN rooms rm ON rm.id = r.room_id
    LEFT JOIN classroom_posts p ON p.id = r.post_id
    LEFT JOIN classroom_post_comments c ON c.id = r.comment_id
    JOIN users au ON au.id = COALESCE(p.author_id, c.author_id)
`;

export function toReportView(r: ReportRow): ClassroomReportView & { room?: { id: string; name: string; slug: string | null } } {
  return {
    id: r.id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    escalated: r.escalated,
    createdAt: r.created_at,
    reporter: { id: r.reporter_id, username: r.reporter_username },
    target: {
      kind: r.post_id ? "post" : "comment",
      id: (r.post_id ?? r.comment_id)!,
      postId: r.target_post_id,
      body: r.target_body,
      isHidden: r.target_hidden,
      author: { id: r.target_author_id, username: r.target_author_username },
    },
    ...(r.room_id ? { room: { id: r.room_id, name: r.room_name ?? "", slug: r.room_slug ?? null } } : {}),
  };
}

export type { ReportRow };

export async function listReports(classroomId: string, status: "pending" | "resolved"): Promise<ClassroomReportView[]> {
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SELECT}
     WHERE r.room_id = $1 AND ${status === "pending" ? "r.status = 'pending'" : "r.status <> 'pending'"}
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [classroomId]
  );
  return rows.map(toReportView);
}

/**
 * Resolve a report. `remove` hides the reported content (soft, reversible by
 * a moderator) and closes every pending report on the same target; `dismiss`
 * closes only this report.
 */
export async function resolveReport(
  params: { reportId: string; roomId: string | null; action: "remove" | "dismiss"; resolverId: string; note?: string | null }
): Promise<void> {
  await db.transaction(async (tx) => {
    const args: SqlParam[] = [params.reportId];
    let roomFilter = "";
    if (params.roomId) {
      args.push(params.roomId);
      roomFilter = "AND room_id = $2";
    }
    const { rows } = await tx.query<{ id: string; post_id: string | null; comment_id: string | null; status: string }>(
      `SELECT id, post_id, comment_id, status FROM classroom_reports WHERE id = $1 ${roomFilter} FOR UPDATE`,
      args
    );
    const report = rows[0];
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw conflict("This report was already resolved.", "CLASSROOM_REPORT_RESOLVED");

    if (params.action === "remove") {
      if (report.post_id) {
        await tx.query(
          `UPDATE classroom_posts SET is_hidden = TRUE, hidden_by = $2, hidden_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [report.post_id, params.resolverId]
        );
      } else if (report.comment_id) {
        await tx.query(
          `UPDATE classroom_post_comments SET is_hidden = TRUE, hidden_by = $2, hidden_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [report.comment_id, params.resolverId]
        );
      }
      const col = report.post_id ? "post_id" : "comment_id";
      await tx.query(
        `UPDATE classroom_reports
            SET status = 'resolved_removed', resolved_by = $2, resolved_at = NOW(), resolution_note = $3
          WHERE ${col} = $1 AND status = 'pending'`,
        [report.post_id ?? report.comment_id, params.resolverId, params.note ?? null]
      );
    } else {
      await tx.query(
        `UPDATE classroom_reports
            SET status = 'resolved_dismissed', resolved_by = $2, resolved_at = NOW(), resolution_note = $3
          WHERE id = $1`,
        [report.id, params.resolverId, params.note ?? null]
      );
    }
  });
  logger.info({ reportId: params.reportId, roomId: params.roomId, action: params.action, resolverId: params.resolverId }, "[classroom:moderation] report resolved");
}

// ---------------------------------------------------------------------------
// Member fan-out
// ---------------------------------------------------------------------------

export async function notifyMembers(
  classroom: ClassroomRecord,
  excludeUserId: string | null,
  type: string,
  title: string,
  body: string,
  extra: Record<string, unknown> = {},
  client: Queryable = db
): Promise<void> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM classroom_enrolments WHERE room_id = $1 AND ($2::uuid IS NULL OR user_id <> $2::uuid)`,
    [classroom.id, excludeUserId]
  );
  await insertNotificationBatch(
    client,
    rows.map((r) => r.user_id),
    type,
    title,
    body,
    { roomId: classroom.id, classroomSlug: classroom.slug, ...extra }
  );
}
