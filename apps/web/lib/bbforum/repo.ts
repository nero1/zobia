/**
 * lib/bbforum/repo.ts
 *
 * Data layer for the old-school BB-style forum (boards → threads → posts).
 * Distinct from lib/forum/* (the "Answers" Q&A feature) — see migrations
 * 0001_consolidated_schema.sql and 0001_consolidated_schema.sql for the schema.
 *
 * `body` always stores the RAW source (plain text or Markdown, per
 * `content_format`) — never pre-rendered HTML — so posts can be re-opened
 * for editing. Render with `sanitizeForumPostContent()` from
 * lib/security/htmlSanitizer at read time.
 *
 * Business rules (eligibility, rewards, moderation, pot/treasury payouts,
 * image cost charging) live in lib/bbforum/service.ts, which calls into
 * this module for persistence.
 *
 * DRIZZLE MIGRATION NOTES:
 *  - None of `bb_boards`, `bb_threads`, `bb_posts`, `bb_post_reactions` or
 *    `bb_pot_claims` have Drizzle table definitions in lib/db/schema.ts, so
 *    every query here is a `sql` template run through the Drizzle instance
 *    (`getDb()`) instead of the query builder. Flagged for the schema owner.
 *  - `createThread` accepts an optional `outerTx` so lib/bbforum/service.ts
 *    can share ONE Drizzle transaction across its own
 *    `debitCoins`/`chargeImageCost` calls and this insert. `generateUniqueSlug`
 *    (lib/slug.ts, out of this migration's scope) still takes the legacy
 *    `Queryable` shape, so the slug is generated before the transaction
 *    opens (an unlocked read, same as lib/quizzes/service.ts's and
 *    lib/polls/service.ts's create flows) rather than under `FOR UPDATE`
 *    inside it — a negligible race window on identical titles, accepted
 *    elsewhere in this codebase for the same reason.
 */

import { getDb, type DbOrTx } from "@/lib/db/drizzle";
import { sql } from "drizzle-orm";
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
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_boards WHERE is_active = true ORDER BY sort_order ASC, name ASC`);
  const boards = rows as unknown as BoardRow[];
  const topLevel = boards.filter((b) => !b.parent_id);
  const byParent = new Map<string, BoardRow[]>();
  for (const b of boards) {
    if (!b.parent_id) continue;
    const list = byParent.get(b.parent_id) ?? [];
    list.push(b);
    byParent.set(b.parent_id, list);
  }
  return topLevel.map((b) => ({ ...b, subBoards: byParent.get(b.id) ?? [] }));
}

export async function getBoardBySlug(slug: string): Promise<BoardRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_boards WHERE slug = ${slug} AND is_active = true LIMIT 1`);
  return (rows[0] as unknown as BoardRow) ?? null;
}

export async function getBoardById(id: string): Promise<BoardRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_boards WHERE id = ${id} LIMIT 1`);
  return (rows[0] as unknown as BoardRow) ?? null;
}

// ---------------------------------------------------------------------------
// Boards (admin CRUD)
// ---------------------------------------------------------------------------

export async function listAllBoardsAdmin(): Promise<BoardRow[]> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_boards ORDER BY sort_order ASC, name ASC`);
  return rows as unknown as BoardRow[];
}

