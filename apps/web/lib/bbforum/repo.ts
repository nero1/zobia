/**
 * lib/bbforum/repo.ts
 *
 * Data layer for the old-school BB-style forum (boards → threads → posts).
 * Distinct from lib/forum/* (the "Answers" Q&A feature) — see migration
 * 0016_bbforum.sql for the schema. Initial functional stub: CRUD + listing,
 * no moderation queue/reactions yet (mirrors the Answers feature's own
 * early shape before its admin tooling was built).
 */

import { db } from "@/lib/db";
import { generateUniqueSlug } from "@/lib/slug";
import { notFound, forbidden } from "@/lib/api/errors";

export interface BoardRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  sort_order: number;
  thread_count: number;
  post_count: number;
  last_post_at: string | null;
  is_active: boolean;
}

export interface ThreadRow {
  id: string;
  board_id: string;
  author_id: string;
  title: string;
  slug: string;
  is_locked: boolean;
  is_pinned: boolean;
  view_count: number;
  reply_count: number;
  last_reply_at: string;
  status: string;
  created_at: string;
}

export interface PostRow {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PostWithAuthor extends PostRow {
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
}

/** Top-level boards, each with its direct sub-boards nested. */
export async function listBoardTree(): Promise<(BoardRow & { subBoards: BoardRow[] })[]> {
  const { rows } = await db.query<BoardRow>(
    `SELECT * FROM bb_boards WHERE is_active = true ORDER BY sort_order ASC, name ASC`
  );
  const topLevel = rows.filter((b) => !b.parent_id);
  const byParent = new Map<string, BoardRow[]>();
  for (const b of rows) {
    if (!b.parent_id) continue;
    const list = byParent.get(b.parent_id) ?? [];
    list.push(b);
    byParent.set(b.parent_id, list);
  }
  return topLevel.map((b) => ({ ...b, subBoards: byParent.get(b.id) ?? [] }));
}

export async function getBoardBySlug(slug: string): Promise<BoardRow | null> {
  const { rows } = await db.query<BoardRow>(`SELECT * FROM bb_boards WHERE slug = $1 AND is_active = true LIMIT 1`, [slug]);
  return rows[0] ?? null;
}

export interface ThreadListPage {
  threads: ThreadRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listThreadsInBoard(boardId: string, limit = 30, cursor: string | null = null): Promise<ThreadListPage> {
  const params: (string | number)[] = [boardId, limit + 1];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor);
    cursorClause = `AND t.last_reply_at < $${params.length}`;
  }
  const { rows } = await db.query<ThreadRow>(
    `SELECT t.* FROM bb_threads t
     WHERE t.board_id = $1 AND t.deleted_at IS NULL ${cursorClause}
     ORDER BY t.is_pinned DESC, t.last_reply_at DESC
     LIMIT $2`,
    params
  );
  const hasMore = rows.length > limit;
  const threads = hasMore ? rows.slice(0, limit) : rows;
  return { threads, hasMore, nextCursor: hasMore ? threads[threads.length - 1].last_reply_at : null };
}

export async function getThreadBySlug(slug: string): Promise<ThreadRow | null> {
  const { rows } = await db.query<ThreadRow>(`SELECT * FROM bb_threads WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`, [slug]);
  return rows[0] ?? null;
}

export async function listPostsInThread(threadId: string): Promise<PostWithAuthor[]> {
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_emoji AS author_avatar_emoji
     FROM bb_posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.thread_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.created_at ASC`,
    [threadId]
  );
  return rows;
}

export async function incrementThreadViewCount(threadId: string): Promise<void> {
  await db.query(`UPDATE bb_threads SET view_count = view_count + 1 WHERE id = $1`, [threadId]);
}

/** Create a new thread with its first post (the OP), atomically. */
export async function createThread(input: {
  boardId: string;
  authorId: string;
  title: string;
  body: string;
}): Promise<ThreadRow> {
  return db.transaction(async (tx) => {
    const { rows: boardRows } = await tx.query<{ id: string }>(`SELECT id FROM bb_boards WHERE id = $1 AND is_active = true FOR UPDATE`, [input.boardId]);
    if (!boardRows[0]) throw notFound("Board not found");

    const slug = await generateUniqueSlug("bb_thread", input.title, crypto.randomUUID(), tx);

    const { rows: threadRows } = await tx.query<ThreadRow>(
      `INSERT INTO bb_threads (board_id, author_id, title, slug)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.boardId, input.authorId, input.title.trim(), slug]
    );
    const thread = threadRows[0];

    await tx.query(
      `INSERT INTO bb_posts (thread_id, author_id, body) VALUES ($1, $2, $3)`,
      [thread.id, input.authorId, input.body.trim()]
    );

    await tx.query(
      `UPDATE bb_boards SET thread_count = thread_count + 1, post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [input.boardId]
    );

    return thread;
  });
}

/** Reply to an existing thread. Locked threads reject new replies. */
export async function createReply(input: {
  threadId: string;
  authorId: string;
  body: string;
}): Promise<PostRow> {
  return db.transaction(async (tx) => {
    const { rows: threadRows } = await tx.query<ThreadRow>(
      `SELECT * FROM bb_threads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.threadId]
    );
    const thread = threadRows[0];
    if (!thread) throw notFound("Thread not found");
    if (thread.is_locked) throw forbidden("This thread is locked.", "BBFORUM_THREAD_LOCKED");

    const { rows: postRows } = await tx.query<PostRow>(
      `INSERT INTO bb_posts (thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [input.threadId, input.authorId, input.body.trim()]
    );

    await tx.query(
      `UPDATE bb_threads SET reply_count = reply_count + 1, last_reply_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [input.threadId]
    );
    await tx.query(
      `UPDATE bb_boards SET post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [thread.board_id]
    );

    return postRows[0];
  });
}
