/**
 * lib/bbforum/repo.ts
 *
 * Data layer for the old-school BB-style forum (boards → threads → posts).
 * Distinct from lib/forum/* (the "Answers" Q&A feature) — see migrations
 * 0016_bbforum.sql and 0032_bbforum_full.sql for the schema.
 *
 * `body` always stores the RAW source (plain text or Markdown, per
 * `content_format`) — never pre-rendered HTML — so posts can be re-opened
 * for editing. Render with `sanitizeForumPostContent()` from
 * lib/security/htmlSanitizer at read time.
 *
 * Business rules (eligibility, rewards, moderation, pot/treasury payouts,
 * image cost charging) live in lib/bbforum/service.ts, which calls into
 * this module for persistence.
 */

import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { generateUniqueSlug } from "@/lib/slug";
import { notFound, forbidden } from "@/lib/api/errors";

export type ContentFormat = "plaintext" | "markdown";

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
  content_format: ContentFormat;
  image_url: string | null;
  is_locked: boolean;
  is_pinned: boolean;
  view_count: number;
  reply_count: number;
  last_reply_at: string;
  status: string;
  edited_at: string | null;
  pot_total_credits: number;
  pot_per_claim_credits: number;
  pot_max_claims: number;
  pot_claims_count: number;
  pot_refunded_at: string | null;
  created_at: string;
}

