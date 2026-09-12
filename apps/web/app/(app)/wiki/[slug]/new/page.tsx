"use client";

/**
 * app/(app)/wiki/[slug]/new/page.tsx
 *
 * Create a new page on a wiki — any user with contribute access
 * (owner/moderator, or gated by the wiki's contribute_policy) can reach
 * this; the API enforces access server-side, we just gate the UI so
 * ineligible users get a clear message instead of a raw 403.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { WikiPageEditor } from "@/components/wiki/WikiPageEditor";

export default function NewWikiPagePage() {
  const { t } = useTranslation();
  const params = useParams<{ slug: string }>();
  const [canContribute, setCanContribute] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/wiki/${params.slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setCanContribute(!!json?.data?.canContribute))
      .catch(() => setCanContribute(false));
  }, [params.slug]);

  if (canContribute === undefined) return null;
  if (!canContribute) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-muted-foreground">
        {t("wiki.page.noContributeAccess", "You don't have permission to add pages to this wiki.")}
      </div>
    );
  }

  return <WikiPageEditor wikiSlug={params.slug} />;
}
