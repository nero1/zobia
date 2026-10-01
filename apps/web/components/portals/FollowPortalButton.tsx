"use client";

/**
 * components/portals/FollowPortalButton.tsx
 *
 * Follow / unfollow a portal. Viewer state is fetched separately from the
 * cached portal payload (GET /api/portals/<slug>/follow) so one cached page
 * serves everyone. Guests get a login link that returns them to the portal.
 */

import Link from "@/components/ui/Link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth/hooks";

export function FollowPortalButton({ slug, onCountChange }: { slug: string; onCountChange?: (count: number) => void }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch(`/api/portals/${encodeURIComponent(slug)}/follow`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setFollowing(Boolean(json.data.following));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug, user]);

  if (isLoading) return <span className="h-9 w-24 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />;

  if (!user) {
    return (
      <Link
        href={`/auth/login?redirect=${encodeURIComponent(`/h/${slug}`)}`}
        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        {t("portals.followLogin")}
      </Link>
    );
  }

  const toggle = async () => {
    if (busy || following === null) return;
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic
    try {
      const res = await fetch(`/api/portals/${encodeURIComponent(slug)}/follow`, { method: next ? "POST" : "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("follow failed");
      const json = (await res.json()) as { data?: { followerCount?: number } };
      if (typeof json.data?.followerCount === "number") onCountChange?.(json.data.followerCount);
    } catch {
      setFollowing(!next); // roll back
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || following === null}
      aria-pressed={!!following}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        following
          ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          : "bg-primary text-primary-foreground hover:opacity-90"
      }`}
    >
      {following ? t("portals.following") : t("portals.follow")}
    </button>
  );
}
