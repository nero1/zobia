"use client";

/**
 * components/classroom/studio/PublishBar.tsx
 *
 * Shown at the top of Classroom Studio while the classroom is still a draft
 * (never published). Classrooms are created unpublished by default so
 * creators can build curriculum, pricing and settings in their own time —
 * this is the one explicit action that makes it discoverable and enrollable.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload } from "@/components/classroom/types";

export function PublishBar({ home }: { home: ClassroomHomePayload }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const c = home.classroom;
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () =>
      classroomApi(`/${c.id}`, {
        method: "PATCH",
        body: { isPublic: true, showInCreatorListing: listed },
      }),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["classroom", c.id] });
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  if (c.publishedAt) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            {t("classroom.publish.draftTitle", "This classroom is a draft")}
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("classroom.publish.draftBody", "Only you (and any moderators) can see it. Publish when it's ready for the world.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          {t("classroom.publish.button", "Publish")}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">
              {t("classroom.publish.modalTitle", "Publish this classroom")}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {t("classroom.publish.modalBody", "It will become visible at /c/{{slug}} and enrollable by anyone.", {
                slug: c.slug ?? c.id,
              })}
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
              {t("classroom.publish.listOnProfile", "List this classroom on my profile")}
            </label>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={publish.isPending}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("classroom.common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => publish.mutate()}
                disabled={publish.isPending}
                className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {publish.isPending ? t("classroom.publish.publishing", "Publishing…") : t("classroom.publish.confirm", "Publish now")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
