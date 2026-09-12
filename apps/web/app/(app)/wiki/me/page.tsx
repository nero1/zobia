"use client";

/**
 * app/(app)/wiki/me/page.tsx
 *
 * "My Wikis" — wikis the caller owns vs. wikis they actively contribute to
 * (GET /api/wiki/me). Owned wikis link into the manage dashboard;
 * contributed-to wikis link into the regular wiki view.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface WikiRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  contribute_policy: string;
  page_count: number;
  contributor_count: number;
}

export default function MyWikisPage() {
  const { t } = useTranslation();
  const [owned, setOwned] = useState<WikiRow[]>([]);
  const [contributing, setContributing] = useState<WikiRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/wiki/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setOwned(json?.data?.owned ?? []);
        setContributing(json?.data?.contributing ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-foreground">{t("wiki.me.title", "My Wikis")}</h1>
        <Link href="/wiki/new" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
          {t("wiki.createCta", "Create a wiki")}
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-800 animate-pulse" />)}
        </div>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.me.owned", "Wikis you own")}</h2>
            {owned.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("wiki.me.ownedEmpty", "You don't own any wikis yet.")}</p>
            ) : (
              <div className="space-y-2">
                {owned.map((w) => (
                  <Link
                    key={w.id}
                    href={`/wiki/${w.slug}/manage`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground text-sm truncate">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t("wiki.card.pages", "{{count}} pages", { count: w.page_count })} · {t("wiki.card.contributors", "{{count}} contributors", { count: w.contributor_count })}
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-lg border border-border bg-neutral-900/50 px-2.5 py-1 text-xs font-medium text-foreground">
                      {t("wiki.me.manage", "Manage")}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.me.contributing", "Wikis you contribute to")}</h2>
            {contributing.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("wiki.me.contributingEmpty", "You haven't contributed to any wikis yet.")}</p>
            ) : (
              <div className="space-y-2">
                {contributing.map((w) => (
                  <Link
                    key={w.id}
                    href={`/wiki/${w.slug}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground text-sm truncate">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t("wiki.card.pages", "{{count}} pages", { count: w.page_count })} · {t("wiki.card.contributors", "{{count}} contributors", { count: w.contributor_count })}
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-lg border border-border bg-neutral-900/50 px-2.5 py-1 text-xs font-medium text-foreground">
                      {t("wiki.me.view", "View")}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