export async function createBoard(input: {
  parentId: string | null;
  name: string;
  description: string | null;
  iconEmoji: string;
  sortOrder: number;
}): Promise<BoardRow> {
  const slug = await generateUniqueSlug("bb_board", input.name, crypto.randomUUID());
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    INSERT INTO bb_boards (parent_id, slug, name, description, icon_emoji, sort_order)
    VALUES (${input.parentId}, ${slug}, ${input.name.trim()}, ${input.description?.trim() || null}, ${input.iconEmoji}, ${input.sortOrder})
    RETURNING *
  `);
  return rows[0] as unknown as BoardRow;
}

export async function updateBoard(
  id: string,
  patch: Partial<{ name: string; description: string | null; iconEmoji: string; sortOrder: number; isActive: boolean; parentId: string | null }>
): Promise<BoardRow> {
  const sets: ReturnType<typeof sql>[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name.trim()}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.iconEmoji !== undefined) sets.push(sql`icon_emoji = ${patch.iconEmoji}`);
  if (patch.sortOrder !== undefined) sets.push(sql`sort_order = ${patch.sortOrder}`);
  if (patch.isActive !== undefined) sets.push(sql`is_active = ${patch.isActive}`);
  if (patch.parentId !== undefined) sets.push(sql`parent_id = ${patch.parentId}`);
  if (sets.length === 0) {
    const existing = await getBoardById(id);
    if (!existing) throw notFound("Board not found");
    return existing;
  }
  sets.push(sql`updated_at = NOW()`);
  const orm = await getDb();
  const { rows } = await orm.execute(sql`UPDATE bb_boards SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING *`);
  if (!rows[0]) throw notFound("Board not found");
  return rows[0] as unknown as BoardRow;
}

export async function deleteBoard(id: string): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`DELETE FROM bb_boards WHERE id = ${id}`);
  if (!result.rowCount) throw notFound("Board not found");
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
  const orm = await getDb();
  const cursorClause = cursor ? sql`AND t.last_reply_at < ${cursor}` : sql``;
  const { rows } = await orm.execute(sql`
    SELECT t.* FROM bb_threads t
    WHERE t.board_id = ${boardId} AND t.deleted_at IS NULL ${cursorClause}
    ORDER BY t.is_pinned DESC, t.last_reply_at DESC
    LIMIT ${limit + 1}
  `);
  const allRows = rows as unknown as ThreadRow[];
  const hasMore = allRows.length > limit;
  const threads = hasMore ? allRows.slice(0, limit) : allRows;
  return { threads, hasMore, nextCursor: hasMore ? threads[threads.length - 1].last_reply_at : null };
}

export async function getThreadBySlug(slug: string): Promise<ThreadRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_threads WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`);
  return (rows[0] as unknown as ThreadRow) ?? null;
}

export async function getThreadById(id: string): Promise<ThreadRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_threads WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`);
  return (rows[0] as unknown as ThreadRow) ?? null;
}

export async function listPostsInThread(threadId: string, viewerId: string | null = null): Promise<PostWithAuthor[]> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    SELECT p.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_emoji AS author_avatar_emoji,
           qp.body AS quoted_body, qp.content_format AS quoted_content_format,
           qu.username AS quoted_author_username, qu.display_name AS quoted_author_display_name,
           (SELECT r.emoji FROM bb_post_reactions r WHERE r.post_id = p.id AND r.user_id = ${viewerId}) AS my_reaction
    FROM bb_posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN bb_posts qp ON qp.id = p.quoted_post_id AND qp.deleted_at IS NULL
    LEFT JOIN users qu ON qu.id = qp.author_id
    WHERE p.thread_id = ${threadId} AND p.deleted_at IS NULL
    ORDER BY p.created_at ASC
  `);
  return rows as unknown as PostWithAuthor[];
}

export async function getPostById(id: string): Promise<PostRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`SELECT * FROM bb_posts WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`);
  return (rows[0] as unknown as PostRow) ?? null;
}