export interface PostRow {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  content_format: ContentFormat;
  image_url: string | null;
  quoted_post_id: string | null;
  is_op: boolean;
  reaction_count: number;
  status: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostWithAuthor extends PostRow {
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
  quoted_body: string | null;
  quoted_content_format: ContentFormat | null;
  quoted_author_username: string | null;
  quoted_author_display_name: string | null;
  my_reaction: string | null;
}

// ---------------------------------------------------------------------------
// Boards (public reads)
// ---------------------------------------------------------------------------

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

export async function getBoardById(id: string): Promise<BoardRow | null> {
  const { rows } = await db.query<BoardRow>(`SELECT * FROM bb_boards WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Boards (admin CRUD)
// ---------------------------------------------------------------------------

export async function listAllBoardsAdmin(): Promise<BoardRow[]> {
  const { rows } = await db.query<BoardRow>(`SELECT * FROM bb_boards ORDER BY sort_order ASC, name ASC`);
  return rows;
}

export async function createBoard(input: {
  parentId: string | null;
  name: string;
  description: string | null;
  iconEmoji: string;
  sortOrder: number;
}): Promise<BoardRow> {
  const slug = await generateUniqueSlug("bb_board", input.name, crypto.randomUUID());
  const { rows } = await db.query<BoardRow>(
    `INSERT INTO bb_boards (parent_id, slug, name, description, icon_emoji, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.parentId, slug, input.name.trim(), input.description?.trim() || null, input.iconEmoji, input.sortOrder]
  );
  return rows[0];
}

export async function updateBoard(
  id: string,
  patch: Partial<{ name: string; description: string | null; iconEmoji: string; sortOrder: number; isActive: boolean; parentId: string | null }>
): Promise<BoardRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); params.push(patch.name.trim()); }
  if (patch.description !== undefined) { sets.push(`description = $${i++}`); params.push(patch.description); }
  if (patch.iconEmoji !== undefined) { sets.push(`icon_emoji = $${i++}`); params.push(patch.iconEmoji); }
  if (patch.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); params.push(patch.sortOrder); }
  if (patch.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(patch.isActive); }
  if (patch.parentId !== undefined) { sets.push(`parent_id = $${i++}`); params.push(patch.parentId); }
  if (sets.length === 0) {
    const existing = await getBoardById(id);
    if (!existing) throw notFound("Board not found");
    return existing;
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query<BoardRow>(
    `UPDATE bb_boards SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    params
  );
  if (!rows[0]) throw notFound("Board not found");
  return rows[0];
}

export async function deleteBoard(id: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM bb_boards WHERE id = $1`, [id]);
  if (!rowCount) throw notFound("Board not found");
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

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

export async function getThreadById(id: string): Promise<ThreadRow | null> {
  const { rows } = await db.query<ThreadRow>(`SELECT * FROM bb_threads WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function listPostsInThread(threadId: string, viewerId: string | null = null): Promise<PostWithAuthor[]> {
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_emoji AS author_avatar_emoji,
            qp.body AS quoted_body, qp.content_format AS quoted_content_format,
            qu.username AS quoted_author_username, qu.display_name AS quoted_author_display_name,
            (SELECT r.emoji FROM bb_post_reactions r WHERE r.post_id = p.id AND r.user_id = $2) AS my_reaction
     FROM bb_posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN bb_posts qp ON qp.id = p.quoted_post_id AND qp.deleted_at IS NULL
     LEFT JOIN users qu ON qu.id = qp.author_id
     WHERE p.thread_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.created_at ASC`,
    [threadId, viewerId]
  );
  return rows;
}

export async function getPostById(id: string): Promise<PostRow | null> {
  const { rows } = await db.query<PostRow>(`SELECT * FROM bb_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function incrementThreadViewCount(threadId: string): Promise<void> {
  await db.query(`UPDATE bb_threads SET view_count = view_count + 1 WHERE id = $1`, [threadId]);
}

export interface CreateThreadInput {
  boardId: string;
  authorId: string;
  title: string;
  body: string;
  contentFormat: ContentFormat;
  imageUrl?: string | null;
  potPerClaimCredits?: number;
  potMaxClaims?: number;
}

/**
 * Create a new thread with its first post (the OP), atomically.
 *
 * Accepts an optional outer transaction client so the caller (service layer)
 * can charge the pot-funding/image-cost debits in the SAME transaction as
 * the insert — e.g. `db.transaction(tx => { await debitCoins(..., tx); return createThread(input, tx); })`.
 */
export async function createThread(input: CreateThreadInput, outerTx?: TransactionClient): Promise<ThreadRow> {
  const potPerClaim = Math.max(0, input.potPerClaimCredits ?? 0);
  const potMaxClaims = Math.max(0, input.potMaxClaims ?? 0);
  const potTotal = potPerClaim * potMaxClaims;

  const run = async (tx: TransactionClient) => {
    const { rows: boardRows } = await tx.query<{ id: string }>(`SELECT id FROM bb_boards WHERE id = $1 AND is_active = true FOR UPDATE`, [input.boardId]);
    if (!boardRows[0]) throw notFound("Board not found");

    const slug = await generateUniqueSlug("bb_thread", input.title, crypto.randomUUID(), tx);

    const { rows: threadRows } = await tx.query<ThreadRow>(
      `INSERT INTO bb_threads (board_id, author_id, title, slug, content_format, image_url, pot_total_credits, pot_per_claim_credits, pot_max_claims)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [input.boardId, input.authorId, input.title.trim(), slug, input.contentFormat, input.imageUrl ?? null, potTotal, potPerClaim, potMaxClaims]
    );
    const thread = threadRows[0];

    await tx.query(
      `INSERT INTO bb_posts (thread_id, author_id, body, content_format, image_url, is_op)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [thread.id, input.authorId, input.body.trim(), input.contentFormat, input.imageUrl ?? null]
    );

    await tx.query(
      `UPDATE bb_boards SET thread_count = thread_count + 1, post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [input.boardId]
    );

    return thread;
  };

  return outerTx ? run(outerTx) : db.transaction(run);
}

export interface CreateReplyInput {
  threadId: string;
  authorId: string;
  body: string;
  contentFormat: ContentFormat;
  imageUrl?: string | null;
  quotedPostId?: string | null;
}

/**
 * Reply to an existing thread. Locked threads reject new replies.
 *
 * Also attempts a pot claim for the replier in the SAME transaction as the
 * insert (see tryClaimPot) so the claims-count increment can never race
 * ahead of or behind the reply itself. Returns the pot amount claimed (0 if
 * none) alongside the created post.
 */
