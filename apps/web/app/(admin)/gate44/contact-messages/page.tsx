"use client";

/**
 * app/(admin)/gate44/contact-messages/page.tsx
 *
 * Admin inbox for the site-wide Contact Us page (app/contact) —
 * mirrors app/(app)/blogs/dashboard/messages/page.tsx's list + mark-read
 * shape, the closest existing precedent for "a visitor sends a message that
 * someone should see in an inbox".
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatShortDate } from "@/lib/format/date";

interface MessageRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  subject: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export default function AdminContactMessagesPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/contact-messages", { credentials: "include" });
      const json = await res.json().catch(() => null);
      setMessages(json?.data?.messages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markRead(id: string) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)));
    await fetch(`/api/admin/contact-messages/${id}`, { method: "PATCH", credentials: "include" });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {t("admin.contactMessages.title", "Contact Messages")}
      </h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {t("admin.contactMessages.hint", "Submissions from the site-wide Contact Us page.")}
      </p>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse" />)}</div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("admin.contactMessages.empty", "No messages yet.")}</p>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-xl border p-3 ${m.is_read ? "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" : "border-primary-400/60 bg-primary-50 dark:border-primary-500/40 dark:bg-primary-950/20"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {m.sender_username ? `@${m.sender_username}` : m.sender_name || t("admin.contactMessages.anonymous", "Anonymous")}
                  {m.sender_email && <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">{m.sender_email}</span>}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatShortDate(m.created_at)}</span>
              </div>
              {m.subject && <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{m.subject}</p>}
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{m.message}</p>
              {!m.is_read && (
                <button onClick={() => markRead(m.id)} className="mt-2 rounded-lg bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-700 dark:bg-neutral-700 dark:hover:bg-neutral-600">
                  {t("admin.contactMessages.markRead", "Mark as read")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