export async function incrementThreadViewCount(threadId: string): Promise<void> {
  const orm = await getDb();
  await orm.execute(sql`UPDATE bb_threads SET view_count = view_count + 1 WHERE id = ${threadId}`);
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
 * Accepts an optional outer transaction so the caller (service layer) can
 * charge the pot-funding/image-cost debits in the SAME transaction as the
 * insert — e.g. `orm.transaction(tx => { await debitCoins(..., tx); return createThread(input, tx); })`.
 * See the module DRIZZLE MIGRATION NOTES above for why the slug is
 * generated before the transaction opens rather than under `FOR UPDATE`.
 */
export async function createThread(input: CreateThreadInput, outerTx?: DbOrTx): Promise<ThreadRow> {
  const potPerClaim = Math.max(0, input.potPerClaimCredits ?? 0);
  const potMaxClaims = Math.max(0, input.potMaxClaims ?? 0);
  const potTotal = potPerClaim * potMaxClaims;

  const slug = await generateUniqueSlug("bb_thread", input.title, crypto.randomUUID());

  const run = async (tx: DbOrTx) => {
    const { rows: boardRows } = await tx.execute(sql`SELECT id FROM bb_boards WHERE id = ${input.boardId} AND is_active = true FOR UPDATE`);
    if (!(boardRows as unknown as { id: string }[])[0]) throw notFound("Board not found");

    const { rows: threadRows } = await tx.execute(sql`
      INSERT INTO bb_threads (board_id, author_id, title, slug, content_format, image_url, pot_total_credits, pot_per_claim_credits, pot_max_claims)
      VALUES (${input.boardId}, ${input.authorId}, ${input.title.trim()}, ${slug}, ${input.contentFormat}, ${input.imageUrl ?? null}, ${potTotal}, ${potPerClaim}, ${potMaxClaims})
      RETURNING *
    `);
    const thread = (threadRows as unknown as ThreadRow[])[0];

    await tx.execute(sql`
      INSERT INTO bb_posts (thread_id, author_id, body, content_format, image_url, is_op)
      VALUES (${thread.id}, ${input.authorId}, ${input.body.trim()}, ${input.contentFormat}, ${input.imageUrl ?? null}, true)
    `);

    await tx.execute(sql`
      UPDATE bb_boards SET thread_count = thread_count + 1, post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = ${input.boardId}
    `);

    return thread;
  };

  if (outerTx) return run(outerTx);
  const orm = await getDb();
  return orm.transaction(run);
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
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const { rows: threadRows } = await tx.execute(sql`SELECT * FROM bb_threads WHERE id = ${input.threadId} AND deleted_at IS NULL FOR UPDATE`);
    const thread = threadRows[0] as unknown as ThreadRow | undefined;
    if (!thread) throw notFound("Thread not found");
    if (thread.is_locked) throw forbidden("This thread is locked.", "BBFORUM_THREAD_LOCKED");

    let quotedPostId: string | null = null;
    if (input.quotedPostId) {
      const { rows: qRows } = await tx.execute(sql`SELECT id FROM bb_posts WHERE id = ${input.quotedPostId} AND thread_id = ${input.threadId} AND deleted_at IS NULL LIMIT 1`);
      quotedPostId = (qRows[0] as unknown as { id: string } | undefined)?.id ?? null;
    }

    const { rows: postRows } = await tx.execute(sql`
      INSERT INTO bb_posts (thread_id, author_id, body, content_format, image_url, quoted_post_id)
      VALUES (${input.threadId}, ${input.authorId}, ${input.body.trim()}, ${input.contentFormat}, ${input.imageUrl ?? null}, ${quotedPostId}) RETURNING *
    `);
    const post = postRows[0] as unknown as PostRow;

    await tx.execute(sql`UPDATE bb_threads SET reply_count = reply_count + 1, last_reply_at = NOW(), updated_at = NOW() WHERE id = ${input.threadId}`);
    await tx.execute(sql`UPDATE bb_boards SET post_count = post_count + 1, last_post_at = NOW(), updated_at = NOW() WHERE id = ${thread.board_id}`);

    const potClaimedCredits = await tryClaimPot(tx, input.threadId, post.id, input.authorId);

    return { post, potClaimedCredits };
  });
}

// ---------------------------------------------------------------------------
// Edit / delete / lock / pin
// ---------------------------------------------------------------------------

export async function updatePostBody(postId: string, body: string, contentFormat: ContentFormat): Promise<PostRow> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    UPDATE bb_posts SET body = ${body.trim()}, content_format = ${contentFormat}, edited_at = NOW(), updated_at = NOW()
    WHERE id = ${postId} AND deleted_at IS NULL RETURNING *
  `);
  if (!rows[0]) throw notFound("Post not found");
  return rows[0] as unknown as PostRow;
}

export async function deletePost(postId: string): Promise<void> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    UPDATE bb_posts SET status = 'removed', deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${postId} AND deleted_at IS NULL RETURNING thread_id, is_op
  `);
  const post = rows[0] as unknown as { thread_id: string; is_op: boolean } | undefined;
  if (!post) throw notFound("Post not found");
  if (post.is_op) {
    // Deleting the OP soft-deletes the whole thread — mirrors deleteQuestion in Answers.
    await orm.execute(sql`UPDATE bb_threads SET status = 'removed', deleted_at = NOW(), updated_at = NOW() WHERE id = ${post.thread_id}`);
  } else {
    await orm.execute(sql`UPDATE bb_threads SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ${post.thread_id}`);
  }
}

