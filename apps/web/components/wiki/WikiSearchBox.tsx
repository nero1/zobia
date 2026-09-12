"use client";

/**
 * components/wiki/WikiSearchBox.tsx
 *
 * Simple GET-param-driven search box for the public /w/<slug> wiki home
 * page's page list — submits `?search=<query>` and the server component
 * re-queries lib/wiki/repo.ts's listWikiPages with that search term (no
 * client-side fetching, just a plain navigation so the search stays
 * SEO/crawlable and works without JS via the underlying <form>).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export function WikiSearchBox({ wikiSlug, initialValue }: { wikiSlug: string; initialValue: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  return (
    <form
      action={`/w/${wikiSlug}`}
      method="get"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(q ? `/w/${wikiSlug}?search=${encodeURIComponent(q)}` : `/w/${wikiSlug}`);
      }}
    >
      <input
        type="search"
        name="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("wiki.home.searchPlaceholder", "Search pages…") as string}
        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="submit"
        className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
      >
        {t("wiki.home.searchButton", "Search")}
      </button>
    </form>
  );
}