export async function createReply(input: CreateReplyInput): Promise<{ post: PostRow; potClaimedCredits: number }> {
  return db.transaction(async (tx) => {
    const { rows: threadRows } = await tx.query<ThreadRow>(
      `SELECT * FROM bb_threads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.threadId]
    );
    const thread = threadRows[0];
    if (!thread) throw notFound("Thread not found");
    if (thread.is_locked) throw forbidden("This thread is locked.", "BBFORUM_THREAD_LOCKED");

    let quotedPostId: string | null = null;
    if (input.quotedPostId) {
      const { rows: qRows } = await tx.query<{ id: string }>(
        `SELECT id FROM bb_posts WHERE id = $1 AND thread_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [input.quotedPostId, input.threadId]
      );
      quotedPostId = qRows[0]?.id ?? null;
    }

    const { rows: postRows } = await tx.query<PostRow>(
      `INSERT INTO bb_posts (thread_id, author_id, body, content_format, image_url, quoted_post_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.threadId, input.authorId, input.body.trim(), input.contentFormat, input.imageUrl ?? null, quotedPostId]
    );

    await tx.query(
      `UPDATE bb_threads SET reply_count = reply_count + 1, last_reply_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [input.threadId]
    );
    await tx.query(
      `UPDATE bb_boards SET post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [thread.board_id]
    );

    const potClaimedCredits = await tryClaimPot(tx, input.threadId, postRows[0].id, input.authorId);

    return { post: postRows[0], potClaimedCredits };
  });
}

// ---------------------------------------------------------------------------
// Edit / delete / lock / pin
// ---------------------------------------------------------------------------

export async function updatePostBody(postId: string, body: string, contentFormat: ContentFormat): Promise<PostRow> {
  const { rows } = await db.query<PostRow>(
    `UPDATE bb_posts SET body = $2, content_format = $3, edited_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [postId, body.trim(), contentFormat]
  );
  if (!rows[0]) throw notFound("Post not found");
  return rows[0];
}

export async function deletePost(postId: string): Promise<void> {
  const { rows } = await db.query<{ thread_id: string; is_op: boolean }>(
    `UPDATE bb_posts SET status = 'removed', deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING thread_id, is_op`,
    [postId]
  );
  const post = rows[0];
  if (!post) throw notFound("Post not found");
  if (post.is_op) {
    // Deleting the OP soft-deletes the whole thread — mirrors deleteQuestion in Answers.
    await db.query(`UPDATE bb_threads SET status = 'removed', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [post.thread_id]);
  } else {
    await db.query(`UPDATE bb_threads SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1`, [post.thread_id]);
  }
}

export async function updateThreadTitle(threadId: string, title: string): Promise<ThreadRow> {
  const { rows } = await db.query<ThreadRow>(
    `UPDATE bb_threads SET title = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [threadId, title.trim()]
  );
  if (!rows[0]) throw notFound("Thread not found");
  return rows[0];
}

export async function setThreadLocked(threadId: string, locked: boolean): Promise<void> {
  const { rowCount } = await db.query(`UPDATE bb_threads SET is_locked = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [threadId, locked]);
  if (!rowCount) throw notFound("Thread not found");
}

export async function setThreadPinned(threadId: string, pinned: boolean): Promise<void> {
  const { rowCount } = await db.query(`UPDATE bb_threads SET is_pinned = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [threadId, pinned]);
  if (!rowCount) throw notFound("Thread not found");
}

// ---------------------------------------------------------------------------
// Reactions (toggle — one emoji per user per post)
// ---------------------------------------------------------------------------

export async function toggleReaction(postId: string, userId: string, emoji: string): Promise<{ reactionCount: number; myReaction: string | null }> {
  return db.transaction(async (tx: TransactionClient) => {
    const { rows: postRows } = await tx.query<{ id: string }>(`SELECT id FROM bb_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [postId]);
    if (!postRows[0]) throw notFound("Post not found");

    const { rows: existingRows } = await tx.query<{ emoji: string }>(
      `SELECT emoji FROM bb_post_reactions WHERE post_id = $1 AND user_id = $2 FOR UPDATE`,
      [postId, userId]
    );
    const existing = existingRows[0]?.emoji ?? null;

    let delta = 0;
    let myReaction: string | null;
    if (existing === emoji) {
      await tx.query(`DELETE FROM bb_post_reactions WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
      delta = -1;
      myReaction = null;
    } else if (existing === null) {
      await tx.query(`INSERT INTO bb_post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)`, [postId, userId, emoji]);
      delta = 1;
      myReaction = emoji;
    } else {
      await tx.query(`UPDATE bb_post_reactions SET emoji = $3, created_at = NOW() WHERE post_id = $1 AND user_id = $2`, [postId, userId, emoji]);
      myReaction = emoji;
    }

    const { rows: updated } = await tx.query<{ reaction_count: number }>(
      `UPDATE bb_posts SET reaction_count = GREATEST(reaction_count + $2, 0) WHERE id = $1 RETURNING reaction_count`,
      [postId, delta]
    );

    return { reactionCount: updated[0].reaction_count, myReaction };
  });
}

// ---------------------------------------------------------------------------
// Pot / treasury claims
// ---------------------------------------------------------------------------

/**
 * Attempts to record a pot claim for `userId` on `threadId` as part of
 * replying with `postId`. Returns the amount paid out (0 if the pot has no
 * remaining slots, the user already claimed, or the thread has no pot).
 * Must be called from within the same transaction as the reply insert so
 * the claims-count increment and the reply are atomic together.
 */
export async function tryClaimPot(
  tx: TransactionClient,
  threadId: string,
  postId: string,
  userId: string
): Promise<number> {
  const { rows: threadRows } = await tx.query<{
    pot_per_claim_credits: number;
    pot_max_claims: number;
    pot_claims_count: number;
    author_id: string;
  }>(
    `SELECT pot_per_claim_credits, pot_max_claims, pot_claims_count, author_id
     FROM bb_threads WHERE id = $1 FOR UPDATE`,
    [threadId]
  );
  const thread = threadRows[0];
  if (!thread) return 0;
  if (thread.author_id === userId) return 0; // OP can't claim their own pot
  if (thread.pot_max_claims <= 0 || thread.pot_claims_count >= thread.pot_max_claims) return 0;

  const { rowCount } = await tx.query(
    `INSERT INTO bb_pot_claims (thread_id, post_id, user_id, amount_credits) VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id, user_id) DO NOTHING`,
    [threadId, postId, userId, thread.pot_per_claim_credits]
  );
  if (!rowCount) return 0; // already claimed

  await tx.query(`UPDATE bb_threads SET pot_claims_count = pot_claims_count + 1 WHERE id = $1`, [threadId]);
  return thread.pot_per_claim_credits;
}

/** Threads whose pot has unclaimed credits and has gone quiet — candidates for auto-refund. */
export async function listExpiredUnclaimedPots(inactivityDays: number): Promise<{ id: string; author_id: string; pot_total_credits: number; pot_per_claim_credits: number; pot_claims_count: number }[]> {
  const { rows } = await db.query(
    `SELECT id, author_id, pot_total_credits, pot_per_claim_credits, pot_claims_count
     FROM bb_threads
     WHERE deleted_at IS NULL AND pot_refunded_at IS NULL
       AND pot_total_credits > (pot_per_claim_credits * pot_claims_count)
       AND last_reply_at < NOW() - ($1 * INTERVAL '1 day')`,
    [inactivityDays]
  );
  return rows;
}

export async function markPotRefunded(threadId: string): Promise<void> {
  await db.query(`UPDATE bb_threads SET pot_refunded_at = NOW() WHERE id = $1`, [threadId]);
}
