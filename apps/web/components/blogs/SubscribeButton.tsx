"use client";

/**
 * components/blogs/SubscribeButton.tsx
 *
 * Subscribe/unsubscribe to a blog for new-post notifications. Renders
 * client-side only (needs the viewer's auth state) — the blog page itself
 * is server-rendered for SEO.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export function SubscribeButton({ blogSlug, showCount, initialCount }: { blogSlug: string; showCount: boolean; initialCount: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/blogs/${blogSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setSubscribed(!!json?.data?.isSubscribed))
      .catch(() => setSubscribed(false));
  }, [blogSlug]);

  async function toggle() {
    if (subscribed === null) return;
    if (busy) return;
    setBusy(true);
    const next = !subscribed;
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/subscribe`, { method: next ? "POST" : "DELETE", credentials: "include" });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (res.ok) {
        setSubscribed(next);
        setCount(json?.data?.subscriberCount ?? count);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={subscribed === null || busy}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
        subscribed ? "border border-border bg-card text-foreground hover:bg-accent" : "bg-primary text-primary-foreground hover:opacity-90"
      }`}
    >
      {subscribed ? t("blogs.subscribed", "Subscribed ✓") : t("blogs.subscribe", "Subscribe")}
      {showCount && <span className="ml-1.5 opacity-70">· {count}</span>}
    </button>
  );
}
