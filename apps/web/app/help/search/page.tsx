/**
 * app/help/search/page.tsx
 *
 * Help Center search results (?q=...). Public, server-rendered.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { searchDocs } from "@/lib/help/service";
import { HelpSearchBox } from "@/components/help/HelpSearchBox";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `"${q}" — Help Center Search — Zobia Social` : "Search — Help Center — Zobia Social" };
}

export default async function HelpSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const results = q ? await searchDocs(q).catch(() => []) : [];

  return (
    <main id="main-content" className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/help" className="text-sm text-primary underline">&larr; Help Center</Link>
        <h1 className="mt-2 mb-6 text-2xl font-bold">Search results{q ? ` for "${q}"` : ""}</h1>

        <HelpSearchBox />

        <div className="mt-8 space-y-3">
          {q && results.length === 0 && <p className="text-sm text-muted-foreground">No results found. Try a different search, or ask the AI on any doc page.</p>}
          {results.map((r) => (
            <Link key={r.id} href={`/help/${r.category_slug}/${r.slug}`} className="block rounded-lg border border-border p-4 hover:border-primary hover:bg-muted/50">
              <p className="font-medium">{r.title}</p>
              {/* eslint-disable-next-line react/no-danger */}
              <p className="mt-1 text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
