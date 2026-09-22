"use client";

/**
 * app/(app)/classroom/page.tsx
 *
 * Classroom hub.
 *   - Discover: searchable directory of public classrooms
 *     (GET /api/classroom/directory — text search, category chips, free/paid
 *     filter, popular/new sort; boosted classrooms first).
 *   - Enrolled: the classrooms the viewer belongs to, with lesson progress and
 *     their level in each classroom (GET /api/classroom/enrolled).
 *   - Quick links to the viewer's own "My Classrooms" listing, the Creator
 *     Studio, and the create flow.
 *
 * Every card opens the classroom homepage at /c/<slug>. Data goes through
 * React Query, so the last-seen lists are persisted per user
 * (lib/offline/queryPersist.ts) and render instantly/offline.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import type { ClassroomCard as ClassroomCardData } from "@/lib/classroom/directory";
import { ClassroomCard } from "@/components/classroom/ClassroomCard";

interface EnrolledClassroom {
  id: string;
  slug: string | null;
  title: string;
  coverEmoji: string;
  creatorName: string;
  category: string;
  lessonCount: number;
  completedLessons: number;
  quizScore: number | null;
  points: number;
  level: number;
  isActive: boolean;
  lastActivityAt: string | null;
}

type Tab = "discover" | "enrolled";
type Price = "all" | "free" | "paid";
type Sort = "popular" | "new";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      ))}
    </div>
  );
}

function EnrolledRow({ room }: { room: EnrolledClassroom }) {
  const { t } = useTranslation();
  const pct = room.lessonCount > 0 ? Math.round((room.completedLessons / room.lessonCount) * 100) : 0;
  return (
    <Link
      href={`/c/${room.slug ?? room.id}`}
      className="block rounded-xl border border-neutral-200 bg-white p-4 shadow-card hover:border-violet-300 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-3xl">{room.coverEmoji}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-neutral-900 dark:text-neutral-50">{room.title}</p>
            <p className="text-xs text-neutral-500">{t("classroom.card.by", "By {{name}}", { name: room.creatorName })}</p>
          </div>
        </div>
        <span className="flex-shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          {t("classroom.level.short", "Lvl {{level}}", { level: room.level })} · {t("classroom.points.count", "{{count}} pts", { count: room.points })}
        </span>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>{t("classroom.card.lessonsProgress", "{{completed}} / {{total}} lessons", { completed: room.completedLessons, total: room.lessonCount })}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {room.quizScore !== null && (
        <p className="mt-2 text-xs text-neutral-500">{t("classroom.card.bestQuiz", "Best quiz score: {{score}}%", { score: room.quizScore })}</p>
      )}
      {!room.isActive && <p className="mt-1 text-xs text-amber-600">{t("classroom.card.archivedNotice", "This classroom is archived.")}</p>}
    </Link>
  );
}

export default function ClassroomPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("discover");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [price, setPrice] = useState<Price>("all");
  const [sort, setSort] = useState<Sort>("popular");
  const q = useDebounced(search.trim(), 300);

  const me = useQuery({
    queryKey: ["me", "username"],
    queryFn: async () => {
      const res = await fetch("/api/users/me", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as { user?: { id?: string; username?: string } } | null;
      return { id: json?.user?.id ?? null, username: json?.user?.username ?? null };
    },
    staleTime: 5 * 60_000,
  });

  const directory = useQuery({
    queryKey: ["classroom", "directory", q, category, price, sort],
    queryFn: () => {
      const params = new URLSearchParams({ price, sort });
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      return classroomApi<{ classrooms: ClassroomCardData[]; hasMore: boolean; categories: string[] | null }>(`/directory?${params.toString()}`);
    },
    enabled: tab === "discover",
  });

  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    if (directory.data?.categories && directory.data.categories.length > 0 && categories.length === 0) {
      setCategories(directory.data.categories);
    }
  }, [directory.data, categories.length]);

  const enrolled = useQuery({
    queryKey: ["classroom", "enrolled"],
    queryFn: () => classroomApi<{ rooms: EnrolledClassroom[] }>("/enrolled"),
  });

  const errorOf = (e: unknown) =>
    e instanceof ClassroomApiError ? translateApiError(t, e.code, e.message) : t("classroom.error.loadFailed", "Failed to load classrooms");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.title", "Classroom")}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {me.data?.username && (
            <Link
              href={`/classroom/by/${me.data.username}`}
              className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-violet-300 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {t("classroom.nav.myClassrooms", "My Classrooms")}
            </Link>
          )}
          <Link
            href="/classroom/studio"
            className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-violet-300 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            {t("classroom.nav.studio", "Classroom Studio")}
          </Link>
          <Link href="/classroom/new" className="rounded-full bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-700">
            {t("classroom.nav.create", "+ New Classroom")}
          </Link>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {([
          { key: "discover", label: t("classroom.tabs.discover", "Discover") },
          {
            key: "enrolled",
            label: `${t("classroom.tabs.enrolled", "Enrolled")}${enrolled.data && enrolled.data.rooms.length > 0 ? ` (${enrolled.data.rooms.length})` : ""}`,
          },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-800 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "discover" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("classroom.directory.searchPlaceholder", "Search classrooms, topics or creators…")}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "free", "paid"] as Price[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPrice(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    price === p ? "border-violet-600 bg-violet-600 text-white" : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {t(`classroom.directory.price.${p}`, p === "all" ? "All" : p === "free" ? "Free" : "Paid")}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                aria-label={t("classroom.directory.sortLabel", "Sort")}
              >
                <option value="popular">{t("classroom.directory.sort.popular", "Most popular")}</option>
                <option value="new">{t("classroom.directory.sort.new", "Newest")}</option>
              </select>
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategory(null)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    category === null ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {t("classroom.directory.allCategories", "All topics")}
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(category === c ? null : c)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      category === c ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {directory.isError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {errorOf(directory.error)}
            </div>
          )}
          {directory.isPending ? (
            <Skeleton />
          ) : directory.data && directory.data.classrooms.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <span className="text-5xl">🏫</span>
              <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("classroom.empty.browse.title", "No classrooms open")}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                {q || category || price !== "all"
                  ? t("classroom.empty.browse.filtered", "No classrooms match your search. Try different filters.")
                  : t("classroom.empty.browse.subtitle", "Check back soon for open ClassRooms!")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {directory.data?.classrooms.map((c) => <ClassroomCard key={c.id} classroom={c} />)}
            </div>
          )}
        </div>
      ) : enrolled.isPending ? (
        <Skeleton />
      ) : enrolled.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {errorOf(enrolled.error)}
        </div>
      ) : enrolled.data.rooms.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📚</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("classroom.empty.mine.title", "No enrolled classrooms")}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t("classroom.empty.mine.subtitle", "Browse and enroll in a ClassRoom to get started!")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrolled.data.rooms.map((room) => (
            <EnrolledRow key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
