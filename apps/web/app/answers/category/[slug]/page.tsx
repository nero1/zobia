/**
 * app/answers/category/[slug]/page.tsx
 *
 * Public, SSR, crawlable Answers category page — Latest/New/Trending/Popular
 * for one category only. Tab state lives in the `?tab=` query param so every
 * tab is its own indexable, bookmarkable URL and needs no client JS.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPublicCategory,
  listAllCategoriesPublic,
  listPublicQuestionsByCategory,
  type PublicCategoryTab,
} from "@/lib/forum/repo";
import { CategoryList } from "@/components/answers/CategoryList";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
const TABS: { key: PublicCategoryTab; label: string }[] = [
  { key: "latest", label: "Latest" },
  { key: "new", label: "New" },
  { key: "trending", label: "Trending" },
  { key: "popular", label: "Popular" },
];

function isValidTab(v: string | undefined): v is PublicCategoryTab {
  return !!v && TABS.some((t) => t.key === v);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getPublicCategory(slug);
  if (!category) return { title: "Category not found — Zobia Answers" };
  return {
    title: `${category.name} Questions — Zobia Answers`,
    description: category.description ?? `Browse ${category.name} questions and answers on Zobia.`,
    alternates: { canonical: `${APP_URL}/answers/category/${category.slug}` },
    openGraph: { title: `${category.name} — Zobia Answers`, description: category.description ?? undefined, url: `${APP_URL}/answers/category/${category.slug}`, type: "website" },
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AnswersCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: PublicCategoryTab = isValidTab(rawTab) ? rawTab : "latest";

  const [category, allCategories] = await Promise.all([getPublicCategory(slug), listAllCategoriesPublic()]);
  if (!category) notFound();

  const questions = await listPublicQuestionsByCategory(category.id, tab, 15);

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${category.name} Questions`,
    url: `${APP_URL}/answers/category/${category.slug}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: questions.map((q, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${APP_URL}/a/${q.slug ?? q.id}`,
        name: q.title,
      })),
    },
  });

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/answers" className="hover:underline">Answers</Link>
        <span>/</span>
        <span className="text-neutral-900 dark:text-neutral-100">{category.name}</span>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        <span className="mr-1.5">{category.iconEmoji}</span>{category.name}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">{category.description} · {category.questionCount} questions</p>

      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/answers/category/${category.slug}?tab=${t.key}`}
            className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold transition-colors ${
              tab === t.key ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-neutral-400">No questions in this category yet.</p>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <Link key={q.id} href={`/a/${q.slug ?? q.id}`} className="block rounded-xl border border-neutral-200 bg-white p-3 hover:border-primary-300 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{q.title}</p>
              <p className="mt-1 text-xs text-neutral-400">@{q.authorUsername ?? "unknown"} · {q.answerCount} answers · {q.voteScore} votes · {timeAgo(q.createdAt)}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Other categories</h2>
        <CategoryList categories={allCategories.filter((c) => c.slug !== category.slug)} layout="horizontal" />
      </div>
    </div>
  );
}
