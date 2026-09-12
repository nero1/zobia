/**
 * app/(app)/forum-threads/[id]/page.tsx
 *
 * Id-based redirect shim for bb-forum thread deep links — mirrors
 * app/(app)/blog-posts/[id]/page.tsx. The canonical thread URL is
 * /f/<slug> (app/f/[slug]/page.tsx); Home Feed items only carry
 * bb_threads.id, so this does one id -> slug lookup and forwards.
 */

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function ForumThreadRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows } = await db.query<{ slug: string }>(
    `SELECT slug FROM bb_threads WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );

  const row = rows[0];
  if (!row) notFound();

  redirect(`/f/${row.slug}`);
}
