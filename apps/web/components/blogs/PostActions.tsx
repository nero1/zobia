"use client";

/**
 * components/blogs/PostActions.tsx
 *
 * Like button + view tracker for a blog article. The view is recorded at
 * most once per browser per post — deduped client-side via localStorage
 * (`zobia_blog_viewed`) so we don't fire a write on every render/refresh,
 * keeping DB/Redis calls minimal and working offline-first.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

const VIEWED_STORAGE_KEY = "zobia_blog_viewed";

function hasRecordedView(postId: string): boolean {
  try {
    const raw = localStorage.getItem(VIEWED_STORAGE_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    return seen.includes(postId);
  } catch {
    return false;
  }
}

function markViewRecorded(postId: string): void {
  try {
    const raw = localStorage.getItem(VIEWED_STORAGE_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (!seen.includes(postId)) {
      seen.push(postId);
      // Cap stored ids so this never grows unbounded on a heavy reader.
      localStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(seen.slice(-500)));
    }
  } catch { /* localStorage unavailable — skip, not critical */ }
}

export function PostActions({ blogSlug, postSlug, postId, initialLikeCount }: { blogSlug: string; postSlug: string; postId: string; initialLikeCount: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [liked, setLiked] = useState<boolean | null>(null);
  const [count, setCount] = useState(initialLikeCount);
  const [busy, setBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!hasRecordedView(postId)) {
      fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/view`, { method: "POST", credentials: "include" })
        .then((res) => { if (res.ok || res.status === 401) markViewRecorded(postId); })
        .catch(() => {});
    }
  }, [blogSlug, postSlug, postId]);

  useEffect(() => {
    fetch(`/api/blogs/${blogSlug}/posts/${postSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setLiked(!!json?.data?.isLiked))
      .catch(() => setLiked(false));
  }, [blogSlug, postSlug]);

  async function toggleLike() {
    if (liked === null || busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/like`, { method: next ? "POST" : "DELETE", credentials: "include" });
      if (res.status === 401) { router.push("/auth/login"); setLiked(!next); setCount((c) => c - (next ? 1 : -1)); return; }
      const json = await res.json();
      if (res.ok) setCount(json?.data?.likeCount ?? count);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setShareNotice(null);
    try {
      // Copy the link either way — the reward-pot claim (if any) is a bonus
      // on top of the normal share action, not a gate on it.
      const url = `${window.location.origin}/b/${blogSlug}/${postSlug}`;
      if (navigator.share) {
        await navigator.share({ url }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => {});
        setShareNotice(t("blogs.post.linkCopied", "Link copied!"));
      }
      const res = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/share`, { method: "POST", credentials: "include" });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.rewardClaimed) {
        setShareNotice(t("blogs.post.shareRewardClaimed", "You earned {{amount}} credits for sharing!", { amount: json.data.rewardClaimed }));
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggleLike}
        disabled={liked === null || busy}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
      >
        <span>{liked ? "❤️" : "🤍"}</span>
        <span>{count}</span>
        <span className="sr-only">{t("blogs.post.like", "Like")}</span>
      </button>
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
      >
        <span>🔗</span>
        <span>{t("blogs.post.share", "Share")}</span>
      </button>
      {shareNotice && <span className="text-xs text-amber-400">{shareNotice}</span>}
    </div>
  );
}
