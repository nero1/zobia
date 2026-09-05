/**
 * lib/blogs/useSelectedBlog.ts
 *
 * Shared helper for the (now multi-blog-capable, migration 0018) blog
 * dashboard: each dashboard sub-page (comments/settings/stats/posts)
 * resolves which of the caller's blogs it operates on inline (0 blogs ->
 * /blogs/new, 1 blog -> auto-select, >1 blogs -> requires ?blog=<slug>,
 * else redirect to the picker at /blogs/dashboard) — this just carries the
 * ?blog= param through dashboard links so navigating between sub-pages
 * doesn't lose the caller's blog selection.
 */

export function withBlogParam(href: string, blogSlug: string, blogCount: number): string {
  if (blogCount <= 1) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}blog=${encodeURIComponent(blogSlug)}`;
}
