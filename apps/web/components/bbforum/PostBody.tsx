/**
 * components/bbforum/PostBody.tsx
 *
 * Renders an already-sanitized HTML string (produced server-side by
 * lib/security/htmlSanitizer.sanitizeForumPostContent) for a thread/post
 * body. Kept as its own component so the dangerouslySetInnerHTML boundary is
 * obvious and isolated — callers must never pass raw/unsanitized content.
 */

export function PostBody({ html }: { html: string }) {
  return (
    <div
      className="prose prose-sm max-w-none text-neutral-800 dark:prose-invert dark:text-neutral-200 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
