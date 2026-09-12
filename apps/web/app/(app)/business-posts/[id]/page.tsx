/**
 * app/(app)/business-posts/[id]/page.tsx
 *
 * Id-based redirect shim for business page post deep links — mirrors
 * app/(app)/blog-posts/[id]/page.tsx. There is no standalone post-detail
 * page yet (business_page_posts render inline on the business page itself,
 * app/(app)/business/pages/[pageId]/page.tsx), so this forwards to that
 * page with a `post` query param the page can use to scroll to / highlight
 * the post once that lands; until then it's a best-effort landing on the
 * right business page rather than a 404.
 */

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function BusinessPostRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows } = await db.query<{ page_id: string }>(
    `SELECT bp.id AS page_id
     FROM business_page_posts p
     JOIN business_pages bp ON bp.id = p.page_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND bp.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );

  const row = rows[0];
  if (!row) notFound();

  redirect(`/business/pages/${row.page_id}?post=${id}`);
}
