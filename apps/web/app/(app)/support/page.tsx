"use client";

/**
 * app/(app)/support/page.tsx
 *
 * "My Tickets" — the user's own support tickets. Works standalone-installed
 * (PWA) and is mirrored in apps/android against the same API.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface Ticket {
  id: string;
  subject: string;
  status: "open" | "pending" | "escalated" | "resolved" | "closed";
  is_ai_handled: boolean;
  message_count: number;
  last_activity_at: string;
}

const STATUS_BADGE: Record<Ticket["status"], string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  escalated: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  resolved: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export default function MyTicketsPage() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    fetch("/api/support/tickets", { credentials: "include" })
      .then((r) => {
        if (r.status === 503) { setDisabled(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((json) => setTickets(json?.data ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("support.myTickets", "My Tickets")}</h1>
        {!disabled && (
          <Link href="/support/new" className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            {t("support.newTicket", "New Ticket")}
          </Link>
        )}
      </div>

      {disabled ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {t("support.unavailable", "Support tickets aren't available right now. Try the")} <Link href="/help" className="text-primary-600 hover:underline">{t("help.title", "Help Center")}</Link> {t("support.unavailableSuffix", "instead.")}
        </p>
      ) : tickets === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {t("support.noTicketsPrompt", "No tickets yet. Need help?")} <Link href="/support/new" className="text-primary-600 hover:underline">{t("help.openTicket", "Open a support ticket")}</Link>.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {tickets.map((ticket) => (
            <Link key={ticket.id} href={`/support/${ticket.id}`} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">{ticket.subject}</p>
                <p className="text-xs text-neutral-500">{t("support.messageCount", "{{count}} message", { count: ticket.message_count })} · {new Date(ticket.last_activity_at).toLocaleString()}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[ticket.status]}`}>{t(`support.status.${ticket.status}`, ticket.status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
