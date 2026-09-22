"use client";

/**
 * components/classroom/studio/ReportsPanel.tsx
 *
 * Report queue for one classroom (creator + moderators with handleReports).
 * "Remove" hides the reported content (a moderator can unhide it from the
 * feed); "Dismiss" closes the report. When `adminBase` is given it drives
 * the platform-wide /gate44 queue instead.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomReportView } from "@/components/classroom/types";

type ReportWithRoom = ClassroomReportView & { room?: { id: string; name: string; slug: string | null } };

export function ReportsPanel({ roomId, admin = false }: { roomId?: string; admin?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [scope, setScope] = useState<"pending" | "resolved" | "escalated">(admin ? "escalated" : "pending");
  const [error, setError] = useState<string | null>(null);
  const key = ["classroom", admin ? "admin" : roomId, "reports", scope];

  const reports = useQuery({
    queryKey: key,
    queryFn: () =>
      admin
        ? classroomApi<{ reports: ReportWithRoom[] }>(`/api/admin/classrooms/reports?scope=${scope}`)
        : classroomApi<{ reports: ReportWithRoom[] }>(`/${roomId}/reports?status=${scope === "resolved" ? "resolved" : "pending"}`),
  });

  const resolve = useMutation({
    mutationFn: ({ r, action }: { r: ReportWithRoom; action: "remove" | "dismiss" }) =>
      admin
        ? classroomApi(`/api/admin/classrooms/reports/${r.id}`, { method: "PATCH", body: { action } })
        : classroomApi(`/${roomId}/reports/${r.id}`, { method: "PATCH", body: { action } }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["classroom", admin ? "admin" : roomId, "reports"] });
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  const scopes: Array<"escalated" | "pending" | "resolved"> = admin ? ["escalated", "pending", "resolved"] : ["pending", "resolved"];
  const list = reports.data?.reports ?? [];

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {scopes.map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${scope === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
          >
            {t(`classroom.reports.scope.${s}`, s === "escalated" ? "Escalated" : s === "pending" ? "Pending" : "Resolved")}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {reports.isPending ? (
        <div className="h-32 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">{t("classroom.reports.empty", "Nothing to review. 🎉")}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                <span>
                  <span className="font-semibold text-red-600">{t(`classroom.report.reasons.${r.reason}`, r.reason.replace(/_/g, " "))}</span> ·{" "}
                  {r.target.kind === "post" ? t("classroom.reports.post", "Post") : t("classroom.reports.comment", "Comment")} {t("classroom.reports.by", "by @{{username}}", { username: r.target.author.username })} ·{" "}
                  {t("classroom.reports.reportedBy", "reported by @{{username}}", { username: r.reporter.username })}
                  {r.escalated && <span className="ml-1 rounded bg-red-100 px-1 font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{t("classroom.reports.escalatedBadge", "Escalated")}</span>}
                </span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              {admin && r.room && (
                <a href={`/c/${r.room.slug ?? r.room.id}`} className="mt-1 block text-xs text-violet-600 hover:underline">
                  {r.room.name}
                </a>
              )}
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{r.target.body}</p>
              {r.details && <p className="mt-1 text-xs italic text-neutral-500">“{r.details}”</p>}
              {r.status === "pending" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => resolve.mutate({ r, action: "remove" })} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">
                    {t("classroom.reports.remove", "Remove content")}
                  </button>
                  <button type="button" onClick={() => resolve.mutate({ r, action: "dismiss" })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold dark:border-neutral-700 dark:text-neutral-200">
                    {t("classroom.reports.dismiss", "Dismiss")}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">
                  {r.status === "resolved_removed" ? t("classroom.reports.removed", "Content removed") : t("classroom.reports.dismissed", "Dismissed")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
