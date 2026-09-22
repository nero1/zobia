"use client";

/**
 * components/classroom/ReportButton.tsx
 *
 * Report a classroom post or comment to the classroom's creator/moderators
 * (POST /api/classroom/:roomId/reports). Three reports on the same item
 * escalate it to platform staff automatically.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";

const REASONS = ["spam", "harassment", "hate_speech", "sexual_content", "misinformation", "scam", "off_topic", "other"] as const;

export function ReportButton({ roomId, target }: { roomId: string; target: { postId?: string; commentId?: string } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await classroomApi(`/${roomId}/reports`, { method: "POST", body: { ...target, reason, details: details.trim() || null } });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1500);
    } catch (e) {
      const err = e as ClassroomApiError;
      setError(translateApiError(t, err.code, err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-neutral-400 hover:text-red-500">
        {t("classroom.report.button", "Report")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.report.title", "Report content")}</h2>
            {done ? (
              <p className="mt-3 text-sm text-teal-600">{t("classroom.report.thanks", "Thanks — the classroom moderators will review it.")}</p>
            ) : (
              <>
                <label className="mt-3 block text-xs font-semibold text-neutral-500">{t("classroom.report.reasonLabel", "Reason")}</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`classroom.report.reasons.${r}`, r.replace(/_/g, " "))}
                    </option>
                  ))}
                </select>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={t("classroom.report.detailsPlaceholder", "Anything moderators should know? (optional)")}
                  className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm dark:border-neutral-700 dark:text-neutral-200">
                    {t("classroom.common.cancel", "Cancel")}
                  </button>
                  <button
                    onClick={() => void submit()}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {t("classroom.report.submit", "Submit report")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