export async function updateThreadTitle(threadId: string, title: string): Promise<ThreadRow> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    UPDATE bb_threads SET title = ${title.trim()}, edited_at = NOW(), updated_at = NOW() WHERE id = ${threadId} AND deleted_at IS NULL RETURNING *
  `);
  if (!rows[0]) throw notFound("Thread not found");
  return rows[0] as unknown as ThreadRow;
}

export async function setThreadLocked(threadId: string, locked: boolean): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`UPDATE bb_threads SET is_locked = ${locked}, updated_at = NOW() WHERE id = ${threadId} AND deleted_at IS NULL`);
  if (!result.rowCount) throw notFound("Thread not found");
}

export async function setThreadPinned(threadId: string, pinned: boolean): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`UPDATE bb_threads SET is_pinned = ${pinned}, updated_at = NOW() WHERE id = ${threadId} AND deleted_at IS NULL`);
  if (!result.rowCount) throw notFound("Thread not found");
}

// ---------------------------------------------------------------------------
// Reactions (toggle — one emoji per user per post)
// ---------------------------------------------------------------------------

export async function toggleReaction(postId: string, userId: string, emoji: string): Promise<{ reactionCount: number; myReaction: string | null }> {
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const { rows: postRows } = await tx.execute(sql`SELECT id FROM bb_posts WHERE id = ${postId} AND deleted_at IS NULL FOR UPDATE`);
    if (!postRows[0]) throw notFound("Post not found");

    const { rows: existingRows } = await tx.execute(sql`SELECT emoji FROM bb_post_reactions WHERE post_id = ${postId} AND user_id = ${userId} FOR UPDATE`);
    const existing = (existingRows[0] as unknown as { emoji: string } | undefined)?.emoji ?? null;

    let delta = 0;
    let myReaction: string | null;
    if (existing === emoji) {
      await tx.execute(sql`DELETE FROM bb_post_reactions WHERE post_id = ${postId} AND user_id = ${userId}`);
      delta = -1;
      myReaction = null;
    } else if (existing === null) {
      await tx.execute(sql`INSERT INTO bb_post_reactions (post_id, user_id, emoji) VALUES (${postId}, ${userId}, ${emoji})`);
      delta = 1;
      myReaction = emoji;
    } else {
      await tx.execute(sql`UPDATE bb_post_reactions SET emoji = ${emoji}, created_at = NOW() WHERE post_id = ${postId} AND user_id = ${userId}`);
      myReaction = emoji;
    }

    const { rows: updated } = await tx.execute(sql`
      UPDATE bb_posts SET reaction_count = GREATEST(reaction_count + ${delta}, 0) WHERE id = ${postId} RETURNING reaction_count
    `);

    return { reactionCount: (updated[0] as unknown as { reaction_count: number }).reaction_count, myReaction };
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
  tx: DbOrTx,
  threadId: string,
  postId: string,
  userId: string
): Promise<number> {
  const { rows: threadRows } = await tx.execute(sql`
    SELECT pot_per_claim_credits, pot_max_claims, pot_claims_count, author_id
    FROM bb_threads WHERE id = ${threadId} FOR UPDATE
  `);
  const thread = threadRows[0] as unknown as {
    pot_per_claim_credits: number;
    pot_max_claims: number;
    pot_claims_count: number;
    author_id: string;
  } | undefined;
  if (!thread) return 0;
  if (thread.author_id === userId) return 0; // OP can't claim their own pot
  if (thread.pot_max_claims <= 0 || thread.pot_claims_count >= thread.pot_max_claims) return 0;

  const result = await tx.execute(sql`
    INSERT INTO bb_pot_claims (thread_id, post_id, user_id, amount_credits) VALUES (${threadId}, ${postId}, ${userId}, ${thread.pot_per_claim_credits})
    ON CONFLICT (thread_id, user_id) DO NOTHING
  `);
  if (!result.rowCount) return 0; // already claimed

  await tx.execute(sql`UPDATE bb_threads SET pot_claims_count = pot_claims_count + 1 WHERE id = ${threadId}`);
  return thread.pot_per_claim_credits;
}

/** Threads whose pot has unclaimed credits and has gone quiet — candidates for auto-refund. */
export interface ExpiredPotRow {
  id: string;
  author_id: string;
  pot_total_credits: number;
  pot_per_claim_credits: number;
  pot_claims_count: number;
}

export async function listExpiredUnclaimedPots(inactivityDays: number): Promise<ExpiredPotRow[]> {
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    SELECT id, author_id, pot_total_credits, pot_per_claim_credits, pot_claims_count
    FROM bb_threads
    WHERE deleted_at IS NULL AND pot_refunded_at IS NULL
      AND pot_total_credits > (pot_per_claim_credits * pot_claims_count)
      AND last_reply_at < NOW() - (${inactivityDays} * INTERVAL '1 day')
  `);
  return rows as unknown as ExpiredPotRow[];
}

export async function markPotRefunded(threadId: string): Promise<void> {
  const orm = await getDb();
  await orm.execute(sql`UPDATE bb_threads SET pot_refunded_at = NOW() WHERE id = ${threadId}`);
}
