/**
 * apps/android/src/routes/classroom.tsx
 *
 * Classroom browse screen — mirrors apps/web/app/(app)/classroom/page.tsx:
 * Browse (open ClassRooms) vs My ClassRooms (enrolled) tabs, enroll button,
 * expandable module list, and add/delete modules for room creators.
 *
 * i18n note: the web page has ZERO classroom.* keys in shared/i18n/locales/
 * en.json — every string on that page is hardcoded English (its useTranslation
 * calls are only used to translate API error codes via translateApiError, not
 * to render copy). This introduced a new `classroom.*` namespace, now added
 * to en.json.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

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

// ---------------------------------------------------------------------------
// Data fetching — the /rooms and /classroom/enrolled response shapes aren't
// fully pinned down (same ambiguity the web page defends against), so this
// parses defensively across a few possible envelope keys/field names.
// ---------------------------------------------------------------------------

function toClassRoom(r: Record<string, unknown>): ClassRoom {
  return {
    id: String(r.id ?? ''),
    title: String(r.title ?? r.name ?? ''),
    description: (r.description as string) ?? undefined,
    creatorName: String(r.creatorName ?? r.creatorDisplayName ?? r.creatorUsername ?? r.creator_username ?? ''),
    creatorId: String(r.creatorId ?? r.creator_id ?? ''),
    curriculumTitle: String(r.curriculumTitle ?? ''),
    enrolmentFee: Number(r.enrolmentFee ?? r.enrolmentFeeNgn ?? r.enrolment_fee_ngn ?? 0),
    memberCount: Number(r.memberCount ?? r.member_count ?? 0),
    category: String(r.category ?? ''),
    startDate: String(r.startDate ?? r.created_at ?? new Date().toISOString()),
    endDate: String(r.endDate ?? r.startDate ?? r.created_at ?? new Date().toISOString()),
    isEnrolled: Boolean(r.isEnrolled ?? r.isJoined ?? false),
  };
}

async function fetchBrowseRooms(): Promise<ClassRoom[]> {
  const { data } = await apiClient.get<Record<string, unknown>>('/rooms?type=classroom');
  const rows = (data.items ?? data.rooms ?? data.data ?? (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
  return rows.map(toClassRoom);
}

async function fetchEnrolledRooms(): Promise<EnrolledClassRoom[]> {
  try {
    const { data } = await apiClient.get<Record<string, unknown>>('/classroom/enrolled');
    const rows = (data.items ?? data.rooms ?? data.data ?? (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
    return rows.map((r) => ({
      ...toClassRoom(r),
      lessonCount: Number(r.lessonCount ?? 0),
      completedLessons: Number(r.completedLessons ?? 0),
      quizScore: r.quizScore != null ? Number(r.quizScore) : null,
      lastActivityAt: (r.lastActivityAt as string) ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchModules(roomId: string): Promise<CurriculumModule[]> {
  const { data } = await apiClient.get<{ modules: CurriculumModule[] }>(`/classroom/${roomId}/modules`);
  return data?.modules ?? [];
}

// ---------------------------------------------------------------------------
// Add Module Form
// ---------------------------------------------------------------------------

function AddModuleForm({ roomId, onSuccess, onCancel }: { roomId: string; onSuccess: (modules: CurriculumModule[]) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resources, setResources] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(t('classroom.module.titleRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const resourceList = resources.split('\n').map((r) => r.trim()).filter(Boolean);
      const { data } = await apiClient.post<{ modules: CurriculumModule[] }>(`/classroom/${roomId}/modules`, {
        title: title.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(resourceList.length > 0 && { resources: resourceList }),
      });
      onSuccess(data?.modules ?? []);
    } catch {
      setError(t('error.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 rounded-xl border border-primary-200 bg-primary-50 p-4">
      <h4 className="text-sm font-semibold text-primary-900">{t('classroom.module.formTitle')}</h4>
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          {t('classroom.module.titleLabel')} <span className="text-danger-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('classroom.module.titlePlaceholder')}
          maxLength={200}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">{t('classroom.module.descriptionLabel')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('classroom.module.descriptionPlaceholder')}
          maxLength={1000}
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">{t('classroom.module.resourcesLabel')}</label>
        <textarea
          value={resources}
          onChange={(e) => setResources(e.target.value)}
          placeholder={'https://example.com/lesson1\nhttps://example.com/slides'}
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? t('classroom.module.saving') : t('classroom.module.save')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600">
          {t('classroom.module.cancel')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Module list (for creator)
// ---------------------------------------------------------------------------

function ModuleList({ roomId, modules, onModulesChange, onShowToast }: { roomId: string; modules: CurriculumModule[]; onModulesChange: (modules: CurriculumModule[]) => void; onShowToast: (msg: string) => void }) {
  const { t } = useTranslation();

  async function handleDelete(index: number) {
    if (!confirm(t('classroom.module.deleteConfirm'))) return;
    try {
      const { data } = await apiClient.delete<{ modules: CurriculumModule[] }>(`/classroom/${roomId}/modules`, { data: { index } });
      onModulesChange(data?.modules ?? []);
      onShowToast(t('classroom.toast.moduleDeleted'));
    } catch {
      onShowToast(t('error.generic'));
    }
  }

  if (modules.length === 0) return null;

  return (
    <div className="space-y-2">
      {modules.map((m, i) => (
        <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900">{m.title}</p>
            {m.description && <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{m.description}</p>}
            {m.resources && m.resources.length > 0 && (
              <p className="mt-0.5 text-xs text-primary-500">{t('classroom.card.resourceCount', { count: m.resources.length })}</p>
            )}
          </div>
          <button onClick={() => void handleDelete(i)} className="shrink-0 rounded px-2 py-1 text-xs text-danger-500">
            {t('classroom.module.delete')}
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse room card
// ---------------------------------------------------------------------------

function BrowseCard({ room, onEnroll, enrolling, currentUserId, onShowToast }: { room: ClassRoom; onEnroll: (id: string) => void; enrolling: string | null; currentUserId?: string | null; onShowToast: (msg: string) => void }) {
  const { t } = useTranslation();
  const [showModules, setShowModules] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const isCreator = currentUserId != null && currentUserId === room.creatorId;

  const { data: modules, isLoading: loadingModules, isError: modulesError } = useQuery({
    queryKey: ['classroom', room.id, 'modules'],
    queryFn: () => fetchModules(room.id),
    enabled: showModules,
  });
  const qc = useQueryClient();

  function handleAddSuccess(updated: CurriculumModule[]) {
    qc.setQueryData(['classroom', room.id, 'modules'], updated);
    setShowAddForm(false);
    onShowToast(t('classroom.toast.moduleAdded'));
  }

  return (
    <div className="bg-white rounded-xl p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {room.category && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">{room.category}</span>
          )}
          <h3 className="mt-2 text-base font-semibold text-neutral-900">{room.title}</h3>
          {room.curriculumTitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{t('classroom.card.curriculum', { title: room.curriculumTitle })}</p>
          )}
          {room.description && <p className="mt-1 text-sm text-neutral-600 line-clamp-2">{room.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-500">
            <span>{t('classroom.card.by', { name: room.creatorName })}</span>
            <span>·</span>
            <span>{t('classroom.card.members', { count: room.memberCount })}</span>
          </div>
          <button onClick={() => setShowModules((v) => !v)} className="mt-2 text-xs font-medium text-primary-600">
            {loadingModules
              ? t('common.loading')
              : showModules
                ? t('classroom.card.hideModules')
                : t('classroom.card.viewModules')}
          </button>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-neutral-900">
            {room.enrolmentFee > 0 ? `${room.enrolmentFee.toLocaleString()} 🪙` : t('classroom.card.free')}
          </p>
          <button
            onClick={() => onEnroll(room.id)}
            disabled={enrolling === room.id || room.isEnrolled}
            className={`mt-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60 ${room.isEnrolled ? 'border border-neutral-300 text-neutral-500' : 'bg-primary-600 text-white'}`}
          >
            {room.isEnrolled
              ? t('classroom.card.enrolled')
              : enrolling === room.id
                ? t('classroom.card.enrolling')
                : t('classroom.card.enroll')}
          </button>
        </div>
      </div>

      {showModules && (
        <div className="mt-4 space-y-3">
          {modules && modules.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-neutral-500">{t('classroom.card.modulesCount', { count: modules.length })}</p>
              <ModuleList
                roomId={room.id}
                modules={modules}
                onModulesChange={(updated) => qc.setQueryData(['classroom', room.id, 'modules'], updated)}
                onShowToast={onShowToast}
              />
            </div>
          ) : modulesError ? (
            <p className="text-xs text-danger-500">{t('classroom.error.loadFailed')}</p>
          ) : !loadingModules ? (
            <p className="text-xs text-neutral-400">{t('classroom.card.noModules')}</p>
          ) : null}

          {isCreator && !showAddForm && (
            <button onClick={() => setShowAddForm(true)} className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-600">
              {t('classroom.card.addModule')}
            </button>
          )}

          {isCreator && showAddForm && (
            <AddModuleForm roomId={room.id} onSuccess={handleAddSuccess} onCancel={() => setShowAddForm(false)} />
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
  const pct = room.lessonCount > 0 ? Math.round((room.completedLessons / room.lessonCount) * 100) : 0;

  return (
    <div className="bg-white rounded-xl p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {room.category && (
            <span className="rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700">{room.category}</span>
          )}
          <h3 className="mt-2 text-base font-semibold text-neutral-900">{room.title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">{room.creatorName}{room.curriculumTitle ? ` · ${room.curriculumTitle}` : ''}</p>
        </div>
        {room.quizScore != null && (
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold text-neutral-500">{t('classroom.card.quizScore')}</p>
            <p className="text-lg font-bold text-neutral-900">{room.quizScore}%</p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>{t('classroom.card.lessonsProgress', { completed: room.completedLessons, total: room.lessonCount })}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {room.lastActivityAt && (
        <p className="mt-2 text-xs text-neutral-400">
          {t('classroom.card.lastActivity', {
            date: new Date(room.lastActivityAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          })}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = 'browse' | 'mine';

function ClassroomPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('browse');
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const { data: browseRooms, status: browseStatus } = useQuery({ queryKey: ['classroom', 'browse'], queryFn: fetchBrowseRooms });
  const { data: enrolledRooms, status: enrolledStatus } = useQuery({ queryKey: ['classroom', 'enrolled'], queryFn: fetchEnrolledRooms });

  const enrollMutation = useMutation({
    mutationFn: (roomId: string) => apiClient.post(`/classroom/${roomId}/enroll`),
    onMutate: (roomId) => setEnrolling(roomId),
    onSuccess: (_res, roomId) => {
      qc.setQueryData<ClassRoom[]>(['classroom', 'browse'], (prev = []) =>
        prev.map((r) => (r.id === roomId ? { ...r, isEnrolled: true } : r))
      );
      showToast(t('classroom.toast.enrolled'));
    },
    onError: () => showToast(t('classroom.error.enrollFailed')),
    onSettled: () => setEnrolling(null),
  });

  const loading = browseStatus === 'pending' || enrolledStatus === 'pending';
  const rooms = browseRooms ?? [];
  const enrolled = enrolledRooms ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900 mb-3">{t('classroom.title')}</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-success-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 mb-3">
        <button
          onClick={() => setTab('browse')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === 'browse' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}
        >
          {t('classroom.tabs.browse')}
        </button>
        <button
          onClick={() => setTab('mine')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === 'mine' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}
        >
          {t('classroom.tabs.mine')}{enrolled.length > 0 ? ` (${enrolled.length})` : ''}
        </button>
      </div>

      {browseStatus === 'error' && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 mb-3">
          {t('classroom.error.loadFailed')}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading')}</div>
      ) : tab === 'browse' ? (
        rooms.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <span className="text-5xl">🏫</span>
            <h2 className="mt-4 text-lg font-semibold text-neutral-900">{t('classroom.empty.browse.title')}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t('classroom.empty.browse.subtitle')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rooms.map((room) => (
              <BrowseCard
                key={room.id}
                room={room}
                onEnroll={(id) => enrollMutation.mutate(id)}
                enrolling={enrolling}
                currentUserId={currentUser?.id}
                onShowToast={showToast}
              />
            ))}
          </div>
        )
      ) : enrolled.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📚</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">{t('classroom.empty.mine.title')}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t('classroom.empty.mine.subtitle')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrolled.map((room) => (
            <EnrolledCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/classroom')({
  component: ClassroomPage,
});
