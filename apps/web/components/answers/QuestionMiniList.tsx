/**
 * components/answers/QuestionMiniList.tsx
 *
 * Compact mini-link list used for "Related posts" / "New posts" /
 * "Recently answered" sections on question detail pages, plus a "See more"
 * link to a full dedicated listing. Server-safe (no client state) so it can
 * be used from both the public SSR pages and the authenticated client pages.
 */

import Link from "next/link";

export interface QuestionMiniListItem {
  id: string;
  slug: string | null;
  title: string;
  answerCount: number;
}

export function QuestionMiniList({
  title,
  items,
  seeMoreHref,
  linkPrefix = "/a",
}: {
  title: string;
  items: QuestionMiniListItem[];
  seeMoreHref: string;
  /** "/a" for the public SEO route, "/answers" for the authenticated in-app route. */
  linkPrefix?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((q) => (
          <li key={q.id}>
            <Link href={`${linkPrefix}/${q.slug ?? q.id}`} className="block truncate text-sm text-neutral-600 hover:text-primary-600 hover:underline dark:text-neutral-400 dark:hover:text-primary-400">
              {q.title}
              <span className="ml-1.5 text-xs text-neutral-400">({q.answerCount})</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={seeMoreHref} className="mt-2 inline-block text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400">
        See more →
      </Link>
    </div>
  );
}
