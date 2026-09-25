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

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
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

type AuthorRow = {
  author_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  avatar_url: string | null;
  author_is_moderator: boolean;
};

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

/** Base FROM/JOIN clause shared by listPosts and getPost, as a raw fragment so
 * the hand-tuned WHERE/ORDER logic below can stay identical to the original. */
function postSelectFragment(viewerId: string | null) {
  return sql`
    FROM classroom_posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN classroom_moderators cm
           ON cm.room_id = p.room_id AND cm.user_id = p.author_id AND cm.status = 'active'
    LEFT JOIN classroom_likes l ON l.post_id = p.id AND l.user_id = ${viewerId}
  `;
}

const POST_COLUMNS_SQL = sql`
  p.id, p.category, p.title, p.body, p.is_pinned, p.is_locked, p.is_hidden,
  p.like_count, p.comment_count, p.created_at, p.updated_at, p.last_activity_at,
  p.author_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
  (cm.id IS NOT NULL) AS author_is_moderator,
  (l.id IS NOT NULL) AS liked_by_me
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
  const orm = await getDb();

  const where = [sql`p.room_id = ${classroom.id}`, sql`p.deleted_at IS NULL`];
  // Hidden posts stay visible to moderators (so they can be restored) and to
  // their own author; everyone else never sees them.
  if (!viewer.can.managePosts) {
    where.push(sql`(p.is_hidden = FALSE OR p.author_id = ${viewer.userId})`);
  }
  if (q.category) {
    where.push(sql`p.category = ${q.category}`);
  }

  const orderExpr =
    sort === "new"
      ? sql`date_trunc('milliseconds', p.created_at)`
      : sort === "top"
        ? sql`p.like_count`
        : sql`date_trunc('milliseconds', p.last_activity_at)`;
  // Cursor = "<pinned 0|1>|<sort value>|<id>" — opaque to clients.
  if (q.cursor) {
    const [pinnedStr, sortVal, id] = q.cursor.split("|");
    if (pinnedStr === undefined || sortVal === undefined || !id) throw badRequest("Invalid cursor");
    const pinned = pinnedStr === "1";
    const sortValTyped = sort === "top" ? Number(sortVal) : sortVal;
    const cast = sort === "top" ? sql`::int` : sql`::timestamptz`;
    where.push(
      sql`(p.is_pinned < ${pinned} OR (p.is_pinned = ${pinned} AND (${orderExpr} < ${sortValTyped}${cast} OR (${orderExpr} = ${sortValTyped}${cast} AND p.id < ${id}::uuid))))`
    );
  }

  const whereSql = sql.join(where, sql` AND `);
  const query = sql`
    SELECT ${POST_COLUMNS_SQL}
    ${postSelectFragment(viewer.userId)}
    WHERE ${whereSql}
    ORDER BY p.is_pinned DESC, ${orderExpr} DESC, p.id DESC
    LIMIT ${limit + 1}
  `;
  const rows = (await orm.execute(query)).rows as unknown as PostRow[];

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
  const orm = await getDb();
  const query = sql`
    SELECT ${POST_COLUMNS_SQL}
    ${postSelectFragment(viewer.userId)}
    WHERE p.id = ${postId} AND p.room_id = ${classroom.id} AND p.deleted_at IS NULL
    LIMIT 1
  `;
  const rows = (await orm.execute(query)).rows as unknown as PostRow[];
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
  const userId = viewer.userId;

  const orm = await getDb();
  const post = await orm.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.classroomPosts)
      .values({
        roomId: classroom.id,
        authorId: userId,
        category,
        title: input.title?.trim() || null,
        body: input.body.trim(),
      })
      .returning({ id: schema.classroomPosts.id });
    const id = row!.id;
    await tx
      .update(schema.classroomEnrolments)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(schema.classroomEnrolments.roomId, classroom.id), eq(schema.classroomEnrolments.userId, userId)));
    await evaluateBadges(classroom.id, userId, {}, ["posts"], tx);
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
  const orm = await getDb();
  const [row] = await orm
    .select({ authorId: schema.classroomPosts.authorId })
    .from(schema.classroomPosts)
    .where(and(eq(schema.classroomPosts.id, postId), eq(schema.classroomPosts.roomId, classroom.id), sql`${schema.classroomPosts.deletedAt} IS NULL`));
  if (!row) throw notFound("Post not found");
  const isAuthor = row.authorId === viewer.userId;

  const set: Record<string, unknown> = {};
  const contentEdit = patch.body !== undefined || patch.title !== undefined || patch.category !== undefined;
  if (contentEdit) {
    if (!isAuthor || !classroom.isActive) throw forbidden("Only the author can edit this post.", "CLASSROOM_FORBIDDEN");
    if (patch.body !== undefined) set.body = patch.body.trim();
    if (patch.title !== undefined) set.title = patch.title?.trim() || null;
    if (patch.category !== undefined) set.category = resolveCategory(classroom, patch.category, viewer);
  }
  const modEdit = patch.isPinned !== undefined || patch.isLocked !== undefined || patch.isHidden !== undefined;
  if (modEdit) {
    if (!viewer.can.managePosts) throw forbidden("Only the creator or a moderator can do this.", "CLASSROOM_FORBIDDEN");
    if (patch.isPinned !== undefined) set.isPinned = patch.isPinned;
    if (patch.isLocked !== undefined) set.isLocked = patch.isLocked;
    if (patch.isHidden !== undefined) {
      set.isHidden = patch.isHidden;
      set.hiddenBy = patch.isHidden ? viewer.userId : null;
      set.hiddenAt = patch.isHidden ? new Date() : null;
    }
  }
  if (Object.keys(set).length === 0) throw badRequest("Nothing to update");
  set.updatedAt = new Date();

  await orm.update(schema.classroomPosts).set(set).where(eq(schema.classroomPosts.id, postId));
  if (modEdit) {
    logger.info(
      { roomId: classroom.id, postId, moderatorId: viewer.userId, patch: { isPinned: patch.isPinned, isLocked: patch.isLocked, isHidden: patch.isHidden } },
      "[classroom:moderation] post updated"
    );
  }
  return getPost(classroom, viewer, postId);
}

export async function deletePost(classroom: ClassroomRecord, viewer: ClassroomViewer, postId: string): Promise<void> {
  const orm = await getDb();
  const [row] = await orm
    .select({ authorId: schema.classroomPosts.authorId })
    .from(schema.classroomPosts)
    .where(and(eq(schema.classroomPosts.id, postId), eq(schema.classroomPosts.roomId, classroom.id), sql`${schema.classroomPosts.deletedAt} IS NULL`));
  if (!row) throw notFound("Post not found");
  if (row.authorId !== viewer.userId && !viewer.can.managePosts) {
    throw forbidden("You can't delete this post.", "CLASSROOM_FORBIDDEN");
  }
  await orm.transaction(async (tx) => {
    await tx.update(schema.classroomPosts).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.classroomPosts.id, postId));
    // Close any open reports against the post — the content is gone.
    await tx
      .update(schema.classroomReports)
      .set({ status: "resolved_removed", resolvedBy: viewer.userId, resolvedAt: new Date() })
      .where(and(eq(schema.classroomReports.postId, postId), eq(schema.classroomReports.status, "pending")));
  });
  if (row.authorId !== viewer.userId) {
    logger.info({ roomId: classroom.id, postId, moderatorId: viewer.userId }, "[classroom:moderation] post deleted by moderator");
  }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

type CommentRow = AuthorRow & {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  is_hidden: boolean;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
};

export async function listComments(
  classroom: ClassroomRecord,
  viewer: ClassroomViewer,
  postId: string
): Promise<ClassroomCommentView[]> {
  // Visibility of the post itself is re-checked (hidden posts 404 for non-mods).
  await getPost(classroom, viewer, postId);
  const orm = await getDb();
  const hiddenFilter = viewer.can.managePosts ? sql`` : sql`AND (c.is_hidden = FALSE OR c.author_id = ${viewer.userId})`;
  const { rows } = await orm.execute<CommentRow>(sql`
    SELECT c.id, c.post_id, c.parent_id, c.body, c.is_hidden, c.like_count, c.created_at,
            c.author_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
            (cm.id IS NOT NULL) AS author_is_moderator,
            (l.id IS NOT NULL) AS liked_by_me
       FROM classroom_post_comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN classroom_moderators cm
              ON cm.room_id = c.room_id AND cm.user_id = c.author_id AND cm.status = 'active'
       LEFT JOIN classroom_likes l ON l.comment_id = c.id AND l.user_id = ${viewer.userId}
      WHERE c.post_id = ${postId} AND c.room_id = ${classroom.id} AND c.deleted_at IS NULL ${hiddenFilter}
      ORDER BY c.created_at ASC
      LIMIT 500
  `);
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
  const userId = viewer.userId;
  const orm = await getDb();
  const commentId = await orm.transaction(async (tx) => {
    const [post] = await tx
      .select({
        authorId: schema.classroomPosts.authorId,
        isLocked: schema.classroomPosts.isLocked,
        isHidden: schema.classroomPosts.isHidden,
        title: schema.classroomPosts.title,
      })
      .from(schema.classroomPosts)
      .where(and(eq(schema.classroomPosts.id, postId), eq(schema.classroomPosts.roomId, classroom.id), sql`${schema.classroomPosts.deletedAt} IS NULL`))
      .for("update");
    if (!post || (post.isHidden && !viewer.can.managePosts)) throw notFound("Post not found");
    if (post.isLocked && !viewer.can.managePosts) throw forbidden("Comments are closed on this post.", "CLASSROOM_POST_LOCKED");

    let parentId = input.parentId ?? null;
    let parentAuthor: string | null = null;
    if (parentId) {
      const [parent] = await tx
        .select({ authorId: schema.classroomPostComments.authorId, parentId: schema.classroomPostComments.parentId })
        .from(schema.classroomPostComments)
        .where(
          and(
            eq(schema.classroomPostComments.id, parentId),
            eq(schema.classroomPostComments.postId, postId),
            sql`${schema.classroomPostComments.deletedAt} IS NULL`
          )
        );
      if (!parent) throw badRequest("The comment you're replying to no longer exists.");
      // One level of threading: replies to a reply attach to its top-level parent.
      if (parent.parentId) parentId = parent.parentId;
      parentAuthor = parent.authorId;
    }

    const [inserted] = await tx
      .insert(schema.classroomPostComments)
      .values({
        postId,
        roomId: classroom.id,
        authorId: userId,
        parentId,
        body: input.body.trim(),
      })
      .returning({ id: schema.classroomPostComments.id });
    await tx
      .update(schema.classroomPosts)
      .set({ commentCount: sql`${schema.classroomPosts.commentCount} + 1`, lastActivityAt: new Date() })
      .where(eq(schema.classroomPosts.id, postId));
    await tx
      .update(schema.classroomEnrolments)
      .set({ lastActiveAt: new Date() })
      .where(and(eq(schema.classroomEnrolments.roomId, classroom.id), eq(schema.classroomEnrolments.userId, userId)));

    const notifyIds = new Set<string>();
    if (post.authorId !== userId) notifyIds.add(post.authorId);
    if (parentAuthor && parentAuthor !== userId) notifyIds.add(parentAuthor);
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
    return inserted!.id;
  });

  const all = await listComments(classroom, viewer, postId);
  const created = all.find((c) => c.id === commentId);
  if (!created) throw notFound("Comment not found");
  return created;
}

export async function deleteComment(classroom: ClassroomRecord, viewer: ClassroomViewer, commentId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [row] = await tx
      .select({ authorId: schema.classroomPostComments.authorId, postId: schema.classroomPostComments.postId })
      .from(schema.classroomPostComments)
      .where(
        and(
          eq(schema.classroomPostComments.id, commentId),
          eq(schema.classroomPostComments.roomId, classroom.id),
          sql`${schema.classroomPostComments.deletedAt} IS NULL`
        )
      )
      .for("update");
    if (!row) throw notFound("Comment not found");
    if (row.authorId !== viewer.userId && !viewer.can.managePosts) {
      throw forbidden("You can't delete this comment.", "CLASSROOM_FORBIDDEN");
    }
    // Soft-delete the comment and its replies; keep comment_count accurate.
    const gone = await tx
      .update(schema.classroomPostComments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          sql`(${schema.classroomPostComments.id} = ${commentId} OR ${schema.classroomPostComments.parentId} = ${commentId})`,
          sql`${schema.classroomPostComments.deletedAt} IS NULL`
        )
      )
      .returning({ id: schema.classroomPostComments.id });
    await tx
      .update(schema.classroomPosts)
      .set({ commentCount: sql`GREATEST(${schema.classroomPosts.commentCount} - ${gone.length}, 0)` })
      .where(eq(schema.classroomPosts.id, row.postId));
    const goneIds = gone.map((g) => g.id);
    if (goneIds.length > 0) {
      await tx
        .update(schema.classroomReports)
        .set({ status: "resolved_removed", resolvedBy: viewer.userId, resolvedAt: new Date() })
        .where(and(sql`${schema.classroomReports.commentId} = ANY(${goneIds}::uuid[])`, eq(schema.classroomReports.status, "pending")));
    }
    if (row.authorId !== viewer.userId) {
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
  const orm = await getDb();
  const result = await orm
    .update(schema.classroomPostComments)
    .set({
      isHidden: hidden,
      hiddenBy: hidden ? viewer.userId : null,
      hiddenAt: hidden ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.classroomPostComments.id, commentId),
        eq(schema.classroomPostComments.roomId, classroom.id),
        sql`${schema.classroomPostComments.deletedAt} IS NULL`
      )
    )
    .returning({ id: schema.classroomPostComments.id });
  if (result.length === 0) throw notFound("Comment not found");
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
  const userId = viewer.userId;
  const isPost = target.kind === "post";
  const table = isPost ? schema.classroomPosts : schema.classroomPostComments;
  const likeCol = isPost ? schema.classroomLikes.postId : schema.classroomLikes.commentId;

  let award: PointsAwardResult | null = null;
  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    const [row] = await tx
      .select({ authorId: table.authorId, likeCount: table.likeCount, isHidden: table.isHidden })
      .from(table)
      .where(and(eq(table.id, target.id), eq(table.roomId, classroom.id), sql`${table.deletedAt} IS NULL`))
      .for("update");
    if (!row || (row.isHidden && !viewer.can.managePosts)) throw notFound("Not found");
    const selfLike = row.authorId === userId;

    if (liked) {
      const likeValues = isPost
        ? { roomId: classroom.id, userId, postId: target.id }
        : { roomId: classroom.id, userId, commentId: target.id };
      const ins = await tx
        .insert(schema.classroomLikes)
        .values(likeValues)
        .onConflictDoNothing()
        .returning({ id: schema.classroomLikes.id });
      if (ins.length === 0) return { liked: true, likeCount: row.likeCount };
      const [upd] = await tx
        .update(table)
        .set({ likeCount: sql`${table.likeCount} + 1` })
        .where(eq(table.id, target.id))
        .returning({ likeCount: table.likeCount });
      if (!selfLike) {
        award = await awardClassroomPoints(
          {
            roomId: classroom.id,
            userId: row.authorId,
            source: "like_received",
            referenceId: `like:${ins[0]!.id}`,
            // Stable across like/unlike/like so the global XP bonus is earned once per liker+target.
            xpReferenceId: `classroom_like:${target.id}:${userId}`,
            classroom: { slug: classroom.slug, name: classroom.name },
          },
          tx
        );
      }
      return { liked: true, likeCount: upd?.likeCount ?? row.likeCount + 1 };
    }

    const del = await tx
      .delete(schema.classroomLikes)
      .where(and(eq(schema.classroomLikes.userId, userId), eq(likeCol, target.id)))
      .returning({ id: schema.classroomLikes.id });
    if (del.length === 0) return { liked: false, likeCount: row.likeCount };
    const [upd] = await tx
      .update(table)
      .set({ likeCount: sql`GREATEST(${table.likeCount} - 1, 0)` })
      .where(eq(table.id, target.id))
      .returning({ likeCount: table.likeCount });
    if (!selfLike) {
      await awardClassroomPoints(
        {
          roomId: classroom.id,
          userId: row.authorId,
          source: "like_removed",
          referenceId: `unlike:${del[0]!.id}`,
        },
        tx
      );
    }
    return { liked: false, likeCount: upd?.likeCount ?? Math.max(row.likeCount - 1, 0) };
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
  const userId = viewer.userId;
  const isPost = input.target.kind === "post";
  const table = isPost ? schema.classroomPosts : schema.classroomPostComments;
  const reportCol = isPost ? schema.classroomReports.postId : schema.classroomReports.commentId;

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const [row] = await tx
      .select({ authorId: table.authorId })
      .from(table)
      .where(and(eq(table.id, input.target.id), eq(table.roomId, classroom.id), sql`${table.deletedAt} IS NULL`));
    if (!row) throw notFound("Not found");
    if (row.authorId === userId) throw badRequest("You can't report your own content.");

    const reportValues = isPost
      ? {
          roomId: classroom.id,
          reporterId: userId,
          postId: input.target.id,
          reason: input.reason,
          details: input.details?.trim() || null,
          status: "pending" as const,
        }
      : {
          roomId: classroom.id,
          reporterId: userId,
          commentId: input.target.id,
          reason: input.reason,
          details: input.details?.trim() || null,
          status: "pending" as const,
        };
    const ins = await tx
      .insert(schema.classroomReports)
      .values(reportValues)
      .onConflictDoNothing()
      .returning({ id: schema.classroomReports.id });
    if (ins.length === 0) throw conflict("You've already reported this.", "CLASSROOM_ALREADY_REPORTED");

    const [{ n }] = await tx
      .select({ n: sql<string>`COUNT(*)` })
      .from(schema.classroomReports)
      .where(and(eq(reportCol, input.target.id), eq(schema.classroomReports.status, "pending")));
    if (Number(n ?? 0) >= ESCALATION_THRESHOLD) {
      await tx
        .update(schema.classroomReports)
        .set({ escalated: true })
        .where(and(eq(reportCol, input.target.id), eq(schema.classroomReports.status, "pending")));
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

type ReportRow = {
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
};

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
  const orm = await getDb();
  const statusFilter = status === "pending" ? sql`r.status = 'pending'` : sql`r.status <> 'pending'`;
  const { rows } = await orm.execute<ReportRow>(sql`
    ${sql.raw(REPORT_SELECT)}
     WHERE r.room_id = ${classroomId} AND ${statusFilter}
     ORDER BY r.created_at DESC
     LIMIT 200
  `);
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
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    const roomFilter = params.roomId ? eq(schema.classroomReports.roomId, params.roomId) : undefined;
    const [report] = await tx
      .select({
        id: schema.classroomReports.id,
        postId: schema.classroomReports.postId,
        commentId: schema.classroomReports.commentId,
        status: schema.classroomReports.status,
      })
      .from(schema.classroomReports)
      .where(roomFilter ? and(eq(schema.classroomReports.id, params.reportId), roomFilter) : eq(schema.classroomReports.id, params.reportId))
      .for("update");
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw conflict("This report was already resolved.", "CLASSROOM_REPORT_RESOLVED");

    if (params.action === "remove") {
      if (report.postId) {
        await tx
          .update(schema.classroomPosts)
          .set({ isHidden: true, hiddenBy: params.resolverId, hiddenAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.classroomPosts.id, report.postId));
      } else if (report.commentId) {
        await tx
          .update(schema.classroomPostComments)
          .set({ isHidden: true, hiddenBy: params.resolverId, hiddenAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.classroomPostComments.id, report.commentId));
      }
      const reportCol = report.postId ? schema.classroomReports.postId : schema.classroomReports.commentId;
      const targetId = report.postId ?? report.commentId!;
      await tx
        .update(schema.classroomReports)
        .set({ status: "resolved_removed", resolvedBy: params.resolverId, resolvedAt: new Date(), resolutionNote: params.note ?? null })
        .where(and(eq(reportCol, targetId), eq(schema.classroomReports.status, "pending")));
    } else {
      await tx
        .update(schema.classroomReports)
        .set({ status: "resolved_dismissed", resolvedBy: params.resolverId, resolvedAt: new Date(), resolutionNote: params.note ?? null })
        .where(eq(schema.classroomReports.id, report.id));
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
  client?: DbOrTx
): Promise<void> {
  const orm = client ?? (await getDb());
  const rows = await orm
    .select({ userId: schema.classroomEnrolments.userId })
    .from(schema.classroomEnrolments)
    .where(
      excludeUserId
        ? and(eq(schema.classroomEnrolments.roomId, classroom.id), sql`${schema.classroomEnrolments.userId} <> ${excludeUserId}::uuid`)
        : eq(schema.classroomEnrolments.roomId, classroom.id)
    );
  await insertNotificationBatch(
    orm,
    rows.map((r) => r.userId),
    type,
    title,
    body,
    { roomId: classroom.id, classroomSlug: classroom.slug, ...extra }
  );
}
