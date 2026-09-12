"use client";

/**
 * app/(app)/wiki/[slug]/[pageSlug]/edit/page.tsx
 *
 * Edit an existing wiki page — the shared WikiPageEditor form, plus the
 * revision history with a "Restore this version" action
 * (POST /api/wiki/<slug>/pages/<pageSlug>/revisions).
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { WikiPageEditor, type WikiPageEditorInitial } from "@/components/wiki/WikiPageEditor";

interface Revision {
  id: string;
  revision_number: number;
  title: string;
  edit_summary: string | null;
  editor_username: string | null;
  created_at: string;
}

function RevisionHistory({ wikiSlug, pageSlug }: { wikiSlug: string; pageSlug: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/wiki/${wikiSlug}/pages/${pageSlug}/revisions`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setRevisions(json?.data?.revisions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [wikiSlug, pageSlug]);

  useEffect(() => { load(); }, [load]);

  async function handleRestore(revisionNumber: number) {
    if (!confirm(t("wiki.history.confirmRestore", "Restore this version? It will become the current version of the page."))) return;
    setRestoring(revisionNumber);
    try {
      await fetch(`/api/wiki/${wikiSlug}/pages/${pageSlug}/revisions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionNumber }),
      });
      router.refresh();
      window.location.reload();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10">
      <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.history.title", "Revision history")}</h2>
      {loading ? (
        <div className="space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("wiki.history.empty", "No revisions yet.")}</p>
      ) : (
        <div className="space-y-1.5">
          {revisions.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0">
                <div className="text-sm text-foreground">
                  {t("wiki.history.revisionNumber", "#{{number}}", { number: r.revision_number })}
                  {r.editor_username && <span className="text-muted-foreground"> · @{r.editor_username}</span>}
                </div>
                {r.edit_summary && <div className="text-xs text-muted-foreground truncate">{r.edit_summary}</div>}
                <div className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
              </div>
              {i !== 0 && (
                <button
                  type="button"
                  onClick={() => handleRestore(r.revision_number)}
                  disabled={restoring === r.revision_number}
                  className="flex-shrink-0 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
                >
                  {restoring === r.revision_number ? t("wiki.history.restoring", "Restoring…") : t("wiki.history.restore", "Restore")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EditWikiPagePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string; pageSlug: string }>();
  const { slug, pageSlug } = params;
  const [initial, setInitial] = useState<WikiPageEditorInitial | null>(null);
  const [canContribute, setCanContribute] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/wiki/${slug}/pages/${pageSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const page = json?.data?.page;
        if (!page) { router.replace(`/wiki/${slug}`); return; }
        setCanContribute(!!json?.data?.canContribute);
        setInitial({
          title: page.title,
          contentMarkdown: page.content_markdown,
          contentFormat: page.content_format === "plaintext" ? "plaintext" : "markdown",
        });
      })
      .catch(() => router.replace(`/wiki/${slug}`));
  }, [slug, pageSlug, router]);

  if (canContribute === undefined || !initial) return null;
  if (!canContribute) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-muted-foreground">
        {t("wiki.page.noContributeAccess", "You don't have permission to edit this page.")}
      </div>
    );
  }

  return (
    <div>
      <WikiPageEditor wikiSlug={slug} pageSlug={pageSlug} initial={initial} />
      <RevisionHistory wikiSlug={slug} pageSlug={pageSlug} />
    </div>
  );
}
