"use client";

/**
 * app/(app)/support/new/page.tsx
 *
 * Create a new support ticket. Shows the eligibility/cost up front
 * (GET /api/support/eligibility) so the user knows before they type whether
 * this is free or will charge them, then submits via POST /api/support/tickets.
 *
 * Also used as the target of "Contact a real person" from a Help Center Ask
 * AI answer — ?prefillSubject= / ?prefillBody= / ?docId= query params
 * pre-populate the form (Feature 2 §6).
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface Eligibility {
  freeAccess: boolean;
  costCredits: number;
  costStars: number;
  blocked: boolean;
  supportTicketsEnabled: boolean;
}

function NewTicketForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const search = useSearchParams();
  const [subject, setSubject] = useState(search.get("prefillSubject") ?? "");
  const [message, setMessage] = useState(search.get("prefillBody") ?? "");
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/support/eligibility", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setEligibility(json?.data ?? null));
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          firstMessage: message,
          source: search.get("docId") ? "help_center_ai" : "ticket",
          sourceHelpDocId: search.get("docId") ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("support.createFailed", "Failed to create ticket"));
      router.push(`/support/${json.data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("support.createFailed", "Failed to create ticket"));
    } finally {
      setSubmitting(false);
    }
  }

  if (eligibility?.supportTicketsEnabled === false) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {t("support.unavailable", "Support tickets aren't available right now. Try the")} <Link href="/help" className="text-primary-600 hover:underline">{t("help.title", "Help Center")}</Link>.
        </p>
      </div>
    );
  }

  const costAmount = [
    eligibility && eligibility.costCredits > 0 ? `${eligibility.costCredits} credits` : null,
    eligibility && eligibility.costStars > 0 ? `${eligibility.costStars} stars` : null,
  ].filter(Boolean).join(" or ");

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("support.newTicketTitle", "New Support Ticket")}</h1>

      {eligibility && !eligibility.freeAccess && (
        eligibility.blocked ? (
          <p className="mb-4 text-sm text-red-600">{t("support.blockedNotice", "Support tickets aren't available on your current plan.")}</p>
        ) : (
          <p className="mb-4 text-sm text-neutral-500">
            {t("support.costNotice", "This will cost {{amount}}.", { amount: costAmount })}
          </p>
        )
      )}

      <div className="space-y-3">
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("support.subject", "Subject")}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("support.describeIssue", "Describe your issue…")}
          rows={6}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={submit}
          disabled={submitting || !subject.trim() || !message.trim() || eligibility?.blocked}
          className="w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t("support.submitting", "Submitting…") : t("support.submitTicket", "Submit Ticket")}
        </button>
      </div>
    </div>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-lg p-4"><div className="h-64 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>}>
      <NewTicketForm />
    </Suspense>
  );
}
