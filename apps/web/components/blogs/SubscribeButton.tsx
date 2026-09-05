"use client";

/**
 * components/blogs/SubscribeButton.tsx
 *
 * Subscribe/unsubscribe to a blog for new-post notifications. Renders
 * client-side only (needs the viewer's auth state) — the blog page itself
 * is server-rendered for SEO.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

// One-shot "resume this after login" intent, tab-scoped so it never leaks
// between users sharing a device and never lingers past the session that
// created it (unlike localStorage). Keyed by blog slug so returning to a
// different blog after login doesn't accidentally auto-subscribe the wrong
// one.
const PENDING_SUBSCRIBE_KEY = "zobia:pendingBlogSubscribe";

function readPendingSubscribe(): string | null {
  try {
    return sessionStorage.getItem(PENDING_SUBSCRIBE_KEY);
  } catch {
    return null;
  }
}

function setPendingSubscribe(blogSlug: string): void {
  try {
    sessionStorage.setItem(PENDING_SUBSCRIBE_KEY, blogSlug);
  } catch {
    // Storage unavailable (private mode, quota) — the user can just click
    // Subscribe again after logging in.
  }
}

function clearPendingSubscribe(): void {
  try {
    sessionStorage.removeItem(PENDING_SUBSCRIBE_KEY);
  } catch {
    // no-op
  }
}

export function SubscribeButton({ blogSlug, showCount, initialCount }: { blogSlug: string; showCount: boolean; initialCount: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const autoSubscribeAttempted = useRef(false);

  async function subscribe(): Promise<"ok" | "unauthorized" | "error"> {
    setBusy(true);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/subscribe`, { method: "POST", credentials: "include" });
      if (res.status === 401) return "unauthorized";
      const json = await res.json();
      if (res.ok) {
        setSubscribed(true);
        setCount(json?.data?.subscriberCount ?? count);
        return "ok";
      }
      return "error";
    } catch {
      return "error";
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetch(`/api/blogs/${blogSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (json) => {
        const isSubscribed = !!json?.data?.isSubscribed;
        setSubscribed(isSubscribed);

        // Returning here right after logging in specifically to subscribe?
        // Finish what the user asked for instead of leaving them to notice
        // and click Subscribe a second time.
        if (
          !isSubscribed &&
          json &&
          !autoSubscribeAttempted.current &&
          readPendingSubscribe() === blogSlug
        ) {
          autoSubscribeAttempted.current = true;
          clearPendingSubscribe();
          await subscribe();
        }
      })
      .catch(() => setSubscribed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogSlug]);

  async function toggle() {
    if (subscribed === null) return;
    if (busy) return;
    if (subscribed) {
      setBusy(true);
      try {
        const res = await fetch(`/api/blogs/${blogSlug}/subscribe`, { method: "DELETE", credentials: "include" });
        if (res.status === 401) { router.push(`/auth/login?redirect=${encodeURIComponent(`/b/${blogSlug}`)}`); return; }
        const json = await res.json();
        if (res.ok) {
          setSubscribed(false);
          setCount(json?.data?.subscriberCount ?? count);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    const result = await subscribe();
    if (result === "unauthorized") {
      setPendingSubscribe(blogSlug);
      router.push(`/auth/login?redirect=${encodeURIComponent(`/b/${blogSlug}`)}`);
    }
  }

  return (
    <div className="flex items-center gap-2">
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
      {subscribed && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          {t("blogs.unsubscribe", "Unsubscribe")}
        </button>
      )}
    </div>
  );
}
