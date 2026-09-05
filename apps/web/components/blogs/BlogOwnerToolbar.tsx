/**
 * components/blogs/BlogOwnerToolbar.tsx
 *
 * Owner/staff-only toolbar shown on the public blog pages (/b/<slug> and
 * /b/<slug>/<postSlug>) — invisible to regular visitors. Structurally
 * separate from BlogMenu (the visitor-facing hamburger menu) even though
 * both live inside the same <BlogNavBar>.
 *
 * Rendered only when the SSR page has already resolved (server-side, via
 * lib/auth/serverUser.ts) that the current viewer is the blog's owner or a
 * site admin/mod — a regular visitor's HTML never contains this markup.
 *
 * A plain server component, not a client component: no interactivity of its
 * own beyond plain links. Kept hardcoded-English per this directory's
 * existing convention for the SSR public /b/<slug> pages (no i18n context
 * there) — see components/blogs/PostBody.tsx's own note on this.
 */

import Link from "next/link";

export function BlogOwnerToolbar({
  blogSlug,
  previewHref,
  previewActive,
}: {
  blogSlug: string;
  /** Present only on the post page, for a draft post — toggles ?preview=1. */
  previewHref?: string | null;
  previewActive?: boolean;
}) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-950/10 px-3 py-2 text-xs"
      data-testid="blog-owner-toolbar"
    >
      <span className="font-semibold text-amber-500">Owner view</span>
      <Link href="/blogs/dashboard" className="rounded-lg bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-200 hover:bg-neutral-700">
        My Blogs
      </Link>
      {previewHref && (
        <Link
          href={previewHref}
          className={`rounded-lg px-2.5 py-1.5 font-medium ${previewActive ? "bg-primary text-primary-foreground" : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"}`}
        >
          {previewActive ? "Previewing draft" : "Preview"}
        </Link>
      )}
      <Link href={`/blogs/dashboard/settings?blog=${encodeURIComponent(blogSlug)}`} className="rounded-lg bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-200 hover:bg-neutral-700">
        Blog config
      </Link>
      <Link href={`/blogs/dashboard?blog=${encodeURIComponent(blogSlug)}`} className="rounded-lg bg-neutral-800 px-2.5 py-1.5 font-medium text-neutral-200 hover:bg-neutral-700">
        Post management
      </Link>
    </div>
  );
}
