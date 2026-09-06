"use client";

/**
 * app/(app)/business/broadcasts/page.tsx
 *
 * Business Account broadcasts (PRD §17 — "Broadcast capability" per tier).
 * Sends a message to the business owner's followers, metered by tier per
 * calendar month (starter 3, growth 10, enterprise unlimited) with no
 * over-quota paid option — the business already pays a subscription.
 * Mirrors app/(app)/creator/broadcasts/page.tsx's structure/styling.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface Allowance {
  quota: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

interface Broadcast {
  id: string;
  subject: string;
  content: string;
  sentAt: string;
  recipientCount: number;
}

function ComposeModal({
  allowance,
  onSend,
  onClose,
  sending,
}: {
  allowance: Allowance;
  onSend: (subject: string, content: string) => Promise<void>;
  onClose: () => void;
  sending: boolean;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!content.trim()) { setLocalError("Message cannot be empty."); return; }
    await onSend(subject.trim(), content.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ✕
        </button>
        <div className="p-6 pt-5">
          <h2 className="mb-4 text-lg font-bold text-neutral-900 dark:text-neutral-50">
            {t("business.broadcasts.composeTitle", "New Broadcast")}
          </h2>

          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            {allowance.unlimited
              ? t("business.broadcasts.unlimitedNote", "Unlimited broadcasts on your plan.")
              : t("business.broadcasts.remainingNote", { remaining: allowance.remaining, quota: allowance.quota, defaultValue: `${allowance.remaining} of ${allowance.quota} broadcasts left this month.` })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                {t("business.broadcasts.subjectLabel", "Subject")} <span className="font-normal text-neutral-400">({t("business.broadcasts.optional", "optional")})</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                <span>{t("business.broadcasts.contentLabel", "Message")}</span>
                <span className={`tabular-nums ${content.length > 950 ? "text-red-500" : "text-neutral-400"}`}>{content.length}/1000</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            {localError && <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={sending || (!allowance.unlimited && (allowance.remaining ?? 0) <= 0)}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sending ? t("business.broadcasts.sending", "Sending…") : t("business.broadcasts.send", "Send Broadcast")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("business.broadcasts.cancel", "Cancel")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function BusinessBroadcastsPage() {
  const { t } = useTranslation();
  const [tier, setTier] = useState<string>("starter");
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      const res = await fetch("/api/business/broadcasts", { credentials: "include" });
      if (res.status === 404) { setError("You need a business account first."); return; }
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load");
      setTier(json.data.tier);
      setAllowance(json.data.allowance);
      setHistory(json.data.broadcasts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSend(subject: string, content: string) {
    setSending(true);
    try {
      const res = await fetch("/api/business/broadcasts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, content }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Failed to send") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        throw err;
      }
      setComposing(false);
      showToast(t("business.broadcasts.sent", "Broadcast sent!"));
      await load();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to send") : "Failed to send", "error");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-32 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/business" className="text-sm text-neutral-500 hover:underline">← Business</Link>
          <span className="text-neutral-300">/</span>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{t("business.broadcasts.title", "Broadcasts")}</h1>
        </div>
        {allowance && (allowance.unlimited || (allowance.remaining ?? 0) > 0) && (
          <button
            onClick={() => setComposing(true)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("business.broadcasts.newBroadcast", "New Broadcast")}
          </button>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {allowance && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("business.broadcasts.monthlyAllowance", "Monthly allowance")}</h2>
          {allowance.unlimited ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("business.broadcasts.unlimitedNote", "Unlimited broadcasts on your plan.")}</p>
          ) : (
            <>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{allowance.remaining}</span>{" "}
                {t("business.broadcasts.ofQuota", { quota: allowance.quota, defaultValue: `of ${allowance.quota} left` })}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${allowance.quota ? Math.round(((allowance.remaining ?? 0) / allowance.quota) * 100) : 0}%` }}
                />
              </div>
            </>
          )}
          <p className="mt-2 text-xs text-neutral-500 capitalize">{tier} tier</p>
          {!allowance.unlimited && (allowance.remaining ?? 0) <= 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {t("business.broadcasts.upgradeForMore", "Upgrade your tier to send more broadcasts this month.")}{" "}
              <Link href="/settings/business" className="underline">{t("business.broadcasts.upgradeLink", "Upgrade")}</Link>
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("business.broadcasts.historyTitle", "History")}</h2>
        </div>
        {history.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">{t("business.broadcasts.historyEmpty", "No broadcasts sent yet.")}</div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {history.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {b.subject && <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{b.subject}</p>}
                  <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{b.content}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-neutral-400">{new Date(b.sentAt).toLocaleDateString()}</p>
                  <p className="mt-0.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {t("business.broadcasts.recipients", { count: b.recipientCount, defaultValue: `${b.recipientCount} recipients` })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {composing && allowance && (
        <ComposeModal allowance={allowance} onSend={handleSend} onClose={() => setComposing(false)} sending={sending} />
      )}
    </div>
  );
}
