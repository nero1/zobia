import { getDb } from "@/lib/db/drizzle";
import { sql } from "drizzle-orm";
import type { FeedPage } from "./types";
type Item = FeedPage["items"][number];
/** Reauthorize cached IDs at delivery; cache age never grants visibility. */
export async function visibleFeedItems<T extends Item>(
  items: T[],
  viewer: string | null,
): Promise<T[]> {
  if (!items.length) return items;
  const db = await getDb();
  const result = await db.execute<{
    kind: string;
    id: string;
    paywalled: boolean;
  }>(sql`
    SELECT f.kind,f.id,
      CASE WHEN f.kind='blog_post' THEN EXISTS(SELECT 1 FROM blog_posts WHERE id=f.id::uuid AND is_paywalled=true) ELSE false END paywalled
    FROM jsonb_to_recordset(${JSON.stringify(items.map((i) => ({ kind: i.contentType, id: i.contentId, author: i.authorId })))}::jsonb) AS f(kind text,id text,author text)
    WHERE (f.author IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.id=f.author::uuid AND u.deleted_at IS NULL AND NOT u.is_banned
      AND NOT (u.is_suspended AND (u.suspended_until IS NULL OR u.suspended_until>NOW()))
      AND (NOT u.profile_private OR u.id=${viewer}::uuid OR EXISTS(SELECT 1 FROM friendships fr WHERE fr.status='accepted' AND ((fr.requester_id=u.id AND fr.addressee_id=${viewer}::uuid) OR (fr.addressee_id=u.id AND fr.requester_id=${viewer}::uuid))))))
    AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=${viewer}::uuid AND b.blocked_id=f.author::uuid) OR (b.blocked_id=${viewer}::uuid AND b.blocker_id=f.author::uuid))
    AND CASE f.kind
      WHEN 'moment' THEN EXISTS(SELECT 1 FROM moments WHERE id=f.id::uuid AND expires_at>NOW())
      WHEN 'tweet' THEN EXISTS(SELECT 1 FROM tweets WHERE id=f.id::uuid AND deleted_at IS NULL)
      WHEN 'blog_post' THEN EXISTS(SELECT 1 FROM blog_posts p JOIN blogs b ON b.id=p.blog_id WHERE p.id=f.id::uuid AND p.deleted_at IS NULL AND p.status='published' AND b.deleted_at IS NULL AND b.status='active')
      WHEN 'forum_thread' THEN EXISTS(SELECT 1 FROM bb_threads t JOIN bb_boards b ON b.id=t.board_id WHERE t.id=f.id::uuid AND t.deleted_at IS NULL AND t.status='visible' AND b.is_active)
      WHEN 'forum_question' THEN EXISTS(SELECT 1 FROM forum_questions WHERE id=f.id::uuid AND deleted_at IS NULL AND status='visible')
      WHEN 'room' THEN EXISTS(SELECT 1 FROM rooms WHERE id=f.id::uuid AND deleted_at IS NULL AND status='active' AND is_public AND is_active AND NOT is_banned AND NOT is_suspended)
      WHEN 'classroom' THEN EXISTS(SELECT 1 FROM rooms WHERE id=f.id::uuid AND deleted_at IS NULL AND status='active' AND is_public AND is_active AND NOT is_banned AND NOT is_suspended)
      WHEN 'wiki_page' THEN EXISTS(SELECT 1 FROM wiki_pages p JOIN wikis w ON w.id=p.wiki_id WHERE p.id=f.id::uuid AND p.deleted_at IS NULL AND p.status='published' AND w.deleted_at IS NULL AND w.status='active')
      WHEN 'game' THEN EXISTS(SELECT 1 FROM games WHERE id=f.id::uuid AND deleted_at IS NULL AND is_active AND is_public)
      WHEN 'poll' THEN EXISTS(SELECT 1 FROM polls WHERE id=f.id::uuid AND deleted_at IS NULL AND status='active')
      WHEN 'quiz' THEN EXISTS(SELECT 1 FROM quizzes WHERE id=f.id::uuid AND deleted_at IS NULL AND status='active')
      WHEN 'business_page_post' THEN EXISTS(SELECT 1 FROM business_page_posts p JOIN business_pages b ON b.id=p.page_id JOIN business_accounts a ON a.id=b.business_account_id WHERE p.id=f.id::uuid AND p.deleted_at IS NULL AND p.status='published' AND b.deleted_at IS NULL AND b.status='active' AND a.status='active')
      ELSE false END
  `);
  const allowed = new Map(result.rows.map((r) => [`${r.kind}:${r.id}`, r]));
  return items
    .filter((i) => allowed.has(`${i.contentType}:${i.contentId}`))
    .map((i) =>
      allowed.get(`${i.contentType}:${i.contentId}`)?.paywalled
        ? { ...i, excerpt: null }
        : i,
    );
}
