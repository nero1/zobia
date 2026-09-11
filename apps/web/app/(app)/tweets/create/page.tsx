"use client";

/**
 * app/(app)/tweets/create/page.tsx
 *
 * Tweet composer — text (<=280 chars), an optional charged image upload, and
 * an optional free YouTube/TikTok video embed. Mirrors the Moments composer
 * (app/(app)/moments/create/page.tsx)'s level-gate/cost-notice/upload flow.
 *
 * Draft persistence: unsent text is kept in localStorage, namespaced by the
 * signed-in user's id (`tweets_draft_<userId>`) so a shared device never
 * leaks one person's half-typed Tweet to the next signed-in user.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useTweetsConfig } from "@/lib/hooks/useTweetsConfig";
import { useTweetLengthPolicy } from "@/lib/hooks/useTweetLengthPolicy";
import type { TweetVideoProvider } from "@/components/tweets/types";
import { IMAGE_ACCEPT_ATTR, isImageFileValid } from "@/lib/uploads/imageValidationShared";

interface InsufficientFundsInfo {
  costCredits: number;
  kind: "image" | "length";
}

function useDraftKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const id = (json?.user ?? json)?.id;
        if (id) setKey(`tweets_draft_${id}`);
      })
      .catch(() => {});
  }, []);
  return key;
}

export default function CreateTweetPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const tweetsConfig = useTweetsConfig();
  const lengthPolicy = useTweetLengthPolicy();
  const draftKey = useDraftKey();

  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoProvider, setVideoProvider] = useState<TweetVideoProvider | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [showVideoPicker, setShowVideoPicker] = useState(false);
  const [showVideoHelp, setShowVideoHelp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState<InsufficientFundsInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Restore a draft once we know who's typing.
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setContent(saved);
    } catch {
      // localStorage unavailable (private window, etc.) — fine, just no draft restore
    }
  }, [draftKey]);

  // Persist the draft as the user types.
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (content.trim()) window.localStorage.setItem(draftKey, content);
      else window.localStorage.removeItem(draftKey);
    } catch {
      // Non-fatal
    }
  }, [draftKey, content]);

  function clearDraft() {
    if (!draftKey) return;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Non-fatal
    }
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = isImageFileValid(file);
    if (!validation.ok) {
      setUploadError(validation.message);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/tweets/uploads/image", { method: "POST", credentials: "include", body: formData });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Upload failed");
      setImageUrl(json.data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handlePickVideoProvider(provider: TweetVideoProvider) {
    setVideoProvider(provider);
    setShowVideoPicker(false);
  }

  function handleRemoveVideo() {
    setVideoProvider(null);
    setVideoUrl("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() && !imageUrl && !(videoProvider && videoUrl.trim())) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (content.trim()) body.content = content.trim();
      if (imageUrl.trim()) body.image_url = imageUrl.trim();
      if (videoProvider && videoUrl.trim()) {
        body.video_provider = videoProvider;
        body.video_url = videoUrl.trim();
      }

      const res = await fetch("/api/tweets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: {
            code?: string;
            message?: string;
            params?: { costCredits?: number; creditBalance?: number; minLevel?: number; currentLevel?: number };
          };
        };
        const code = d.error?.code ?? null;
        const message = d.error?.message ?? d.message ?? "Failed to post Tweet";

        if (code === "INSUFFICIENT_TWEET_IMAGE_FUNDS") {
          setInsufficientFunds({ costCredits: d.error?.params?.costCredits ?? tweetsConfig.imageCostCredits, kind: "image" });
          return;
        }
        if (code === "INSUFFICIENT_TWEET_LENGTH_FUNDS") {
          setInsufficientFunds({ costCredits: d.error?.params?.costCredits ?? lengthPolicy.longTweetCostCredits, kind: "length" });
          return;
        }

        const err = new Error(message) as Error & { code?: string | null };
        err.code = code;
        throw err;
      }

      clearDraft();
      router.push("/tweets");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Something went wrong") : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(content.trim() || imageUrl || (videoProvider && videoUrl.trim()));

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/tweets"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Back to Tweets"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("tweets.create.title")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="p-5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, lengthPolicy.personalMaxLength))}
              placeholder={t("tweets.create.placeholder")}
              rows={4}
              maxLength={lengthPolicy.personalMaxLength}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="mt-1.5 flex items-center justify-between">
              {content.length > lengthPolicy.defaultMaxLength && !lengthPolicy.isLongFormExempt ? (
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {t("tweets.create.longTweetCostNotice", { cost: lengthPolicy.longTweetCostCredits })}
                </span>
              ) : (
                <span />
              )}
              <span
                className={`text-xs tabular-nums ${
                  content.length >= lengthPolicy.personalMaxLength ? "text-red-500" : "text-neutral-400"
                }`}
              >
                {content.length}/{lengthPolicy.personalMaxLength}
              </span>
            </div>
          </div>
        </div>

        {/* Image upload */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            {t("tweets.create.image")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              onChange={handleImageSelect}
              className="hidden"
              id="tweet-image-input"
            />
            <label
              htmlFor="tweet-image-input"
              className="cursor-pointer rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-600 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {uploading ? t("tweets.create.uploading") : t("tweets.create.addImage")}
            </label>
            {imageUrl && (
              <button type="button" onClick={() => setImageUrl("")} className="text-xs font-semibold text-red-600 hover:underline">
                {t("tweets.create.removeImage")}
              </button>
            )}
          </div>
          {!tweetsConfig.imageIsFree && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              {t("tweets.create.imageCostNotice", { cost: tweetsConfig.imageCostCredits })}
            </p>
          )}
          {uploadError && <p className="mt-1.5 text-xs text-red-600">{uploadError}</p>}
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="mt-2 max-h-48 rounded-lg border border-neutral-200 dark:border-neutral-700" />
          )}
        </div>

        {/* Video embed */}
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t("tweets.create.video")}</label>
            <span className="text-xs font-semibold text-green-600 dark:text-green-400">{t("tweets.create.videoFree")}</span>
          </div>

          {!videoProvider ? (
            <button
              type="button"
              onClick={() => setShowVideoPicker((v) => !v)}
              className="rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-600 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {t("tweets.create.addVideo")}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold capitalize text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {videoProvider}
                </span>
                <button type="button" onClick={handleRemoveVideo} className="text-xs font-semibold text-red-600 hover:underline">
                  {t("tweets.create.removeVideo")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder={
                    videoProvider === "youtube" ? "https://youtube.com/watch?v=..." : "https://www.tiktok.com/@user/video/..."
                  }
                  className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <button
                  type="button"
                  onClick={() => setShowVideoHelp(true)}
                  aria-label={t("tweets.create.videoHelpAria")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-sm font-bold text-neutral-500 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-400"
                >
                  ?
                </button>
              </div>
            </div>
          )}

          {showVideoPicker && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => handlePickVideoProvider("youtube")}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300"
              >
                ▶️ YouTube
              </button>
              <button
                type="button"
                onClick={() => handlePickVideoProvider("tiktok")}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300"
              >
                🎵 TikTok
              </button>
            </div>
          )}
        </div>

        {/* Level gate reminder */}
        {tweetsConfig.minLevel > 1 && (
          <p className="text-xs text-neutral-400">{t("tweets.create.levelNotice", { minLevel: tweetsConfig.minLevel })}</p>
        )}

        <div className="flex gap-3">
          <Link
            href="/tweets"
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("tweets.create.cancel")}
          </Link>
          <button
            type="submit"
            disabled={!canSubmit || submitting || uploading}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? t("tweets.create.posting") : t("tweets.create.post")}
          </button>
        </div>
      </form>

      {/* Video help modal */}
      {showVideoHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowVideoHelp(false)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowVideoHelp(false)}
              className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900 dark:text-neutral-50">{t("tweets.create.videoHelpTitle")}</h2>
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
              {t(videoProvider === "tiktok" ? "tweets.create.videoHelpTiktok" : "tweets.create.videoHelpYoutube")}
            </p>
            <button
              onClick={() => setShowVideoHelp(false)}
              className="w-full rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {t("moments.create.gotIt")}
            </button>
          </div>
        </div>
      )}

      {/* Insufficient funds popup */}
      {insufficientFunds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setInsufficientFunds(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setInsufficientFunds(null)}
              className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900 dark:text-neutral-50">{t("tweets.create.insufficientTitle")}</h2>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              {t(
                insufficientFunds.kind === "length" ? "tweets.create.insufficientLengthMessage" : "tweets.create.insufficientMessage",
                { costCredits: insufficientFunds.costCredits }
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setInsufficientFunds(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("moments.create.gotIt")}
              </button>
              <Link
                href="/wallet?buy=true"
                className="flex-1 rounded-xl bg-amber-500 py-2 text-center text-sm font-semibold text-white hover:bg-amber-600"
                onClick={() => setInsufficientFunds(null)}
              >
                {t("tweets.create.buyCredits")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
