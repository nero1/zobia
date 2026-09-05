/**
 * components/blogs/layouts/types.ts
 *
 * Shared prop shapes for the per-layout-variant blog home/post renderers.
 * Every variant receives the exact same already-fetched data (see
 * app/b/[slug]/page.tsx and app/b/[slug]/[postSlug]/page.tsx) — only the
 * DOM arrangement differs per components/blogs/layouts/Home*.tsx /
 * Post*.tsx.
 */

import type { ThemeTokens, LayoutVariant } from "@/lib/blogs/themes";

export interface HomeArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  featured_image_url: string | null;
  is_paywalled: boolean;
  published_at: string | null;
  category_name: string | null;
  view_count: number;
  like_count: number;
}

export interface HomePageRow {
  id: string;
  slug: string;
  title: string;
}

export interface HomeCategory {
  id: string;
  name: string;
  post_count: number;
}

export interface BlogHomeLayoutProps {
  blogSlug: string;
  blogTitle: string;
  layoutVariant: LayoutVariant;
  tokens: ThemeTokens;
  articles: HomeArticle[];
  pages: HomePageRow[];
  popular: HomePageRow[];
  categories: HomeCategory[];
}
