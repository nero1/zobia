/**
 * apps/android/src/components/portals/HashtagText.tsx
 *
 * Mirrors apps/web/components/portals/HashtagText.tsx: renders user text with
 * `#tags` as links to their Portal (/h/<slug>), using the shared tokenizer so
 * all clients agree on what a hashtag is. React nodes only (no innerHTML).
 * Use `plain` inside another link to avoid nested anchors.
 */

import { Link } from '@tanstack/react-router';
import { splitHashtags } from '@zobia/shared/utils';

interface HashtagTextProps {
  text: string | null | undefined;
  className?: string;
  plain?: boolean;
}

export function HashtagText({ text, className, plain }: HashtagTextProps) {
  if (!text) return null;
  return (
    <span className={className}>
      {splitHashtags(text).map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.value}</span>;
        if (plain) {
          return (
            <span key={i} className="font-medium text-primary-600 dark:text-primary-400">
              {seg.value}
            </span>
          );
        }
        return (
          <Link
            key={i}
            to="/h/$slug"
            params={{ slug: seg.slug }}
            className="font-medium text-primary-600 dark:text-primary-400"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.value}
          </Link>
        );
      })}
    </span>
  );
}
