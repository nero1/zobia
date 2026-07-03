"use client";

/**
 * app/(app)/classroom/page.tsx
 *
 * Classroom browse page.
 * - Tab: Browse (open ClassRooms) vs My ClassRooms (enrolled)
 * - Cards: creator name, curriculum, fee, member count, dates, category
 * - Enroll button (POST /api/classroom/[roomId]/enroll)
 * - Enrolled view: progress (lesson count, quiz scores)
 * - Add/Edit/Delete modules for room creators
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

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

interface CurriculumModule {
  title: string;
  description?: string;
  resources?: string[];
}

interface AddModuleFormProps {
  roomId: string;
  onSuccess: (modules: CurriculumModule[]) => void;
  onCancel: () => void;
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
// Add Module Form
// ---------------------------------------------------------------------------

function AddModuleForm({ roomId, onSuccess, onCancel }: AddModuleFormProps) {
  const { t: tSub } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resources, setResources] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError(tSub("classroom.module.titleRequired", "Title is required")); return; }
    setSaving(true);
    setError(null);
    try {
      const resourceList = resources
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await fetch(`/api/classroom/${roomId}/modules`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          ...(description.trim() && { description: description.trim() }),
          ...(resourceList.length > 0 && { resources: resourceList }),
        }),
      });
      const json = (await res.json()) as { data?: { modules: CurriculumModule[] }; message?: string; error?: unknown };
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : "Failed to add module");
      onSuccess(json.data?.modules ?? []);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tSub, (e as Error & { code?: string | null }).code, e.message || "Failed to add module") : "Failed to add module");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950">
      <h4 className="text-sm font-semibold text-violet-900 dark:text-violet-200">{tSub("classroom.module.formTitle", "Add Module")}</h4>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {tSub("classroom.module.titleLabel", "Title")} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tSub("classroom.module.titlePlaceholder", "e.g. Introduction to JavaScript")}
          maxLength={200}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {tSub("classroom.module.descriptionLabel", "Description (optional)")}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tSub("classroom.module.descriptionPlaceholder", "Briefly describe this module…")}
          maxLength={1000}
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {tSub("classroom.module.resourcesLabel", "Resources (optional, one URL per line)")}
        </label>
        <textarea
          value={resources}
          onChange={(e) => setResources(e.target.value)}
          placeholder={"https://example.com/lesson1\nhttps://example.com/slides"}
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? tSub("classroom.module.saving", "Saving…") : tSub("classroom.module.save", "Add Module")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          {tSub("classroom.module.cancel", "Cancel")}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Module list (for creator)
// ---------------------------------------------------------------------------

interface ModuleListProps {
  roomId: string;
  modules: CurriculumModule[];
  onModulesChange: (modules: CurriculumModule[]) => void;
  onShowToast: (msg: string) => void;
}

function ModuleList({ roomId, modules, onModulesChange, onShowToast }: ModuleListProps) {
  const { t: tMod } = useTranslation();
  async function handleDelete(index: number) {
    if (!confirm(tMod("classroom.module.deleteConfirm", "Delete this module?"))) return;
    try {
      const res = await fetch(`/api/classroom/${roomId}/modules`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      const json = (await res.json()) as { data?: { modules: CurriculumModule[] }; message?: string };
      if (!res.ok) throw new Error(typeof json.message === "string" ? json.message : "Delete failed");
      onModulesChange(json.data?.modules ?? []);
      onShowToast(tMod("classroom.toast.moduleDeleted", "Module deleted"));
    } catch (e) {
      onShowToast(e instanceof Error ? translateApiError(tMod, (e as Error & { code?: string | null }).code, e.message || "Delete failed") : "Delete failed");
    }
  }

  if (modules.length === 0) return null;

  return (
    <div className="space-y-2">
      {modules.map((m, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{m.title}</p>
            {m.description && (
              <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{m.description}</p>
            )}
            {m.resources && m.resources.length > 0 && (
              <p className="mt-0.5 text-xs text-blue-500">{tMod("classroom.card.resourceCount", "{{count}} resource(s)", { count: m.resources.length })}</p>
            )}
          </div>
          <button
            onClick={() => void handleDelete(i)}
            className="shrink-0 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          >
            {tMod("classroom.module.delete", "Delete")}
          </button>
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
  currentUserId?: string | null;
  onShowToast: (msg: string) => void;
}

function BrowseCard({ room, onEnroll, enrolling, currentUserId, onShowToast }: BrowseCardProps) {
  const { t } = useTranslation();
  const [modules, setModules] = useState<CurriculumModule[] | null>(null);
  const [loadingModules, setLoadingModules] = useState(false);
  const [showModules, setShowModules] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const isCreator = currentUserId != null && currentUserId === room.creatorId;

  async function toggleModules() {
    if (showModules) {
      setShowModules(false);
      return;
    }
    if (modules === null) {
      setLoadingModules(true);
      try {
        const res = await fetch(`/api/classroom/${room.id}/modules`, { credentials: "include" });
        const json = (await res.json()) as { data?: { modules: CurriculumModule[] } };
        setModules(json.data?.modules ?? []);
      } catch {
        setModules([]);
      } finally {
        setLoadingModules(false);
      }
    }
    setShowModules(true);
  }

  function handleModulesChange(updated: CurriculumModule[]) {
    setModules(updated);
  }

  function handleAddSuccess(updated: CurriculumModule[]) {
    setModules(updated);
    setShowAddForm(false);
    onShowToast(t("classroom.toast.moduleAdded", "Module added!"));
  }

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
            {t("classroom.card.curriculum", "Curriculum: {{title}}", { title: room.curriculumTitle })}
          </p>
          {room.description && (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">{room.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-500">
            <span>{t("classroom.card.by", "By {{name}}", { name: room.creatorName })}</span>
            <span>·</span>
            <span>{t("classroom.card.members", "{{count}} members", { count: room.memberCount })}</span>
            <span>·</span>
            <span>
              {new Date(room.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {" – "}
              {new Date(room.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          {/* Module toggle */}
          <button
            onClick={() => void toggleModules()}
            className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            {loadingModules ? t("action.loading", "Loading…") : showModules ? t("classroom.card.hideModules", "Hide modules ▲") : t("classroom.card.viewModules", "View modules ▼")}
          </button>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
            {room.enrolmentFee > 0 ? `${room.enrolmentFee.toLocaleString()} 🪙` : t("classroom.card.free", "Free")}
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
            {room.isEnrolled ? t("classroom.card.enrolled", "Enrolled") : enrolling === room.id ? t("classroom.card.enrolling", "Enrolling…") : t("classroom.card.enroll", "Enroll")}
          </button>
        </div>
      </div>

      {/* Modules section */}
      {showModules && (
        <div className="mt-4 space-y-3">
          {modules && modules.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-neutral-500">
                {t("classroom.card.modulesCount", "Modules ({{count}})", { count: modules.length })}
              </p>
              <ModuleList
                roomId={room.id}
                modules={modules}
                onModulesChange={handleModulesChange}
                onShowToast={onShowToast}
              />
            </div>
          ) : (
            <p className="text-xs text-neutral-400">{t("classroom.card.noModules", "No modules yet.")}</p>
          )}

          {isCreator && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400"
            >
              {t("classroom.card.addModule", "+ Add Module")}
            </button>
          )}

          {isCreator && showAddForm && (
            <AddModuleForm
              roomId={room.id}
              onSuccess={handleAddSuccess}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enrolled room card
// ---------------------------------------------------------------------------

function EnrolledCard({ room }: { room: EnrolledClassRoom }) {
  const { t } = useTranslation();
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
          <p className="mt-0.5 text-xs text-neutral-500">{t("classroom.card.by", "By {{name}}", { name: room.creatorName })} · {room.curriculumTitle}</p>
        </div>
        {room.quizScore !== null && room.quizScore !== undefined && (
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold text-neutral-500">{t("classroom.card.quizScore", "Quiz Score")}</p>
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{room.quizScore}%</p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>{t("classroom.card.lessonsProgress", "{{completed}} / {{total}} lessons", { completed: room.completedLessons, total: room.lessonCount })}</span>
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
          {t("classroom.card.lastActivity", "Last activity: {{date}}", {
            date: new Date(room.lastActivityAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }),
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
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [tab, setTab] = useState<Tab>("browse");
  const [browseRooms, setBrowseRooms] = useState<ClassRoom[] | undefined>(undefined);
  const [enrolledRooms, setEnrolledRooms] = useState<EnrolledClassRoom[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const [browseRes, enrolledRes, meRes] = await Promise.all([
          fetch("/api/rooms?type=classroom", { credentials: "include" }),
          fetch("/api/classroom/enrolled", { credentials: "include" }).catch(() => null),
          fetch("/api/users/me", { credentials: "include" }).catch(() => null),
        ]);

        if (browseRes.status === 401) { window.location.href = "/auth/login"; return; }
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

        if (meRes?.ok) {
          const meJson = (await meRes.json()) as { data?: { user?: { id?: string }; id?: string }; id?: string };
          const uid =
            meJson?.data?.user?.id ??
            meJson?.data?.id ??
            meJson?.id ??
            null;
          setCurrentUserId(typeof uid === "string" ? uid : null);
        }
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || tRef.current("classroom.error.loadFailed", "Failed to load classrooms")) : tRef.current("classroom.error.loadFailed", "Failed to load classrooms"));
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
        const d = (await res.json()) as { error?: { code?: string; message?: string }; message?: string };
        const err = new Error(d.error?.message ?? d.message ?? "Enrollment failed") as Error & { code?: string | null };
        err.code = d.error?.code ?? null;
        throw err;
      }
      setBrowseRooms((prev) =>
        prev?.map((r) => (r.id === roomId ? { ...r, isEnrolled: true } : r))
      );
      showToast(t("classroom.toast.enrolled", "Enrolled successfully!"));
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || t("classroom.error.enrollFailed", "Enrollment failed")) : t("classroom.error.enrollFailed", "Enrollment failed"));
    } finally {
      setEnrolling(null);
    }
  }

  const loading = browseRooms === undefined || enrolledRooms === undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("classroom.title", "Classroom")}</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {([
          { key: "browse", label: t("classroom.tabs.browse", "Browse") },
          { key: "mine", label: `${t("classroom.tabs.mine", "My ClassRooms")}${enrolledRooms && enrolledRooms.length > 0 ? ` (${enrolledRooms.length})` : ""}` },
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
            <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("classroom.empty.browse.title", "No classrooms open")}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t("classroom.empty.browse.subtitle", "Check back soon for open ClassRooms!")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {browseRooms!.map((room) => (
              <BrowseCard
                key={room.id}
                room={room}
                onEnroll={handleEnroll}
                enrolling={enrolling}
                currentUserId={currentUserId}
                onShowToast={showToast}
              />
            ))}
          </div>
        )
      ) : enrolledRooms!.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📚</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("classroom.empty.mine.title", "No enrolled classrooms")}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t("classroom.empty.mine.subtitle", "Browse and enroll in a ClassRoom to get started!")}</p>
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
