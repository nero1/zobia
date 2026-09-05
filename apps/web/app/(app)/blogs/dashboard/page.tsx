"use client";

/**
 * app/(app)/blogs/dashboard/page.tsx
 *
 * Creator dashboard hub: manage articles/pages, with quick links to
 * comments moderation, stats, and settings.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { withBlogParam } from "@/lib/blogs/useSelectedBlog";
import { ArticleQuotaNotice } from "@/components/blogs/ArticleQuotaNotice";

interface BlogRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  post_count: number;
  subscriber_count: number;
  business_account_id?: string | null;
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
  const searchParams = useSearchParams();
  const blogParam = searchParams.get("blog");
  const [blogs, setBlogs] = useState<BlogRow[]>([]);
  const [blog, setBlog] = useState<BlogRow | null | undefined>(undefined);
  const [type, setType] = useState<TypeTab>("article");
  const [status, setStatus] = useState<StatusTab>("published");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const list: BlogRow[] = json?.data?.blogs ?? [];
        if (list.length === 0) { router.replace("/blogs/new"); return; }
        setBlogs(list);
        if (list.length === 1) { setBlog(list[0]); return; }
        const match = blogParam ? list.find((b) => b.slug === blogParam) : undefined;
        setBlog(match ?? null); // null (not undefined) => render the picker below
      })
      .catch(() => setBlog(null));
  }, [router, blogParam]);

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
  useEffect(() => { setSelected(new Set()); }, [type, status, blog]);

  async function handleDelete(postSlug: string) {
    if (!blog) return;
    if (!confirm(t("blogs.dashboard.confirmDelete", "Delete this post?"))) return;
    await fetch(`/api/blogs/${blog.slug}/posts/${postSlug}`, { method: "DELETE", credentials: "include" });
    void fetchPosts();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === posts.length ? new Set() : new Set(posts.map((p) => p.id))));
  }

  async function handleBatch(action: "draft" | "delete") {
    if (!blog || selected.size === 0) return;
    if (action === "delete" && !confirm(t("blogs.dashboard.confirmBatchDelete", "Delete {{count}} selected post(s)? This can't be undone.", { count: selected.size }))) return;
    setBatchBusy(true);
    try {
      await fetch(`/api/blogs/${blog.slug}/posts/batch`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: Array.from(selected), action }),
      });
      setSelected(new Set());
      void fetchPosts();
    } finally {
      setBatchBusy(false);
    }
  }

  if (blog === undefined) return <div className="mx-auto max-w-4xl px-4 py-8 text-muted-foreground">{t("blogs.loading", "Loading…")}</div>;

  if (!blog) {
    // Multiple blogs and none selected (or an unknown ?blog= slug) — show the picker.
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-4">{t("blogs.dashboard.pickBlogTitle", "Your blogs")}</h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {blogs.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(withBlogParam("/blogs/dashboard", b.slug, blogs.length))}
              className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{b.title}</span>
                {b.business_account_id && (
                  <span className="text-[10px] rounded-full bg-blue-950/40 text-blue-400 px-1.5 py-0.5">{t("blogs.dashboard.businessBadge", "Business")}</span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("blogs.dashboard.pickBlogStats", "{{posts}} posts · {{subs}} subscribers", { posts: b.post_count, subs: b.subscriber_count })}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {blogs.length > 1 && (
        <Link href="/blogs/dashboard" className="mb-3 inline-block text-xs text-muted-foreground hover:text-foreground">
          ← {t("blogs.dashboard.allBlogs", "All your blogs")}
        </Link>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{blog.title}</h1>
          <Link href={`/b/${blog.slug}`} className="text-xs text-primary hover:underline">zobia.org/b/{blog.slug} ↗</Link>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={withBlogParam(`/blogs/dashboard/posts/new?type=${type}`, blog.slug, blogs.length)} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
            {t("blogs.dashboard.newPost", "+ New")}
          </Link>
          <Link href={withBlogParam("/blogs/dashboard/comments", blog.slug, blogs.length)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.comments", "Comments")}
          </Link>
          <Link href={withBlogParam("/blogs/dashboard/messages", blog.slug, blogs.length)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.messages", "Messages")}
          </Link>
          <Link href={withBlogParam("/blogs/dashboard/stats", blog.slug, blogs.length)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.stats", "Stats")}
          </Link>
          <Link href={withBlogParam("/blogs/dashboard/settings", blog.slug, blogs.length)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("blogs.dashboard.settings", "Settings")}
          </Link>
        </div>
      </div>

      <ArticleQuotaNotice blogSlug={blog.slug} />

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
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-neutral-900/40 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={selected.size > 0 && selected.size === posts.length} onChange={toggleSelectAll} />
              {selected.size > 0
                ? t("blogs.dashboard.selectedCount", "{{count}} selected", { count: selected.size })
                : t("blogs.dashboard.selectAll", "Select all")}
            </label>
            {selected.size > 0 && (
              <div className="ml-auto flex gap-2">
                <button
                  disabled={batchBusy}
                  onClick={() => handleBatch("draft")}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
                >
                  {t("blogs.dashboard.batchDraft", "Move to draft")}
                </button>
                <button
                  disabled={batchBusy}
                  onClick={() => handleBatch("delete")}
                  className="rounded-lg bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/70 disabled:opacity-50"
                >
                  {t("blogs.dashboard.batchDelete", "Delete selected")}
                </button>
              </div>
            )}
          </div>
          {posts.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <input
                type="checkbox"
                className="flex-shrink-0"
                checked={selected.has(p.id)}
                onChange={() => toggleSelected(p.id)}
                aria-label={t("blogs.dashboard.selectPost", "Select {{title}}", { title: p.title })}
              />
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
                <Link href={withBlogParam(`/blogs/dashboard/posts/${p.slug}/edit`, blog.slug, blogs.length)} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
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
