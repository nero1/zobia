"use client";

/**
 * app/(app)/blogs/gift/[slug]/page.tsx
 *
 * Send a SITEWIDE gift (the Gifts economy — credits/coins, gift_items
 * catalogue) to a blog's owner. This is distinct from that blog's OWN
 * owner-defined per-blog "Rewarded Gifts" tiers (blog_gift_tiers /
 * components/blogs/GiftTiersSection.tsx) — this page sends a catalogue gift
 * to the person, not a blog-authored reward tier. Modeled closely on
 * app/(app)/rooms/[roomId]/gift/page.tsx.
 */

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  isRewarded?: boolean;
  rewardLabel?: string | null;
  rewardDescription?: string | null;
}

interface GiftTier {
  tier: number;
  label: string;
  gifts: GiftItem[];
}

export default function BlogGiftPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const currency = useCurrency();
  const { t } = useTranslation();

  const [tiers, setTiers] = useState<GiftTier[]>([]);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [blogId, setBlogId] = useState<string | null>(null);
  const [blogTitle, setBlogTitle] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerUsername, setOwnerUsername] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the blog to resolve its owner.
  useEffect(() => {
    fetch(`/api/blogs/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { data?: { blog?: { id?: string; title?: string; owner_id?: string; owner_username?: string } } } | null) => {
        const blog = data?.data?.blog;
        if (blog) {
          setBlogId(blog.id ?? null);
          setBlogTitle(blog.title ?? "");
          setOwnerId(blog.owner_id ?? null);
          setOwnerUsername(blog.owner_username ?? "");
        }
      })
      .catch(() => {});
  }, [slug]);

  // Fetch the current user's id so we can block the blog owner from gifting
  // their own blog before they even reach the server's 400
  // (SELF_GIFT_NOT_ALLOWED, same code as room gifting).
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { id?: string }; id?: string } | null) => {
        const id = data?.user?.id ?? data?.id;
        if (id) setCurrentUserId(id);
      })
      .catch(() => {});
  }, []);

  const isOwnBlog = Boolean(currentUserId && ownerId && currentUserId === ownerId);

  useEffect(() => {
    fetch("/api/economy/gifts/catalogue", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { tiers?: GiftTier[] } | null) => setTiers(data?.tiers ?? []))
      .catch(() => {})
      .finally(() => setLoadingCatalogue(false));
  }, []);

  useEffect(() => {
    fetch("/api/economy/coins/balance", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { balance?: number } | null) => {
        if (data?.balance != null) setBalance(data.balance);
      })
      .catch(() => {});
  }, []);

  async function handleSend() {
    if (!selected || !ownerId || !blogId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/economy/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giftItemId: selected.id,
          recipientId: ownerId,
          blogId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } | string };
        const code = typeof body.error === "object" ? body.error?.code : undefined;
        const message = typeof body.error === "object" ? body.error?.message : body.error;
        const err = new Error(message ?? "Failed to send gift") as Error & { code?: string | null };
        err.code = code ?? null;
        throw err;
      }
      setSent(true);
      setTimeout(() => router.push(`/b/${slug}`), 2000);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || "Error sending gift"));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6">
        <span className="text-6xl">{selected?.emoji ?? "🎁"}</span>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          {t("blogs.gift.sent", "Gift Sent!")}
        </h2>
        {selected?.isRewarded && selected.rewardLabel && (
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {t("blogs.gift.unlocked", "You unlocked \"{{label}}\"!", { label: selected.rewardLabel })}
          </p>
        )}
        <p className="text-sm text-neutral-500">{t("blogs.gift.redirecting", "Redirecting back to the blog…")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-lg p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <Link href={`/b/${slug}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← {t("action.back", "Back")}
        </Link>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          {t("blogs.gift.title", "Send a Site Gift")}
        </h1>
      </div>

      {isOwnBlog ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center dark:border-amber-800 dark:bg-amber-950/40">
          <span className="text-3xl">🚫</span>
          <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            {t("blogs.gift.selfGiftBlocked", "You can't send a gift to your own blog.")}
          </p>
        </div>
      ) : (
        <>
          {ownerUsername && (
            <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
              {t("blogs.gift.giftingTo", "Gifting to")}{" "}
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">@{ownerUsername}</span>
              {blogTitle && <span className="text-neutral-400"> · {blogTitle}</span>}
            </div>
          )}

          {balance != null && (
            <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
              <span>🪙</span>
              <span>
                {t("blogs.gift.balance", "Your balance:")}{" "}
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {balance.toLocaleString()} {currency.softPlural.toLowerCase()}
                </span>
              </span>
            </div>
          )}

          {loadingCatalogue ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="mb-3 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((j) => (
                      <div key={j} className="aspect-square rounded-xl bg-neutral-200 dark:bg-neutral-700" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tiers.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
              <span className="text-4xl">🎁</span>
              <p className="mt-3 text-sm text-neutral-500">{t("blogs.gift.noneAvailable", "No gifts available right now.")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {tiers.map((tierEntry) => (
                <div key={tierEntry.tier} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    {tierEntry.label}
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                    {tierEntry.gifts.map((gift) => (
                      <button
                        key={gift.id}
                        onClick={() => setSelected(selected?.id === gift.id ? null : gift)}
                        className={`relative flex flex-col items-center rounded-xl border p-2 transition-colors ${
                          selected?.id === gift.id
                            ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                            : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {gift.isRewarded && (
                          <span className="absolute -top-1.5 -right-1.5 text-[13px]" title={t("gifts.rewarded.badgeTitle", "Unlocks a reward")}>✨</span>
                        )}
                        <span className="text-2xl">{gift.emoji}</span>
                        <span className="mt-1 w-full truncate text-center text-xs leading-tight text-neutral-500 dark:text-neutral-400">
                          {gift.name}
                        </span>
                        <span className="mt-0.5 text-[11px] font-bold text-amber-600">
                          🪙{gift.coinCost.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="sticky bottom-4 mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-lg dark:border-blue-800 dark:bg-neutral-900">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-3xl">{selected.emoji}</span>
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">{selected.name}</p>
                  <p className="text-sm text-amber-600">🪙 {selected.coinCost.toLocaleString()} {currency.softPlural.toLowerCase()}</p>
                </div>
              </div>
              {selected.isRewarded && (
                <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <p className="font-semibold">✨ {t("gifts.rewarded.unlocksLabel", "Unlocks: {{label}}", { label: selected.rewardLabel ?? "" })}</p>
                  {selected.rewardDescription && <p className="mt-0.5">{selected.rewardDescription}</p>}
                </div>
              )}
              {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
              <button
                onClick={handleSend}
                disabled={sending || !ownerId}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sending ? t("blogs.gift.sending", "Sending…") : t("blogs.gift.sendButton", "Send {{emoji}} {{name}}", { emoji: selected.emoji, name: selected.name })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
