"use client";

/**
 * app/(app)/wiki/invite/[token]/page.tsx
 *
 * Invite-accept page for wiki collaborator invites
 * (GET/POST /api/wiki/invites/<token>). Shows the invite preview (wiki
 * name, expired/used state) and an "Accept" button, then redirects into
 * the wiki on success.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface InvitePreview {
  wiki: { slug: string; name: string };
  expired: boolean;
  used: boolean;
}

export default function WikiInviteAcceptPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/wiki/invites/${token}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setPreview(json?.data ?? null))
      .catch(() => setPreview(null));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/invites/${token}`, { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.invite.errors.generic", "Failed to accept invite"));
      const wikiSlug = json?.data?.wikiSlug as string | undefined;
      router.push(wikiSlug ? `/wiki/${wikiSlug}` : "/wiki/me");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.invite.errors.generic", "Failed to accept invite"));
    } finally {
      setAccepting(false);
    }
  }

  if (preview === undefined) return <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">{t("wiki.loading", "Loading…")}</div>;
  if (preview === null) return <div className="mx-auto max-w-md px-4 py-16 text-center text-muted-foreground">{t("wiki.invite.notFound", "This invite link isn't valid.")}</div>;

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="text-4xl mb-4">📚</div>
      <h1 className="text-xl font-bold text-foreground mb-1">{t("wiki.invite.title", "You're invited to collaborate")}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t("wiki.invite.subtitle", "Join \"{{name}}\" as a contributor.", { name: preview.wiki.name })}
      </p>

      {preview.used ? (
        <p className="text-sm text-amber-400">{t("wiki.invite.alreadyUsed", "This invite has already been used.")}</p>
      ) : preview.expired ? (
        <p className="text-sm text-red-400">{t("wiki.invite.expired", "This invite has expired.")}</p>
      ) : (
        <>
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {accepting ? t("wiki.invite.accepting", "Joining…") : t("wiki.invite.accept", "Accept invite")}
          </button>
        </>
      )}
    </div>
  );
}
