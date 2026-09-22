"use client";

/**
 * components/classroom/studio/MembersPanel.tsx
 *
 * Member roster (search + filters) with moderator management — the creator
 * promotes any enrolled member (paid or free) to moderator or revokes it —
 * and community mutes (creator + moderators with manageMembers).
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomHomePayload, ClassroomMemberView } from "@/components/classroom/types";

type Filter = "all" | "moderators" | "paid" | "muted";

export function MembersPanel({ home }: { home: ClassroomHomePayload }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roomId = home.classroom.id;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canModerators = home.viewer.can.manageClassroom;

  const members = useQuery({
    queryKey: ["classroom", roomId, "members", search, filter, offset],
    queryFn: () => {
      const p = new URLSearchParams({ filter, offset: String(offset), limit: "50" });
      if (search.trim()) p.set("search", search.trim());
      return classroomApi<{ members: ClassroomMemberView[]; total: number }>(`/${roomId}/members?${p.toString()}`);
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "members"] });
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
  };
  const onErr = (e: unknown) => setMsg({ ok: false, text: translateApiError(t, (e as ClassroomApiError).code, (e as Error).message) });

  const grant = useMutation({
    mutationFn: (m: ClassroomMemberView) => classroomApi(`/${roomId}/moderators`, { method: "POST", body: { userId: m.userId } }),
    onSuccess: (_d, m) => {
      setMsg({ ok: true, text: t("classroom.members.granted", "@{{username}} is now a moderator", { username: m.username }) });
      refresh();
    },
    onError: onErr,
  });
  const revoke = useMutation({
    mutationFn: (m: ClassroomMemberView) => classroomApi(`/${roomId}/moderators/${m.userId}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: onErr,
  });
  const mute = useMutation({
    mutationFn: ({ m, hours }: { m: ClassroomMemberView; hours: number | null }) =>
      classroomApi(`/${roomId}/members/${m.userId}`, { method: "PATCH", body: { muteHours: hours } }),
    onSuccess: refresh,
    onError: onErr,
  });

  const list = members.data?.members ?? [];
  const total = members.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder={t("classroom.members.search", "Search members…")}
          className="min-w-[12rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setOffset(0);
          }}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          <option value="all">{t("classroom.members.filter.all", "All members")}</option>
          <option value="moderators">{t("classroom.members.filter.moderators", "Moderators")}</option>
          <option value="paid">{t("classroom.members.filter.paid", "Paid")}</option>
          <option value="muted">{t("classroom.members.filter.muted", "Muted")}</option>
        </select>
      </div>
      {canModerators && (
        <p className="text-xs text-neutral-500">{t("classroom.members.moderatorHint", "Any member — paid or free — can be made a moderator. Choose what moderators may do in Settings.")}</p>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-teal-600" : "text-red-600"}`}>{msg.text}</p>}
      {members.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-white dark:bg-neutral-900" />
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">{t("classroom.members.empty", "No members match.")}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {list.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="text-2xl">{m.avatarEmoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {m.displayName} <span className="font-normal text-neutral-500">@{m.username}</span>
                </span>
                <span className="block text-[11px] text-neutral-500">
                  {t("classroom.level.short", "Lvl {{level}}", { level: m.level })} · {t("classroom.points.count", "{{count}} pts", { count: m.points })} ·{" "}
                  {t("classroom.members.lessons", "{{count}} lessons done", { count: m.lessonsCompleted })} · {m.paid ? t("classroom.members.paid", "Paid") : t("classroom.card.free", "Free")}
                  {m.isModerator && ` · ${t("classroom.roles.moderator", "Moderator")}`}
                  {m.mutedUntil && ` · ${t("classroom.members.mutedUntil", "Muted until {{date}}", { date: new Date(m.mutedUntil).toLocaleString() })}`}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {canModerators &&
                  (m.isModerator ? (
                    <button type="button" onClick={() => revoke.mutate(m)} className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                      {t("classroom.members.revoke", "Remove moderator")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => grant.mutate(m)} className="rounded-lg border border-sky-400 px-2 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                      {t("classroom.members.makeModerator", "Make moderator")}
                    </button>
                  ))}
                {home.viewer.can.manageMembers && m.userId !== home.viewer.userId && (
                  m.mutedUntil ? (
                    <button type="button" onClick={() => mute.mutate({ m, hours: null })} className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                      {t("classroom.members.unmute", "Unmute")}
                    </button>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => e.target.value && mute.mutate({ m, hours: parseInt(e.target.value, 10) })}
                      className="rounded-lg border border-neutral-300 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                      aria-label={t("classroom.members.mute", "Mute")}
                    >
                      <option value="">{t("classroom.members.mute", "Mute")}…</option>
                      <option value="24">{t("classroom.members.mute24h", "24 hours")}</option>
                      <option value="168">{t("classroom.members.mute7d", "7 days")}</option>
                      <option value="720">{t("classroom.members.mute30d", "30 days")}</option>
                    </select>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > 50 && (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="disabled:opacity-40">
            ← {t("classroom.common.previous", "Previous")}
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, total)} / {total}
          </span>
          <button type="button" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} className="disabled:opacity-40">
            {t("classroom.common.next", "Next")} →
          </button>
        </div>
      )}
    </div>
  );
}
