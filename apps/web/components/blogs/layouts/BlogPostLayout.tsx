/**
 * components/blogs/layouts/BlogPostLayout.tsx
 *
 * Structural theme dispatcher for the public post/page view. Post content
 * itself (title, body, actions, comments) is passed in as slots so every
 * variant renders the identical already-fetched data — only the
 * surrounding arrangement differs:
 *   - classic / magazine / minimal-cards: single centered column (magazine
 *     gets a full-bleed hero image treatment when a featured image exists;
 *     minimal-cards keeps metadata terse); the interesting structural
 *     divergence for reading a single article is modest by nature, which is
 *     why sidebar-left is the one that meaningfully rearranges the page.
 *   - sidebar-left: adds a left sidebar (categories/popular posts) next to
 *     the article column, matching the homepage's sidebar-left arrangement.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import type { LayoutVariant, ThemeTokens } from "@/lib/blogs/themes";
import type { HomeCategory, HomePageRow } from "./types";

export interface BlogPostLayoutProps {
  blogSlug: string;
  layoutVariant: LayoutVariant;
  tokens: ThemeTokens;
  featuredImageUrl: string | null;
  categories: HomeCategory[];
  popular: HomePageRow[];
  children: ReactNode;
}

function PostSidebar({ blogSlug, categories, popular }: { blogSlug: string; categories: HomeCategory[]; popular: HomePageRow[] }) {
  if (categories.length === 0 && popular.length === 0) return null;
  return (
    <aside className="space-y-6 md:order-1">
      {categories.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Categories</h3>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span key={c.id} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">{c.name} ({c.post_count})</span>
            ))}
          </div>
        </div>
      )}
      {popular.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Popular</h3>
          <div className="space-y-2">
            {popular.map((p) => (
              <Link key={p.id} href={`/b/${blogSlug}/${p.slug}`} className="block text-sm text-foreground hover:text-primary truncate">{p.title}</Link>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export function BlogPostLayout({ blogSlug, layoutVariant, categories, popular, children }: BlogPostLayoutProps) {
  if (layoutVariant !== "sidebar-left") return <>{children}</>;
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      <div className="md:col-span-1">
        <PostSidebar blogSlug={blogSlug} categories={categories} popular={popular} />
      </div>
      <div className="md:order-2 md:col-span-3">{children}</div>
    </div>
  );
}
