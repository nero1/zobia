/**
 * components/classroom/types.ts
 *
 * Type-only re-exports of the classroom API payloads for client components
 * (the server modules they come from are never bundled — `export type` is
 * erased at compile time).
 */

import type { TFunction } from "i18next";

export type { ClassroomHomePayload } from "@/lib/classroom/home";
export type { ClassroomPostView, ClassroomCommentView, ClassroomReportView } from "@/lib/classroom/community";
export type { ClassroomEventView } from "@/lib/classroom/events";
export type { ModuleView } from "@/lib/classroom/curriculum";
export type { ClassroomLeaderboardEntry, MemberStanding, LeaderboardPeriod } from "@/lib/classroom/gamification";
export type { ClassroomMemberView, ClassroomModeratorView } from "@/lib/classroom/members";
export type { ClassroomStats, StudioSummary, StudioClassroomRow } from "@/lib/classroom/stats";
export type { SlugChangeQuote, SlugHistoryEntry, SlugAvailability } from "@/lib/classroom/slug";
export type { ClassroomSettings, SlugPolicy, ModeratorPermissions } from "@/lib/classroom/settings";
export type { ClassroomBadgeDef, ClassroomBadgeKey } from "@/lib/classroom/levels";
export type { ClassroomCard } from "@/lib/classroom/directory";

/** Shared relative-time formatter for classroom lists. */
export function timeAgo(iso: string, t: TFunction): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t("classroom.time.now", "just now");
  if (mins < 60) return t("classroom.time.minutes", "{{count}}m", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("classroom.time.hours", "{{count}}h", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("classroom.time.days", "{{count}}d", { count: days });
  return new Date(iso).toLocaleDateString();
}
