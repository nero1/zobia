/**
 * apps/android/src/components/wiki/WikiCard.tsx
 *
 * Discovery grid card — mirrors the inline card markup blogs/index.tsx uses
 * for its own grid (same emoji-avatar-tile + 2-col grid convention as the
 * Blogs discovery screen), pulled out to a component since Wiki needs the
 * identical card in two places (discovery list + "My Wikis").
 */

import { Link } from '@tanstack/react-router';
import type { WikiSummary } from '@/lib/wiki/api';

export function WikiCard({ wiki }: { wiki: WikiSummary }) {
  return (
    <Link
      to="/wiki/$slug"
      params={{ slug: wiki.slug }}
      className="block bg-white rounded-xl p-4 shadow-card active:scale-95 transition-transform"
    >
      <div className="flex items-center justify-center h-16 rounded-xl bg-neutral-100 text-3xl mb-2 overflow-hidden">
        {wiki.avatar_url ? (
          <img src={wiki.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          '📖'
        )}
      </div>
      <p className="font-semibold text-neutral-900 text-sm truncate">{wiki.name}</p>
      {wiki.description && <p className="text-neutral-500 text-xs mt-0.5 truncate">{wiki.description}</p>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-xs text-neutral-400">{wiki.page_count} pages</span>
        <span className="text-xs text-neutral-400">{wiki.contributor_count} contributors</span>
      </div>
    </Link>
  );
}

export function WikiCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-4 shadow-card animate-pulse">
      <div className="w-full h-16 rounded-xl bg-neutral-200 mb-3" />
      <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-neutral-100 rounded w-1/2" />
    </div>
  );
}
