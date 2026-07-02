"use client";

/**
 * components/blogs/PostBody.tsx
 *
 * Renders the article body. The server already sends a sanitized preview
 * (or full body, if not paywalled) for SEO. When the post is paywalled,
 * this component checks the *signed-in* viewer's actual unlock state via
 * the authenticated endpoint and swaps in the full body if they've already
 * unlocked it (or are the author) — otherwise shows the
 * "Pay N credits to read the rest of the article" notice.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

export function PostBody({
  blogSlug,
  postSlug,
  serverHtml,
  isPaywalled,
  paywallCreditsCost,
}: {
  blogSlug: string;
  postSlug: string;
  serverHtml: string;
  isPaywalled: boolean;
  paywallCreditsCost: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [html, setHtml] = useState(serverHtml);
  const [locked, setLocked] = useState(isPaywalled);
  const [checked, setChecked] = useState(!isPaywalled);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPaywalled) return;
    fetch(`/api/blogs/${blogSlug}/posts/${postSlug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const data = json?.data;
        if (data && !data.locked && data.post?.body_html) {
          setHtml(data.post.body_html);
          setLocked(false);
        }
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [blogSlug, postSlug, isPaywalled]);

  async function handleUnlock() {
    setUnlocking(true);
    setError(null);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/unlock`, { method: "POST", credentials: "include" });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Unlock failed");

      const full = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}`, { credentials: "include" }).then((r) => r.json());
      if (full?.data?.post?.body_html) {
        setHtml(full.data.post.body_html);
        setLocked(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div>
      {/* eslint-disable-next-line react/no-danger */}
      <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />

      {locked && checked && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 text-center">
          <p className="text-sm text-amber-300 mb-3">
            {t("blogs.post.paywallNotice", "Pay {{cost}} credits to read the rest of the article.", { cost: paywallCreditsCost })}
          </p>
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <button
            type="button"
            onClick={handleUnlock}
            disabled={unlocking}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-950 hover:opacity-90 disabled:opacity-50"
          >
            {unlocking ? t("blogs.post.unlocking", "Unlocking…") : t("blogs.post.unlock", "Unlock for {{cost}} credits", { cost: paywallCreditsCost })}
          </button>
        </div>
      )}
    </div>
  );
}
