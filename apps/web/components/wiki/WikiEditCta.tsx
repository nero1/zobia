"use client";

/**
 * components/wiki/WikiEditCta.tsx
 *
 * Small edit call-to-action shown on the public /w/<slug> and
 * /w/<slug>/<pageSlug> pages. Editing always requires auth and happens on
 * the authenticated /wiki/<slug> equivalent (built separately, someone
 * else's parallel effort) — a signed-out visitor is sent to log in first;
 * a signed-in visitor goes straight to the authenticated editor.
 *
 * A small client island purely so it can use i18next like the rest of the
 * app's interactive bits (blog SSR pages hardcode English for
 * server-rendered text — see app/b/[slug]/[postSlug]/page.tsx — but any
 * piece that needs t() is pulled into a client component like this one).
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function WikiEditCta({
  wikiSlug,
  pageSlug,
  variant = "wiki",
  signedIn = false,
}: {
  wikiSlug: string;
  pageSlug?: string;
  variant?: "wiki" | "page";
  signedIn?: boolean;
}) {
  const { t } = useTranslation();
  const editHref = pageSlug ? `/wiki/${wikiSlug}/${pageSlug}/edit` : `/wiki/${wikiSlug}`;
  const href = signedIn ? editHref : "/auth/login";

  let label: string;
  if (signedIn) {
    // Reuse the authenticated dashboard's existing "wiki.page.edit" key
    // (already shipped, see app/(app)/wiki/[slug]/[pageSlug]/page.tsx)
    // rather than minting a near-duplicate for the same action.
    label = variant === "page" ? t("wiki.page.edit", "Edit") : t("wiki.home.contribute", "Contribute");
  } else {
    label = variant === "page" ? t("wiki.page.loginToEdit", "Log in to edit this page") : t("wiki.home.loginToContribute", "Log in to contribute");
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
    >
      ✏️ {label}
    </Link>
  );
}
