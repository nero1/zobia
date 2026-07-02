"use client";

/**
 * app/(app)/blogs/dashboard/page.tsx
 *
 * Creator dashboard hub: manage articles/pages, with quick links to
 * comments moderation, stats, and settings.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  post_count: number;
  subscriber_count: number;
}

interface PostRow {
  id: string;
  slug: string;
  type: string;
  title: string;
  status: string;
  is_paywalled: boolean;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
}

type TypeTab = "article" | "page";
type StatusTab = "published" | "draft";

export default function BlogDashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [blog, setBlog] = useState<BlogRow | null | undefined>(undefined);
  const [type, setType] = useState<TypeTab>("article");
  const [status, setStatus] = useState<StatusTab>("published");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const b = json?.data?.blog;
        if (!b) { router.replace("/blogs/new"); return; }
        setBlog(b);
      })
      .catch(() => setBlog(null));
  }, [router]);

  const fetchPosts = useCallback(async () => {
    if (!blog) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ type, status, limit: "50" });
      const res = await fetch(`/api/blogs/${blog.slug}/posts?${p.toString()}`, { credentials: "include" });
      const json = await res.json();
      setPosts(json?.data?.posts ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [blog, type, status]);

  useEffect(() => { void fetchPosts(); }, [fetchPosts]);

  async function handleDelete(postSlug: string) {
    if (!blog) return;
    if (!confirm(t("blogs.dashboard.confirmDelete", "Delete this post?"))) return;
    await fetch(`/api/blogs/${blog.slug}/posts/${postSlug}`, { method: "DELETE", credentials: "include" });
    void fetchPosts();
  }

  if (blog === undefined) return <div className="mx-auto max-w-4xl px-4 py-8 text-muted-foreground">{t("blogs.loading", "Loading…")}</div>;
  if (!blog) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{blog.title}</h1>
          <Link href={`/b/${blog.slug}`} className="text-xs text-primary hover:underline">zobia.org/b/{blog.slug} ↗</Link>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/blogs/dashboard/posts/new?type=${type}`} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
            {t("blogs.dashboard.newPost", "+ New")}
          </Link>
          <Link href="/blogs/dashboard/comments" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.comments", "Comments")}
          </Link>
          <Link href="/blogs/dashboard/stats" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.stats", "Stats")}
          </Link>
          <Link href="/blogs/dashboard/settings" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.settings", "Settings")}
          </Link>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-neutral-900/50 p-1 w-fit">
        {(["article", "page"] as TypeTab[]).map((tKey) => (
          <button key={tKey} onClick={() => setType(tKey)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${type === tKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {tKey === "article" ? t("blogs.type.article", "Articles") : t("blogs.type.page", "Pages")}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-neutral-900/50 p-1 w-fit">
        {(["published", "draft"] as StatusTab[]).map((sKey) => (
          <button key={sKey} onClick={() => setStatus(sKey)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${status === sKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {sKey === "published" ? t("blogs.status.published", "Published") : t("blogs.status.draft", "Drafts")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">{t("blogs.dashboard.empty", "Nothing here yet.")}</div>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground text-sm truncate">{p.title}</span>
                  {p.is_paywalled && <span className="text-[10px] rounded-full bg-amber-950/40 text-amber-400 px-1.5 py-0.5">🔒 paywalled</span>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {p.view_count} views · {p.like_count} likes · {p.comment_count} comments
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Link href={`/blogs/dashboard/posts/${p.slug}/edit`} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
                  {t("blogs.dashboard.edit", "Edit")}
                </Link>
                <button onClick={() => handleDelete(p.slug)} className="rounded-lg bg-red-950/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-950/70">
                  {t("blogs.dashboard.delete", "Delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
