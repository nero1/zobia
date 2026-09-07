"use client";

/**
 * app/(admin)/gate44/support/queue/page.tsx
 *
 * Staff ticket queue — filterable by status. Access is enforced server-side
 * by /api/admin/support/tickets (requireSupportStaff), so a non-staff visitor
 * simply sees the "not authorized" state below rather than an admin gate —
 * this page is reachable by support/moderator/admin per x_manifest config,
 * not admin-only.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

type TicketStatus = "open" | "pending" | "escalated" | "resolved" | "closed";

interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  assigned_to: string | null;
  is_ai_handled: boolean;
  message_count: number;
  last_activity_at: string;
}

const STATUS_TAB_VALUES: (TicketStatus | "all")[] = ["all", "open", "pending", "escalated", "resolved", "closed"];

const STATUS_BADGE: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  escalated: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  resolved: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export default function AdminSupportQueuePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TicketStatus | "all">("open");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const load = useCallback((status: TicketStatus | "all") => {
    setLoading(true);
    const qs = status === "all" ? "" : `?status=${status}`;
    fetch(`/api/admin/support/tickets${qs}`, { credentials: "include" })
      .then((r) => {
        setAuthorized(r.ok);
        return r.ok ? r.json() : null;
      })
      .then((json) => setTickets(json?.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  if (authorized === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">{t("support.admin.notAuthorized", "Not authorized")}</p>
        <p className="mt-1 text-sm text-neutral-500">{t("support.admin.notAuthorizedDetail", "Your account isn't in a support-staff role, or Support Tickets is disabled.")}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("support.admin.queueTitle", "Support Ticket Queue")}</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TAB_VALUES.map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === value
                ? "bg-primary-600 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {value === "all" ? t("support.admin.tabAll", "All") : t(`support.status.${value}`, value)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">{t("support.admin.noTicketsInView", "No tickets in this view.")}</p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {tickets.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/gate44/support/tickets/${ticket.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">{ticket.subject}</p>
                <p className="text-xs text-neutral-500">
                  {t("support.messageCount", "{{count}} message", { count: ticket.message_count })} · {ticket.is_ai_handled ? t("support.admin.aiTriaged", "AI-triaged") : t("support.admin.human", "Human")} · {new Date(ticket.last_activity_at).toLocaleString()}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[ticket.status]}`}>{t(`support.status.${ticket.status}`, ticket.status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
