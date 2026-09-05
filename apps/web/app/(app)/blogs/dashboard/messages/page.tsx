"use client";

/**
 * app/(app)/blogs/dashboard/messages/page.tsx
 *
 * Contact-form inbox for the caller's own blog (migration 0023). Simple
 * list + mark-read, mirroring dashboard/comments/page.tsx's shape.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { formatShortDate } from "@/lib/format/date";

interface MessageRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export default function BlogMessagesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blogParam = searchParams.get("blog");
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/blogs/${slug}/messages`, { credentials: "include" });
      const json = await res.json().catch(() => null);
      setMessages(json?.data?.messages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const blogs = meJson?.data?.blogs ?? [];
      if (blogs.length === 0) { router.replace("/blogs/new"); return; }
      const blog = blogs.length === 1 ? blogs[0] : blogs.find((b: { slug: string }) => b.slug === blogParam);
      if (!blog) { router.replace("/blogs/dashboard"); return; }
      setBlogSlug(blog.slug);
      await load(blog.slug);
    })();
  }, [router, blogParam, load]);

  async function markRead(id: string) {
    if (!blogSlug) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
    await fetch(`/api/blogs/${blogSlug}/messages/${id}`, { method: "PATCH", credentials: "include" });
  }

  if (!blogSlug) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-foreground">{t("blogs.dashboard.messages", "Messages")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("blogs.messages.hint", "Submissions from your blog's Contact page.")}
      </p>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("blogs.messages.empty", "No messages yet.")}</p>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-xl border p-3 ${m.is_read ? "border-border bg-card" : "border-primary/50 bg-primary/5"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {m.sender_username ? `@${m.sender_username}` : m.sender_name || t("blogs.messages.anonymous", "Anonymous")}
                  {m.sender_email && <span className="ml-2 text-xs text-muted-foreground">{m.sender_email}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{formatShortDate(m.created_at)}</span>
              </div>
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{m.message}</p>
              {!m.is_read && (
                <button onClick={() => markRead(m.id)} className="mt-2 rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
                  {t("blogs.messages.markRead", "Mark as read")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
