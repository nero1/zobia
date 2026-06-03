"use client";

/**
 * app/(app)/classroom/page.tsx
 *
 * Classroom browse page.
 * - Tab: Browse (open ClassRooms) vs My ClassRooms (enrolled)
 * - Cards: creator name, curriculum, fee, member count, dates, category
 * - Enroll button (POST /api/classroom/[roomId]/enroll)
 * - Enrolled view: progress (lesson count, quiz scores)
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassRoom {
  id: string;
  title: string;
  description?: string;
  creatorName: string;
  creatorId: string;
  curriculumTitle: string;
  enrolmentFee: number;
  memberCount: number;
  category: string;
  startDate: string;
  endDate: string;
  isEnrolled?: boolean;
}

interface EnrolledClassRoom extends ClassRoom {
  lessonCount: number;
  completedLessons: number;
  quizScore?: number | null;
  lastActivityAt?: string | null;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function ClassRoomSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="space-y-3">
            <SkeletonBlock className="h-5 w-56" />
            <SkeletonBlock className="h-4 w-full" />
            <div className="flex gap-3">
              <SkeletonBlock className="h-4 w-20" />
              <SkeletonBlock className="h-4 w-20" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse room card
// ---------------------------------------------------------------------------

interface BrowseCardProps {
  room: ClassRoom;
  onEnroll: (id: string) => Promise<void>;
  enrolling: string | null;
}

function BrowseCard({ room, onEnroll, enrolling }: BrowseCardProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {room.category}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">{room.title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Curriculum: {room.curriculumTitle}
          </p>
          {room.description && (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">{room.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-500">
            <span>By {room.creatorName}</span>
            <span>·</span>
            <span>{room.memberCount} members</span>
            <span>·</span>
            <span>
              {new Date(room.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {" – "}
              {new Date(room.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
            {room.enrolmentFee > 0 ? `${room.enrolmentFee.toLocaleString()} 🪙` : "Free"}
          </p>
          <button
            onClick={() => onEnroll(room.id)}
            disabled={enrolling === room.id || room.isEnrolled}
            className={`mt-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
              room.isEnrolled
                ? "border border-neutral-300 text-neutral-500 dark:border-neutral-700"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {room.isEnrolled ? "Enrolled" : enrolling === room.id ? "Enrolling…" : "Enroll"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enrolled room card
// ---------------------------------------------------------------------------

function EnrolledCard({ room }: { room: EnrolledClassRoom }) {
  const pct = room.lessonCount > 0
    ? Math.round((room.completedLessons / room.lessonCount) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
            {room.category}
          </span>
          <h3 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">{room.title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">By {room.creatorName} · {room.curriculumTitle}</p>
        </div>
        {room.quizScore !== null && room.quizScore !== undefined && (
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold text-neutral-500">Quiz Score</p>
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{room.quizScore}%</p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>{room.completedLessons} / {room.lessonCount} lessons</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {room.lastActivityAt && (
        <p className="mt-2 text-xs text-neutral-400">
          Last activity:{" "}
          {new Date(room.lastActivityAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = "browse" | "mine";

export default function ClassroomPage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [browseRooms, setBrowseRooms] = useState<ClassRoom[] | undefined>(undefined);
  const [enrolledRooms, setEnrolledRooms] = useState<EnrolledClassRoom[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const [browseRes, enrolledRes] = await Promise.all([
          fetch("/api/rooms?type=classroom", { credentials: "include" }),
          fetch("/api/classroom/enrolled", { credentials: "include" }).catch(() => null),
        ]);

        if (browseRes.status === 401) { window.location.href = "/login"; return; }
        if (!browseRes.ok) throw new Error("Failed to load classrooms");

        const browseJson = (await browseRes.json()) as
          | ClassRoom[]
          | { rooms?: ClassRoom[]; data?: ClassRoom[] };
        const rooms: ClassRoom[] = Array.isArray(browseJson)
          ? browseJson
          : (browseJson as { rooms?: ClassRoom[] }).rooms ??
            (browseJson as { data?: ClassRoom[] }).data ??
            [];
        setBrowseRooms(rooms);

        let enrolled: EnrolledClassRoom[] = [];
        if (enrolledRes?.ok) {
          const enrolledJson = (await enrolledRes.json()) as
            | EnrolledClassRoom[]
            | { rooms?: EnrolledClassRoom[]; data?: EnrolledClassRoom[] };
          enrolled = Array.isArray(enrolledJson)
            ? enrolledJson
            : (enrolledJson as { rooms?: EnrolledClassRoom[] }).rooms ??
              (enrolledJson as { data?: EnrolledClassRoom[] }).data ??
              [];
        }
        setEnrolledRooms(enrolled);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setBrowseRooms([]);
        setEnrolledRooms([]);
      }
    })();
  }, []);

  async function handleEnroll(roomId: string) {
    setEnrolling(roomId);
    try {
      const res = await fetch(`/api/classroom/${roomId}/enroll`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string };
        throw new Error(d.message ?? d.error ?? "Enrollment failed");
      }
      setBrowseRooms((prev) =>
        prev?.map((r) => (r.id === roomId ? { ...r, isEnrolled: true } : r))
      );
      showToast("Enrolled successfully!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setEnrolling(null);
    }
  }

  const loading = browseRooms === undefined || enrolledRooms === undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Classroom</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {([
          { key: "browse", label: "Browse" },
          { key: "mine", label: `My ClassRooms${enrolledRooms && enrolledRooms.length > 0 ? ` (${enrolledRooms.length})` : ""}` },
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

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <ClassRoomSkeleton />
      ) : tab === "browse" ? (
        browseRooms!.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <span className="text-5xl">🏫</span>
            <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">No classrooms open</h2>
            <p className="mt-1 text-sm text-neutral-500">Check back soon for open ClassRooms!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {browseRooms!.map((room) => (
              <BrowseCard key={room.id} room={room} onEnroll={handleEnroll} enrolling={enrolling} />
            ))}
          </div>
        )
      ) : enrolledRooms!.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📚</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">No enrolled classrooms</h2>
          <p className="mt-1 text-sm text-neutral-500">Browse and enroll in a ClassRoom to get started!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrolledRooms!.map((room) => (
            <EnrolledCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
