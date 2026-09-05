/**
 * apps/android/src/components/blogs/BlogOwnerToolbar.tsx
 *
 * Owner/staff-only strip on the blog home + post screens — mirrors
 * apps/web's BlogOwnerToolbar.tsx. `visible` (isOwner || staff) is resolved
 * by the caller from the /blogs/:slug (or post-detail) response's isOwner
 * field plus the signed-in user's is_admin/is_moderator claims.
 *
 * No separate "Preview" toggle on Android: GET /blogs/:slug/posts/:postSlug
 * already returns a draft post's full body to its author/a moderator (see
 * app/api/blogs/[slug]/posts/[postSlug]/route.ts) — the post screen just
 * fetches by slug as normal and shows the `isDraft` banner below when the
 * result is unpublished, rather than needing a `?preview=1` round-trip like
 * the SSR web page does.
 */

import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function BlogOwnerToolbar({ blogSlug, isDraft }: { blogSlug: string; isDraft?: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <span className="font-semibold text-amber-700">
        {isDraft ? t('blogs.ownerToolbar.previewOn', 'Previewing draft') : t('blogs.ownerToolbar.badge', 'Owner view')}
      </span>
      <Link to="/blogs" className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-medium text-neutral-700">
        {t('blogs.ownerToolbar.myBlogs', 'My Blogs')}
      </Link>
      <Link to="/blogs/$slug/manage" params={{ slug: blogSlug }} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-medium text-neutral-700">
        {t('blogs.ownerToolbar.manage', 'Manage blog')}
      </Link>
    </div>
  );
}
