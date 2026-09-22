"use client";

/**
 * components/classroom/studio/CurriculumPanel.tsx
 *
 * Full CRUD on a classroom's lessons (PUT/POST/PATCH/DELETE
 * /api/classroom/:id/modules): title, description, Markdown content, video
 * link, resource links, level unlock (Skool-style), and reordering.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload, ModuleView } from "@/components/classroom/types";

interface Draft {
  title: string;
  description: string;
  content: string;
  videoUrl: string;
  resources: string;
  unlockLevel: number;
}

const toDraft = (m?: ModuleView): Draft => ({
  title: m?.title ?? "",
  description: m?.description ?? "",
  content: m?.content ?? "",
  videoUrl: m?.videoUrl ?? "",
  resources: (m?.resources ?? []).join("\n"),
  unlockLevel: m?.unlockLevel ?? 1,
});

function ModuleForm({ initial, busy, onSave, onCancel, levelName }: { initial: Draft; busy: boolean; onSave: (d: Draft) => void; onCancel: () => void; levelName: (l: number) => string }) {
  const { t } = useTranslation();
  const [d, setD] = useState(initial);
  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      <input className={field} value={d.title} maxLength={200} placeholder={t("classroom.module.titlePlaceholder", "e.g. Introduction to JavaScript")} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <textarea className={field} rows={2} value={d.description} maxLength={1000} placeholder={t("classroom.module.descriptionPlaceholder", "Briefly describe this module…")} onChange={(e) => setD({ ...d, description: e.target.value })} />
      <textarea className={`${field} font-mono`} rows={8} value={d.content} maxLength={20000} placeholder={t("classroom.module.contentPlaceholder", "Lesson content (Markdown supported)")} onChange={(e) => setD({ ...d, content: e.target.value })} />
      <input className={field} value={d.videoUrl} placeholder={t("classroom.module.videoPlaceholder", "Video link (YouTube, Vimeo, Loom…) — optional")} onChange={(e) => setD({ ...d, videoUrl: e.target.value })} />
      <textarea className={field} rows={2} value={d.resources} placeholder={t("classroom.module.resourcesLabel", "Resources (optional, one URL per line)")} onChange={(e) => setD({ ...d, resources: e.target.value })} />
      <label className="block text-xs text-neutral-500">
        {t("classroom.module.unlockLevel", "Unlocks at level")}
        <select className={`mt-1 ${field}`} value={d.unlockLevel} onChange={(e) => setD({ ...d, unlockLevel: parseInt(e.target.value, 10) })}>
          {Array.from({ length: 9 }).map((_, i) => (
            <option key={i} value={i + 1}>
              {i === 0 ? t("classroom.module.unlockEveryone", "Everyone (level 1)") : `${i + 1} · ${levelName(i + 1)}`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !d.title.trim()} onClick={() => onSave(d)} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? t("classroom.module.saving", "Saving…") : t("classroom.common.save", "Save")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700 dark:text-neutral-200">
          {t("classroom.module.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}

export function CurriculumPanel({ home, levelName }: { home: ClassroomHomePayload; levelName: (l: number) => string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
  const onErr = (e: unknown) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message));

  const body = (d: Draft) => ({
    title: d.title.trim(),
    description: d.description.trim() || undefined,
    content: d.content.trim() || undefined,
    videoUrl: d.videoUrl.trim() || "",
    resources: d.resources
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean),
    unlockLevel: d.unlockLevel,
  });

  const add = useMutation({
    mutationFn: (d: Draft) => classroomApi(`/${roomId}/modules`, { method: "POST", body: body(d) }),
    onSuccess: () => {
      setAdding(false);
      setError(null);
      refresh();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) => classroomApi(`/${roomId}/modules`, { method: "PATCH", body: { id, ...body(d) } }),
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => classroomApi(`/${roomId}/modules`, { method: "DELETE", body: { id } }),
    onSuccess: refresh,
    onError: onErr,
  });
  const reorder = useMutation({
    mutationFn: (order: string[]) => classroomApi(`/${roomId}/modules`, { method: "PUT", body: { order } }),
    onSuccess: refresh,
    onError: onErr,
  });

  const move = (idx: number, dir: -1 | 1) => {
    const ids = home.modules.map((m) => m.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ol className="space-y-2">
        {home.modules.map((m, i) =>
          editing === m.id ? (
            <li key={m.id}>
              <ModuleForm initial={toDraft(m)} busy={update.isPending} levelName={levelName} onSave={(d) => update.mutate({ id: m.id, d })} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={m.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <span className="mt-0.5 w-6 text-center text-sm font-bold text-neutral-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-50">{m.title}</span>
                <span className="block text-[11px] text-neutral-500">
                  {m.videoUrl ? "▶ " : ""}
                  {m.content ? t("classroom.module.hasContent", "Written lesson") : t("classroom.module.noContent", "No written content")}
                  {m.resources?.length ? ` · ${t("classroom.card.resourceCount", "{{count}} resource(s)", { count: m.resources.length })}` : ""}
                  {m.unlockLevel && m.unlockLevel > 1 ? ` · 🔒 ${t("classroom.level.number", "Level {{level}}", { level: m.unlockLevel })}` : ""}
                </span>
              </span>
              <span className="flex flex-shrink-0 gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-neutral-400 disabled:opacity-30" aria-label={t("classroom.module.moveUp", "Move up")}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === home.modules.length - 1} className="px-1 text-neutral-400 disabled:opacity-30" aria-label={t("classroom.module.moveDown", "Move down")}>
                  ↓
                </button>
                <button type="button" onClick={() => setEditing(m.id)} className="rounded px-2 py-1 text-xs text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950">
                  {t("classroom.feed.edit", "Edit")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("classroom.module.deleteConfirm", "Delete this module?"))) remove.mutate(m.id);
                  }}
                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  {t("classroom.module.delete", "Delete")}
                </button>
              </span>
            </li>
          )
        )}
      </ol>
      {adding ? (
        <ModuleForm initial={toDraft()} busy={add.isPending} levelName={levelName} onSave={(d) => add.mutate(d)} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400">
          {t("classroom.card.addModule", "+ Add Module")}
        </button>
      )}
    </div>
  );
}
