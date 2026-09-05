"use client";

/**
 * app/(app)/blogs/dashboard/comments/page.tsx
 *
 * Comment management for the caller's own blog: a "Pending" queue
 * (approve/remove, shown when comments_moderation_enabled) and an "All"
 * view giving the owner full CRUD over every comment on their posts
 * (view + delete any comment, not just pending ones).
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { formatShortDate } from "@/lib/format/date";

interface PostRow {
  id: string;
  slug: string;
  title: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  body: string;
  status: string;
  created_at: string;
  author_username: string | null;
}

type Tab = "pending" | "all";

export default function BlogCommentsModerationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blogParam = searchParams.get("blog");
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [byPost, setByPost] = useState<Record<string, CommentRow[]>>({});
  const [tab, setTab] = useState<Tab>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    const postsRes = await fetch(`/api/blogs/${slug}/posts?type=article&status=published&limit=50`, { credentials: "include" });
    const postsJson = await postsRes.json().catch(() => null);
    const list: PostRow[] = postsJson?.data?.posts ?? [];
    setPosts(list);

    const entries = await Promise.all(
      list.map(async (p) => {
        const res = await fetch(`/api/blogs/${slug}/posts/${p.slug}/comments`, { credentials: "include" });
        const json = await res.json().catch(() => null);
        const comments: CommentRow[] = json?.data?.comments ?? [];
        return [p.id, comments] as const;
      })
    );
    setByPost(Object.fromEntries(entries.filter(([, c]) => c.length > 0)));
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (blogParam) { setBlogSlug(blogParam); void load(blogParam); return; }
      const res = await fetch("/api/blogs/me", { credentials: "include" });
      const json = await res.json().catch(() => null);
      const blogs = json?.data?.blogs ?? [];
      if (blogs.length === 0) { router.replace("/blogs/new"); return; }
      if (blogs.length > 1) { router.replace("/blogs/dashboard"); return; }
      setBlogSlug(blogs[0].slug);
      void load(blogs[0].slug);
    })();
  }, [router, load, blogParam]);

  async function handleModerate(postId: string, commentId: string, action: "approve" | "remove") {
    if (!blogSlug) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    setBusyId(commentId);
    try {
      await fetch(`/api/blogs/${blogSlug}/posts/${post.slug}/comments/${commentId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (action === "remove") {
        setByPost((prev) => ({ ...prev, [postId]: (prev[postId] ?? []).filter((c) => c.id !== commentId) }));
      } else {
        setByPost((prev) => ({ ...prev, [postId]: (prev[postId] ?? []).map((c) => (c.id === commentId ? { ...c, status: "visible" } : c)) }));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(postId: string, commentId: string) {
    if (!blogSlug) return;
    if (!confirm(t("blogs.dashboard.confirmDeleteComment", "Delete this comment? This can't be undone."))) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    setBusyId(commentId);
    try {
      await fetch(`/api/blogs/${blogSlug}/posts/${post.slug}/comments/${commentId}`, { method: "DELETE", credentials: "include" });
      setByPost((prev) => ({ ...prev, [postId]: (prev[postId] ?? []).filter((c) => c.id !== commentId) }));
    } finally {
      setBusyId(null);
    }
  }

  const visibleByPost = Object.entries(byPost)
    .map(([postId, comments]) => [postId, tab === "pending" ? comments.filter((c) => c.status === "pending") : comments] as const)
    .filter(([, comments]) => comments.length > 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">{t("blogs.dashboard.commentsTitle", "Comments")}</h1>

      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-neutral-900/50 p-1 w-fit">
        {(["pending", "all"] as Tab[]).map((tKey) => (
          <button key={tKey} onClick={() => setTab(tKey)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${tab === tKey ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {tKey === "pending" ? t("blogs.dashboard.commentsPending", "Pending") : t("blogs.dashboard.commentsAll", "All comments")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : visibleByPost.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {tab === "pending" ? t("blogs.dashboard.commentsEmpty", "No comments awaiting approval.") : t("blogs.dashboard.commentsAllEmpty", "No comments yet.")}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleByPost.map(([postId, comments]) => {
            const post = posts.find((p) => p.id === postId);
            return (
              <div key={postId}>
                <div className="text-xs font-semibold text-muted-foreground mb-1">{post?.title}</div>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          @{c.author_username ?? "unknown"} · {formatShortDate(c.created_at)}
                        </div>
                        {c.status === "pending" && (
                          <span className="text-[10px] rounded-full bg-amber-950/40 text-amber-400 px-1.5 py-0.5">{t("blogs.dashboard.commentPending", "pending")}</span>
                        )}
                      </div>
                      <p className="text-sm text-foreground mt-1">{c.body}</p>
                      <div className="mt-2 flex gap-2">
                        {c.status === "pending" && (
                          <button disabled={busyId === c.id} onClick={() => handleModerate(postId, c.id, "approve")} className="rounded-lg bg-emerald-950/40 px-2 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-950/70 disabled:opacity-50">
                            {t("blogs.dashboard.approve", "Approve")}
                          </button>
                        )}
                        <button disabled={busyId === c.id} onClick={() => handleDelete(postId, c.id)} className="rounded-lg bg-red-950/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-950/70 disabled:opacity-50">
                          {t("blogs.dashboard.remove", "Remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
