"use client";

/**
 * components/classroom/LessonsPanel.tsx
 *
 * The "Classroom" tab: the curriculum as a lesson list with progress,
 * level-locked lessons (Skool-style unlocks), and a lesson reader with the
 * server-sanitized lesson body, video link and resources. Members mark
 * lessons complete (classroom points + a Knowledge XP bonus).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload, ModuleView } from "@/components/classroom/types";

export function LessonsPanel({ home, levelName }: { home: ClassroomHomePayload; levelName: (level: number) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insider = home.viewer.can.viewMemberContent;

  const toggle = useMutation({
    mutationFn: (m: ModuleView) =>
      classroomApi<{ pointsAwarded?: number; leveledUp?: boolean; newBadges?: string[] }>(`/${roomId}/lessons/${m.id}/complete`, {
        method: m.completed ? "DELETE" : "POST",
      }),
    onSuccess: (data, m) => {
      setError(null);
      if (!m.completed && data.pointsAwarded) {
        setNotice(
          data.leveledUp
            ? t("classroom.lessons.leveledUp", "Lesson complete! +{{points}} points — you levelled up 🎉", { points: data.pointsAwarded })
            : t("classroom.lessons.completedPoints", "Lesson complete! +{{points}} points", { points: data.pointsAwarded })
        );
        setTimeout(() => setNotice(null), 3500);
      }
      void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  if (home.modules.length === 0) {
    return (
      <div className="py-12 text-center">
        <span className="text-4xl">📚</span>
        <p className="mt-2 text-sm text-neutral-500">{t("classroom.card.noModules", "No modules yet.")}</p>
      </div>
    );
  }

  const open = home.modules.find((m) => m.id === openId) ?? null;

  return (
    <div className="space-y-3">
      {home.progress && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span>
              {t("classroom.card.lessonsProgress", "{{completed}} / {{total}} lessons", {
                completed: home.progress.completed,
                total: home.progress.total,
              })}
            </span>
            <span>{home.progress.total > 0 ? Math.round((home.progress.completed / home.progress.total) * 100) : 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${home.progress.total > 0 ? Math.round((home.progress.completed / home.progress.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}
      {notice && <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{notice}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <ol className="space-y-2">
        {home.modules.map((m, i) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === m.id ? null : m.id)}
              className={`flex w-full items-start gap-3 rounded-xl border bg-white p-3 text-left dark:bg-neutral-900 ${
                openId === m.id ? "border-violet-300 dark:border-violet-800" : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  m.completed
                    ? "bg-teal-500 text-white"
                    : m.locked
                      ? "bg-neutral-200 text-neutral-500 dark:bg-neutral-700"
                      : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                }`}
              >
                {m.completed ? "✓" : m.locked ? "🔒" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-50">{m.title}</span>
                {m.description && <span className="mt-0.5 block text-xs text-neutral-500 line-clamp-2">{m.description}</span>}
                {m.locked && (
                  <span className="mt-1 block text-[11px] font-semibold text-neutral-500">
                    {!insider
                      ? t("classroom.lessons.enrolToUnlock", "Enrol to unlock this lesson")
                      : t("classroom.lessons.unlocksAt", "Unlocks at level {{level}} ({{name}})", {
                          level: m.unlockLevel ?? 1,
                          name: levelName(m.unlockLevel ?? 1),
                        })}
                  </span>
                )}
              </span>
            </button>
            {open && open.id === m.id && !m.locked && (
              <div className="mt-2 space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                {m.videoUrl && (
                  <a
                    href={m.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    ▶ {t("classroom.lessons.watchVideo", "Watch lesson video")}
                  </a>
                )}
                {m.contentHtml ? (
                  // Sanitized server-side (lib/classroom/curriculum.ts → sanitizeBlogPostHtml).
                  // eslint-disable-next-line react/no-danger
                  <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: m.contentHtml }} />
                ) : (
                  !m.videoUrl && <p className="text-sm text-neutral-500">{t("classroom.lessons.noContent", "This lesson has no written content yet.")}</p>
                )}
                {m.resources && m.resources.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.lessons.resources", "Resources")}</p>
                    <ul className="mt-1 space-y-1">
                      {m.resources.map((r) => (
                        <li key={r}>
                          <a href={r} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-violet-600 hover:underline dark:text-violet-400">
                            {r}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {home.viewer.can.completeLessons && (
                  <button
                    type="button"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(m)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
                      m.completed
                        ? "border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                        : "bg-teal-600 text-white hover:bg-teal-700"
                    }`}
                  >
                    {m.completed ? t("classroom.lessons.markIncomplete", "Mark as not done") : t("classroom.lessons.markComplete", "Mark complete")}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
