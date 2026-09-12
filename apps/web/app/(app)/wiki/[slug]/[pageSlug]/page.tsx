"use client";

/**
 * app/(app)/wiki/[slug]/[pageSlug]/page.tsx
 *
 * View a single wiki page. content_html is sanitized server-side
 * (lib/wiki/service.ts's renderContentHtml -> sanitizeBlogPostHtml /
 * plainTextToBlogPostHtml) — rendered here the same safe way
 * components/blogs/PostBody.tsx renders a blog post body.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface WikiPageDetail {
  id: string;
  slug: string;
  title: string;
  content_html: string;
  revision_count: number;
  view_count: number;
  creator_username: string | null;
  last_editor_username: string | null;
  updated_at: string;
}

export default function WikiPageViewPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string; pageSlug: string }>();
  const { slug, pageSlug } = params;

  const [page, setPage] = useState<WikiPageDetail | null | undefined>(undefined);
  const [canManage, setCanManage] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/wiki/${slug}/pages/${pageSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setPage(json?.data?.page ?? null);
        setCanManage(!!json?.data?.canManage);
        setCanContribute(!!json?.data?.canContribute);
      })
      .catch(() => setPage(null));
  }, [slug, pageSlug]);

  async function handleDelete() {
    if (!confirm(t("wiki.page.confirmDelete", "Delete this page? This can't be undone."))) return;
    setDeleting(true);
    try {
      await fetch(`/api/wiki/${slug}/pages/${pageSlug}`, { method: "DELETE", credentials: "include" });
      router.push(`/wiki/${slug}`);
    } finally {
      setDeleting(false);
    }
  }

  if (page === undefined) return <div className="mx-auto max-w-3xl px-4 py-8 text-muted-foreground">{t("wiki.loading", "Loading…")}</div>;
  if (page === null) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">{t("wiki.page.notFound", "Page not found.")}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/wiki/${slug}`} className="mb-3 inline-block text-xs text-muted-foreground hover:text-foreground">
        ← {t("wiki.page.backToWiki", "Back to wiki")}
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">{page.title}</h1>
        <div className="flex flex-wrap gap-2">
          {canContribute && (
            <Link href={`/wiki/${slug}/${pageSlug}/edit`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
              {t("wiki.page.edit", "Edit")}
            </Link>
          )}
          {canManage && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/70 disabled:opacity-50"
            >
              {t("wiki.page.delete", "Delete")}
            </button>
          )}
        </div>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        {t("wiki.page.meta", "{{revisions}} revisions · {{views}} views", { revisions: page.revision_count, views: page.view_count })}
        {page.last_editor_username && ` · ${t("wiki.page.lastEditedBy", "last edited by @{{username}}", { username: page.last_editor_username })}`}
      </p>

      {/* eslint-disable-next-line react/no-danger */}
      <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: page.content_html }} />
    </div>
  );
}
