"use client";

/**
 * components/portals/HashtagSuggest.tsx
 *
 * Composer autocomplete: while the text ends in a `#fragment`, shows matching
 * tags (GET /api/public/hashtags/search) as tappable chips under the textarea;
 * tapping one completes the fragment. Suggestions are memoised per fragment
 * for the session so typing/backspacing never repeats a request, and the
 * network call is debounced.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeHashtagQuery, applyHashtagSuggestion } from "@zobia/shared/utils";

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
        const res = await fetch(`/api/public/hashtags/search?q=${encodeURIComponent(query)}&limit=6`);
        if (!res.ok) return;
        const json = (await res.json()) as { data?: { hashtags: Suggestion[] } };
        const list = json.data?.hashtags ?? [];
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
    <div className="mt-2 flex flex-wrap gap-1.5" role="listbox" aria-label={t("portals.suggestTags")}>
      {items.map((s) => (
        <button
          key={s.slug}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onChange(applyHashtagSuggestion(value, s.slug))}
          className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:border-primary hover:text-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          #{s.slug}
          {s.hasPortal && <span className="ml-1 text-[10px] text-neutral-400">{t("portals.portalTag")}</span>}
        </button>
      ))}
    </div>
  );
}
