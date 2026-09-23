/**
 * app/(app)/polls/[id]/page.tsx
 *
 * Id-based redirect shim for poll deep links.
 *
 * The canonical, crawlable poll URL is /poll/<slug> (app/poll/[slug]/page.tsx),
 * but Home Feed items only carry a content id (see lib/feed/types.ts
 * FeedItem.contentId) — the feed aggregator's candidate queries don't select
 * slugs. Rather than widen those queries (and every other consumer of
 * deepLinkPathFor), this route does one cheap id -> slug lookup and forwards
 * to the real page so "/polls/<id>" (see lib/feed/deeplink.ts) always lands
 * on working content. Mirrors app/(app)/blog-posts/[id]/page.tsx.
 */

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function PollRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows } = await db.query<{ slug: string }>(
    `SELECT slug FROM polls WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );

  const row = rows[0];
  if (!row) notFound();

  redirect(`/poll/${row.slug}`);
}
