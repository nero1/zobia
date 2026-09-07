"use client";

/**
 * app/(app)/support/[id]/page.tsx
 *
 * Ticket detail/thread — the owning user only (server 404s otherwise, IDOR
 * guard). Offers "This didn't help, talk to a real person" when the ticket
 * is still AI-handled and unresolved-by-human.
 */

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface Message {
  id: string;
  sender_type: "user" | "staff" | "ai";
  body: string;
  charged: boolean;
  charged_credits: number;
  charged_stars: number;
  created_at: string;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  is_ai_handled: boolean;
}

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation();
  const { id } = use(params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/support/tickets/${id}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((json) => {
        if (!json) return;
        setTicket(json.data.ticket);
        setMessages(json.data.messages);
      });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("support.sendFailed", "Failed to send message"));
      setReply("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("support.sendFailed", "Failed to send message"));
    } finally {
      setSending(false);
    }
  }

  async function talkToHuman() {
    await fetch(`/api/support/tickets/${id}/ai-reject`, { method: "POST", credentials: "include" });
    load();
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">{t("support.ticketNotFound", "Ticket not found.")}</p>
      </div>
    );
  }
  if (!ticket) return <div className="mx-auto max-w-2xl p-4"><div className="h-64 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;

  const lastIsAi = messages.length > 0 && messages[messages.length - 1].sender_type === "ai";

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Link href="/support" className="text-sm text-primary-600 hover:underline">&larr; {t("support.myTickets", "My Tickets")}</Link>
      <h1 className="mt-2 mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">{ticket.subject}</h1>
      <p className="mb-4 text-sm text-neutral-500">{t("support.statusLabel", "Status: {{status}}", { status: t(`support.status.${ticket.status}`, ticket.status) })}</p>

      <div className="mb-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id}>
            <div
              className={`rounded-xl p-3 text-sm ${
                m.sender_type === "ai"
                  ? "bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-200"
                  : m.sender_type === "staff"
                  ? "bg-primary-50 text-primary-900 dark:bg-primary-950 dark:text-primary-200"
                  : "ml-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
              }`}
            >
              <p className="mb-1 text-xs font-semibold uppercase opacity-70">
                {m.sender_type === "ai" ? t("support.aiAssistant", "Zobia AI Assistant") : m.sender_type === "staff" ? t("support.staffReply", "Support Team") : t("support.you", "You")}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.charged && <p className="mt-1 text-xs opacity-60">{t("support.chargedNotice", "Charged {{credits}} credits / {{stars}} stars", { credits: m.charged_credits, stars: m.charged_stars })}</p>}
            </div>
          </div>
        ))}
      </div>

      {lastIsAi && ticket.status !== "closed" && (
        <button
          onClick={talkToHuman}
          className="mb-4 w-full rounded-xl border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950"
        >
          {t("support.talkToHuman", "This didn't help — talk to a real person")}
        </button>
      )}

      {ticket.status !== "closed" && (
        <div className="flex gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("support.typeMessage", "Type a message…")}
            rows={3}
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button
            onClick={sendReply}
            disabled={sending || !reply.trim()}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("support.send", "Send")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
