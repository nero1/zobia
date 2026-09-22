"use client";

/**
 * components/classroom/EnrollButton.tsx
 *
 * Enrol in a classroom. Free classrooms enrol in one tap. Paid classrooms
 * open a small chooser: pay with Credits (instant, via the coin ledger) or
 * pay by card (redirects to the Paystack checkout; the webhook completes the
 * enrolment and Paystack returns the member to /c/<slug>?payment=complete).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";

export function EnrollButton({
  roomId,
  feeNgn,
  onEnrolled,
}: {
  roomId: string;
  feeNgn: number;
  onEnrolled: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"balance" | "card" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enrol(paymentMethod: "balance" | "card") {
    setBusy(paymentMethod);
    setError(null);
    try {
      const data = await classroomApi<{ requiresCardPayment?: boolean; paymentUrl?: string }>(`/${roomId}/enroll`, {
        method: "POST",
        body: { paymentMethod },
      });
      if (data.requiresCardPayment && data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      setOpen(false);
      onEnrolled();
    } catch (e) {
      const err = e as ClassroomApiError;
      setError(
        err.code === "INSUFFICIENT_BALANCE"
          ? t("classroom.enroll.insufficient", "You don't have enough Credits. Top up or pay by card.")
          : translateApiError(t, err.code ?? null, err.message || t("classroom.error.enrollFailed", "Enrollment failed"))
      );
    } finally {
      setBusy(null);
    }
  }

  if (feeNgn <= 0) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void enrol("balance")}
          disabled={busy !== null}
          className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {busy ? t("classroom.card.enrolling", "Enrolling…") : t("classroom.enroll.joinFree", "Join for free")}
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
      >
        {t("classroom.enroll.joinPaid", "Enrol · {{amount}} Credits", { amount: feeNgn.toLocaleString() })}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.enroll.modalTitle", "Enrol in this classroom")}</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {t("classroom.enroll.modalBody", "One-time enrolment fee: {{amount}} Credits (₦{{amount}}). You keep access to the community, lessons and recordings.", {
                amount: feeNgn.toLocaleString(),
              })}
            </p>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void enrol("balance")}
                disabled={busy !== null}
                className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {busy === "balance" ? t("classroom.card.enrolling", "Enrolling…") : t("classroom.enroll.payCredits", "Pay with Credits")}
              </button>
              <button
                type="button"
                onClick={() => void enrol("card")}
                disabled={busy !== null}
                className="w-full rounded-xl border border-violet-600 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60 dark:text-violet-300 dark:hover:bg-violet-950"
              >
                {busy === "card" ? t("classroom.enroll.redirecting", "Opening checkout…") : t("classroom.enroll.payCard", "Pay by card")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                {t("classroom.common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
