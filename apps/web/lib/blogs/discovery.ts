import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/drizzle';
import { badRequest } from '@/lib/api/errors';
import type { BlogTab } from './repo';

const cursorSchema = z.object({ score: z.string().max(100), id: z.string().uuid(), seed: z.string().uuid(), tab: z.enum(['popular','trending','new','random','subscribed']), at: z.string().datetime() });
/** Public metadata only: no article body or saved, unpublished revision can enter discovery. */
export async function discoverBlogPosts(userId: string, tab: BlogTab, cursor?: string, search?: string) {
  let after: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try { after = cursorSchema.parse(JSON.parse(cursor)); } catch { throw badRequest('Invalid discovery cursor.'); }
    if (after.tab !== tab) throw badRequest('Cursor belongs to another tab.');
  }
  const seed = after?.seed ?? randomUUID();
  const at = after?.at ?? new Date().toISOString();
  if (after && !(tab === 'random' ? /^[0-9a-f]{32}$/.test(after.score) : /^-?[0-9]+(?:\.[0-9]+)?$/.test(after.score))) throw badRequest('Invalid discovery score.');
  // Trending ranks recent engagement above old totals; random uses a stable seed across pages.
  const score = tab === 'random' ? sql`md5(${seed} || p.id::text)`
    : tab === 'popular' ? sql`(p.view_count::bigint + p.like_count::bigint * 5)::numeric`
    : tab === 'trending' ? sql`((p.view_count::numeric + p.like_count::numeric * 5) / greatest(1, extract(epoch FROM (${at}::timestamptz - p.published_at)) / 86400 + 1))`
    : sql`extract(epoch FROM p.published_at)`;
  const cast = tab === 'random' ? sql`text` : sql`numeric`;
  const orm = await getDb();
  const result = await orm.execute<{
    id: string; slug: string; title: string; excerpt: string | null; featured_image_url: string | null;
    blog_slug: string; blog_title: string; is_paywalled: boolean; score: string;
  } & Record<string, unknown>>(sql`
    WITH candidates AS (
      SELECT p.id, p.slug, p.title, p.excerpt, p.featured_image_url, p.is_paywalled,
             b.slug AS blog_slug, b.title AS blog_title, ${score} AS score
      FROM blog_posts p JOIN blogs b ON b.id=p.blog_id
      WHERE p.status='published' AND p.type='article' AND p.deleted_at IS NULL AND p.published_at IS NOT NULL
        AND b.status='active' AND b.deleted_at IS NULL AND p.published_at <= ${at}::timestamptz
        ${tab === 'subscribed' ? sql`AND EXISTS(SELECT 1 FROM blog_subscriptions s WHERE s.blog_id=b.id AND s.user_id=${userId})` : sql``}
        ${search?.trim() ? sql`AND (p.title ILIKE ${'%' + search.trim() + '%'} OR b.title ILIKE ${'%' + search.trim() + '%'})` : sql``}
    ) SELECT *, score::text AS score FROM candidates
    ${after ? sql`WHERE (score,id) < (${after.score}::${cast},${after.id}::uuid)` : sql``}
    ORDER BY candidates.score DESC,candidates.id DESC LIMIT 7
  `);
  const items = result.rows.slice(0,6).map(({ score: _score, ...item }) => item);
  const last = result.rows.slice(0,6).at(-1);
  return { posts: items, hasMore: result.rows.length > 6, nextCursor: result.rows.length > 6 && last ? JSON.stringify({ score: last.score, id: last.id, seed, tab, at }) : null };
}
