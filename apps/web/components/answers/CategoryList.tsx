"use client";

/**
 * components/answers/CategoryList.tsx
 *
 * Reusable category list for the Answers feature — "horizontal" wraps
 * multiple pill/chip items per line, "vertical" is one per line. Both show
 * the icon, name, and question count in parens; clicking navigates to that
 * category's dedicated page (used for SEO — see app/answers/category/[slug]).
 */

import Link from "next/link";

export interface CategoryListItem {
  slug: string;
  name: string;
  iconEmoji: string;
  questionCount: number;
}

export function CategoryList({ categories, layout = "horizontal" }: { categories: CategoryListItem[]; layout?: "horizontal" | "vertical" }) {
  if (categories.length === 0) return null;

  return (
    <div className={layout === "horizontal" ? "flex flex-wrap gap-x-4 gap-y-2" : "flex flex-col gap-1.5"}>
      {categories.map((c) => (
        <Link
          key={c.slug}
          href={`/answers/category/${c.slug}`}
          className={
            layout === "horizontal"
              ? "inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
              : "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }
        >
          <span>{c.iconEmoji}</span>
          <span className="font-medium">{c.name}</span>
          <span className="text-neutral-400">({c.questionCount.toLocaleString()})</span>
        </Link>
      ))}
    </div>
  );
}
