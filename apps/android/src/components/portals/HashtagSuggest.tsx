/**
 * apps/android/src/components/portals/HashtagSuggest.tsx
 *
 * Mirrors apps/web/components/portals/HashtagSuggest.tsx: composer tag
 * autocomplete chips under the textarea (debounced, memoised per fragment).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { activeHashtagQuery, applyHashtagSuggestion } from '@zobia/shared/utils';

interface Suggestion {
  slug: string;
  useCount: number;
  hasPortal: boolean;
}

const cache = new Map<string, Suggestion[]>();

export function HashtagSuggest({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const query = activeHashtagQuery(value);
  const [items, setItems] = useState<Suggestion[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    if (query === null) {
      setItems([]);
      return;
    }
    const hit = cache.get(query);
    if (hit) {
      setItems(hit);
      return;
    }
    const id = ++reqId.current;
    const h = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<{ hashtags: Suggestion[] }>(`/public/hashtags/search?q=${encodeURIComponent(query)}&limit=6`);
        const list = data?.hashtags ?? [];
        cache.set(query, list);
        if (id === reqId.current) setItems(list);
      } catch {
        /* suggestions are a nicety — ignore network errors */
      }
    }, 200);
    return () => clearTimeout(h);
  }, [query]);

  if (query === null || items.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="listbox" aria-label={t('portals.suggestTags')}>
      {items.map((s) => (
        <button
          key={s.slug}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onChange(applyHashtagSuggestion(value, s.slug))}
          className="rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200"
        >
          #{s.slug}
          {s.hasPortal && <span className="ml-1 text-[10px] text-neutral-400">{t('portals.portalTag')}</span>}
        </button>
      ))}
    </div>
  );
}
