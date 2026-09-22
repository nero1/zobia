"use client";

/**
 * components/classroom/EventsPanel.tsx
 *
 * The classroom calendar: upcoming live sessions (with a "Join" link to the
 * external meeting — Zoom, Google Meet, Teams, YouTube Live…) and past
 * sessions with a "Watch / download recording" link once the creator or a
 * moderator attaches one. Meeting/recording links are member-only (the API
 * omits them for visitors). With `canManage`, sessions can be scheduled,
 * edited, cancelled and given a recording link.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomEventView } from "@/components/classroom/types";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface Draft {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string;
  recordingUrl: string;
}

const EMPTY: Draft = { title: "", description: "", startsAt: "", endsAt: "", meetingUrl: "", recordingUrl: "" };

function EventForm({
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  error: string | null;
  onSubmit: (d: Draft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<Draft>(initial);
  const field = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      <input className={field} value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder={t("classroom.events.titlePlaceholder", "Session title")} />
      <textarea className={field} rows={2} value={d.description} maxLength={2000} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder={t("classroom.events.descriptionPlaceholder", "What will you cover? (optional)")} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-neutral-500">
          {t("classroom.events.startsAt", "Starts")}
          <input type="datetime-local" className={`mt-1 ${field}`} value={d.startsAt} onChange={(e) => setD({ ...d, startsAt: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-neutral-500">
          {t("classroom.events.endsAt", "Ends (optional)")}
          <input type="datetime-local" className={`mt-1 ${field}`} value={d.endsAt} onChange={(e) => setD({ ...d, endsAt: e.target.value })} />
        </label>
      </div>
      <input className={field} value={d.meetingUrl} onChange={(e) => setD({ ...d, meetingUrl: e.target.value })} placeholder={t("classroom.events.meetingUrlPlaceholder", "Meeting link — Zoom, Google Meet, Teams… (https://)")} />
      <input className={field} value={d.recordingUrl} onChange={(e) => setD({ ...d, recordingUrl: e.target.value })} placeholder={t("classroom.events.recordingUrlPlaceholder", "Recording link, after the session (https://)")} />
      <p className="text-[11px] text-neutral-500">
        {t("classroom.events.linksHint", "Links are only shown to members. Host recordings on Zoom cloud, YouTube (unlisted), Google Drive or similar and paste the share/download link.")}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !d.title.trim() || !d.startsAt}
          onClick={() => onSubmit(d)}
          className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("classroom.common.save", "Save")}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700 dark:text-neutral-200">
          {t("classroom.common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}

export function EventsPanel({ roomId, canManage, isMember }: { roomId: string; canManage: boolean; isMember: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ["classroom", roomId, "events"],
    queryFn: () => classroomApi<{ events: ClassroomEventView[] }>(`/${roomId}/events?scope=all`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "events"] });
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
  };
  const onErr = (e: unknown) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message));

  const toBody = (d: Draft) => ({
    title: d.title.trim(),
    description: d.description.trim() || null,
    startsAt: fromLocalInput(d.startsAt),
    endsAt: fromLocalInput(d.endsAt),
    meetingUrl: d.meetingUrl.trim() || null,
    recordingUrl: d.recordingUrl.trim() || null,
  });

  const create = useMutation({
    mutationFn: (d: Draft) => classroomApi(`/${roomId}/events`, { method: "POST", body: toBody(d) }),
    onSuccess: () => {
      setCreating(false);
      setError(null);
      refresh();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) => classroomApi(`/${roomId}/events/${id}`, { method: "PATCH", body: toBody(d) }),
    onSuccess: () => {
      setEditingId(null);
      setError(null);
      refresh();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => classroomApi(`/${roomId}/events/${id}`, { method: "DELETE" }),
    onSettled: refresh,
  });

  const list = events.data?.events ?? [];
  const upcoming = list.filter((e) => e.status !== "ended");
  const past = list.filter((e) => e.status === "ended").reverse();

  const renderEvent = (e: ClassroomEventView) =>
    editingId === e.id ? (
      <EventForm
        key={e.id}
        initial={{
          title: e.title,
          description: e.description ?? "",
          startsAt: toLocalInput(e.startsAt),
          endsAt: toLocalInput(e.endsAt),
          meetingUrl: e.meetingUrl ?? "",
          recordingUrl: e.recordingUrl ?? "",
        }}
        busy={update.isPending}
        error={error}
        onSubmit={(d) => update.mutate({ id: e.id, d })}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <div key={e.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900 dark:text-neutral-50">{e.title}</p>
            <p className="text-xs text-neutral-500">
              {new Date(e.startsAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {e.endsAt ? ` – ${new Date(e.endsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          {e.status === "live" && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
              ● {t("classroom.events.live", "Live now")}
            </span>
          )}
        </div>
        {e.description && <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">{e.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {e.status !== "ended" &&
            (e.meetingUrl ? (
              <a href={e.meetingUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
                {t("classroom.events.join", "Join session ↗")}
              </a>
            ) : e.hasMeetingUrl && !isMember ? (
              <span className="text-xs text-neutral-500">{t("classroom.events.membersOnlyLink", "Enrol to get the meeting link")}</span>
            ) : null)}
          {e.recordingUrl ? (
            <a href={e.recordingUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-violet-600 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950">
              🎬 {t("classroom.events.recording", "Watch / download recording")}
            </a>
          ) : e.hasRecording && !isMember ? (
            <span className="text-xs text-neutral-500">{t("classroom.events.membersOnlyRecording", "Recording available to members")}</span>
          ) : e.status === "ended" ? (
            <span className="text-xs text-neutral-400">{t("classroom.events.noRecording", "No recording yet")}</span>
          ) : null}
          {canManage && (
            <>
              <button type="button" onClick={() => setEditingId(e.id)} className="text-xs text-neutral-500 hover:text-violet-600">
                {e.status === "ended" && !e.hasRecording ? t("classroom.events.addRecording", "Add recording") : t("classroom.feed.edit", "Edit")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("classroom.events.deleteConfirm", "Cancel this session?"))) remove.mutate(e.id);
                }}
                className="text-xs text-neutral-500 hover:text-red-600"
              >
                {t("classroom.feed.delete", "Delete")}
              </button>
            </>
          )}
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      {canManage &&
        (creating ? (
          <EventForm initial={EMPTY} busy={create.isPending} error={error} onSubmit={(d) => create.mutate(d)} onCancel={() => setCreating(false)} />
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400">
            {t("classroom.events.schedule", "+ Schedule a live session")}
          </button>
        ))}
      {events.isPending ? (
        <div className="h-20 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
      ) : list.length === 0 ? (
        <div className="py-10 text-center">
          <span className="text-4xl">📅</span>
          <p className="mt-2 text-sm text-neutral-500">{t("classroom.events.empty", "No live sessions scheduled yet.")}</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.events.upcoming", "Upcoming")}</h3>
              {upcoming.map(renderEvent)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.events.past", "Past sessions")}</h3>
              {past.map(renderEvent)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
