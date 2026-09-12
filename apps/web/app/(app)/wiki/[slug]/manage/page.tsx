"use client";

/**
 * app/(app)/wiki/[slug]/manage/page.tsx
 *
 * Owner/moderator manage dashboard hub: page list (with delete), and quick
 * links to Settings, Collaborators & Moderators, and the Reward Pot.
 * Mirrors app/(app)/blogs/dashboard/page.tsx's shape.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface WikiRow {
  id: string;
  slug: string;
  name: string;
  page_count: number;
  contributor_count: number;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  view_count: number;
  revision_count: number;
  updated_at: string;
}

export default function WikiManageDashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [wiki, setWiki] = useState<WikiRow | null | undefined>(undefined);
  const [canManage, setCanManage] = useState(false);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/wiki/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json?.data?.wiki) { setWiki(null); return; }
        setWiki(json.data.wiki);
        setCanManage(!!json.data.canManage);
        if (!json.data.canManage) router.replace(`/wiki/${slug}`);
      })
      .catch(() => setWiki(null));
  }, [slug, router]);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wiki/${slug}/pages?limit=100`, { credentials: "include" });
      const json = await res.json();
      setPages(json?.data?.pages ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (canManage) void fetchPages(); }, [canManage, fetchPages]);

  async function handleDelete(pageSlug: string) {
    if (!confirm(t("wiki.dashboard.confirmDelete", "Delete this page?"))) return;
    await fetch(`/api/wiki/${slug}/pages/${pageSlug}`, { method: "DELETE", credentials: "include" });
    void fetchPages();
  }

  if (wiki === undefined) return <div className="mx-auto max-w-4xl px-4 py-8 text-muted-foreground">{t("wiki.loading", "Loading…")}</div>;
  if (wiki === null || !canManage) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{wiki.name}</h1>
          <Link href={`/wiki/${slug}`} className="text-xs text-primary hover:underline">{t("wiki.dashboard.viewWiki", "View wiki ↗")}</Link>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/wiki/${slug}/new`} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90">
            {t("wiki.dashboard.newPage", "+ New page")}
          </Link>
          <Link href={`/wiki/${slug}/manage/collaborators`} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("wiki.dashboard.collaborators", "Collaborators")}
          </Link>
          <Link href={`/wiki/${slug}/manage/treasury`} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("wiki.dashboard.treasury", "Reward Pot")}
          </Link>
          <Link href={`/wiki/${slug}/manage/settings`} className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("wiki.dashboard.settings", "Settings")}
          </Link>
        </div>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        {t("wiki.card.pages", "{{count}} pages", { count: wiki.page_count })} · {t("wiki.card.contributors", "{{count}} contributors", { count: wiki.contributor_count })}
      </p>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">{t("wiki.dashboard.empty", "No pages yet.")}</div>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground text-sm truncate">{p.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("wiki.page.viewCount", "{{count}} views", { count: p.view_count })} · {t("wiki.page.revisionCount", "{{count}} revisions", { count: p.revision_count })}
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <Link href={`/wiki/${slug}/${p.slug}/edit`} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
                  {t("wiki.dashboard.edit", "Edit")}
                </Link>
                <button onClick={() => handleDelete(p.slug)} className="rounded-lg bg-red-950/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-950/70">
                  {t("wiki.dashboard.delete", "Delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
