/**
 * apps/android/src/routes/admin/moderation.tsx
 *
 * Moderation queue — mirrors apps/web/app/(admin)/admin/moderation/page.tsx:
 * Pending / Resolved / Escalated report tabs plus a Flagged Rooms tab.
 *
 * Uses the corrected action contract (see the web page fix in this same
 * change): `suspend_user` + `duration_hours` and `ban_user`, not the
 * `suspend_24h`/`suspend_7d`/`ban` strings the web page used to send (which
 * never matched the backend's Zod enum and 400'd on every click).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminTabs, AdminBadge, timeAgo, fmtDate } from '@/components/admin/AdminUI';

type ReportTarget = 'user' | 'message' | 'room' | 'guild';
type ReportStatus = 'pending' | 'resolved' | 'escalated' | 'dismissed';
type TabKey = 'pending' | 'resolved' | 'escalated' | 'flagged_rooms';

interface Report {
  id: string;
  reporter_username: string;
  report_type: string;
  ai_category: string | null;
  ai_confidence: number | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  reported_user_username?: string | null;
  reported_user_id?: string | null;
  reported_room_id?: string | null;
  reported_guild_id?: string | null;
}

interface FlaggedRoom {
  id: string;
  name: string;
  type: string;
  creator_username: string | null;
  member_count: number;
  flag_reason: string | null;
  flagged_at: string;
}

const TARGET_BADGE: Record<ReportTarget, 'blue' | 'teal' | 'neutral' | 'gold'> = { user: 'blue', message: 'teal', room: 'neutral', guild: 'gold' };

function reportTarget(r: Report): ReportTarget {
  if (r.reported_user_id) return 'user';
  if (r.reported_room_id) return 'room';
  if (r.reported_guild_id) return 'guild';
  return 'message';
}

async function fetchReports(status: TabKey): Promise<{ reports: Report[]; flaggedRooms: FlaggedRoom[] }> {
  if (status === 'flagged_rooms') {
    const { data } = await apiClient.get<{ rooms?: FlaggedRoom[] }>('/admin/rooms?status=flagged&limit=50');
    return { reports: [], flaggedRooms: data?.rooms ?? [] };
  }
  const { data } = await apiClient.get<{ items: Report[] }>(`/admin/moderation?status=${status}`);
  return { reports: data?.items ?? [], flaggedRooms: [] };
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-danger-500' : value >= 50 ? 'bg-amber-500' : 'bg-teal-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-neutral-500">{value}%</span>
    </div>
  );
}

function ReportCard({ report, onAction, busy }: { report: Report; onAction: (id: string, action: string, durationHours?: number) => void; busy: boolean }) {
  const { t } = useTranslation();
  const actions: { label: string; action: string; durationHours?: number; classes: string }[] = [
    { label: t('admin.moderation.action.dismiss', 'Dismiss'), action: 'dismiss', classes: 'bg-neutral-100 text-neutral-700' },
    { label: t('admin.moderation.action.warn', 'Warn User'), action: 'warn', classes: 'bg-amber-100 text-amber-700' },
    { label: t('admin.moderation.action.remove', 'Remove Content'), action: 'remove_content', classes: 'bg-orange-100 text-orange-700' },
    { label: t('admin.moderation.action.suspend24h', 'Suspend 24h'), action: 'suspend_user', durationHours: 24, classes: 'bg-danger-100 text-danger-700' },
    { label: t('admin.moderation.action.suspend7d', 'Suspend 7d'), action: 'suspend_user', durationHours: 168, classes: 'bg-danger-200 text-danger-800' },
    { label: t('admin.moderation.action.ban', 'Ban'), action: 'ban_user', classes: 'bg-danger-600 text-white' },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-neutral-700">@{report.reporter_username}</span>
        <span className="text-neutral-400">{t('admin.moderation.reported', 'reported')}</span>
        <AdminBadge label={reportTarget(report)} color={TARGET_BADGE[reportTarget(report)]} />
        <span className="ml-auto text-neutral-400">{timeAgo(report.created_at)}</span>
      </div>
      <p className="mb-1 text-xs text-neutral-500">
        {t('admin.moderation.type', 'Type')}: <span className="font-medium text-neutral-800">{report.report_type.replace(/_/g, ' ')}</span>
      </p>
      {report.ai_category && (
        <div className="mb-2.5 space-y-1">
          <p className="text-xs text-neutral-500">
            {t('admin.moderation.ai', 'AI')}: <span className="font-medium text-neutral-800">{report.ai_category}</span>
          </p>
          <ConfidenceBar value={report.ai_confidence ?? 0} />
        </div>
      )}
      {report.status === 'pending' ? (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => onAction(report.id, a.action, a.durationHours)}
              className={`flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${a.classes}`}
            >
              {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : a.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500">
          <span className="font-medium capitalize">{report.status}</span>
          {report.resolved_at && <> · {fmtDate(report.resolved_at)}</>}
        </div>
      )}
    </div>
  );
}

function FlaggedRoomCard({ room, onAction, busy }: { room: FlaggedRoom; onAction: (id: string, action: string, extra?: Record<string, unknown>) => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-orange-200 bg-white p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-neutral-900">{room.name}</span>
        <AdminBadge label={room.type} color="neutral" />
        <AdminBadge label={t('admin.moderation.flagged', 'Flagged')} color="gold" />
      </div>
      <p className="mb-1 text-xs text-neutral-500">
        @{room.creator_username ?? 'unknown'} · {room.member_count} {t('admin.moderation.members', 'members')} · {timeAgo(room.flagged_at)}
      </p>
      {room.flag_reason && <p className="mb-2.5 text-xs text-orange-700">{t('admin.moderation.flagReason', 'Reason')}: {room.flag_reason}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button disabled={busy} onClick={() => onAction(room.id, 'unflag')} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50">
          {t('admin.moderation.unflag', 'Unflag')}
        </button>
        <button disabled={busy} onClick={() => onAction(room.id, 'suspend', { reason: room.flag_reason ?? 'Flagged content' })} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
          {t('admin.rooms.suspend', 'Suspend')}
        </button>
        <button disabled={busy} onClick={() => onAction(room.id, 'ban')} className="rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
          {t('admin.rooms.ban', 'Ban')}
        </button>
      </div>
    </div>
  );
}

function AdminModerationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status } = useQuery({
    queryKey: ['admin', 'moderation', tab],
    queryFn: () => fetchReports(tab),
  });

  const reportAction = useMutation({
    mutationFn: ({ id, action, durationHours }: { id: string; action: string; durationHours?: number }) =>
      apiClient.post(`/admin/moderation/${id}/action`, { action, ...(durationHours ? { duration_hours: durationHours } : {}) }),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'moderation', tab] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const roomAction = useMutation({
    mutationFn: ({ id, action, extra }: { id: string; action: string; extra?: Record<string, unknown> }) =>
      apiClient.patch(`/admin/rooms/${id}`, { action, ...extra }),
    onSuccess: () => {
      showToast(t('admin.moderation.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'moderation', 'flagged_rooms'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const tabs = [
    { key: 'pending' as const, label: t('admin.moderation.tab.pending', 'Pending') },
    { key: 'resolved' as const, label: t('admin.moderation.tab.resolved', 'Resolved') },
    { key: 'escalated' as const, label: t('admin.moderation.tab.escalated', 'Escalated') },
    { key: 'flagged_rooms' as const, label: t('admin.moderation.tab.flaggedRooms', 'Flagged Rooms') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.moderation', 'Moderation Queue')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}

        {status === 'success' && tab === 'flagged_rooms' && (data?.flaggedRooms.length ?? 0) === 0 && (
          <AdminEmptyState icon="🏠" title={t('admin.moderation.noFlaggedRooms', 'No flagged rooms')} hint={t('admin.moderation.noFlaggedRoomsHint', 'No rooms have been flagged for review.')} />
        )}

        {status === 'success' && tab === 'flagged_rooms' &&
          data?.flaggedRooms.map((room) => (
            <FlaggedRoomCard
              key={room.id}
              room={room}
              busy={roomAction.isPending && roomAction.variables?.id === room.id}
              onAction={(id, action, extra) => roomAction.mutate({ id, action, extra })}
            />
          ))}

        {status === 'success' && tab !== 'flagged_rooms' && (data?.reports.length ?? 0) === 0 && (
          <AdminEmptyState icon="✓" title={t('admin.moderation.queueClear', 'Queue is clear ✓')} hint={t('admin.moderation.noReports', 'No {{tab}} reports at this time.', { tab })} />
        )}

        {status === 'success' && tab !== 'flagged_rooms' &&
          data?.reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={reportAction.isPending && reportAction.variables?.id === r.id}
              onAction={(id, action, durationHours) => reportAction.mutate({ id, action, durationHours })}
            />
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/moderation')({
  component: AdminModerationPage,
});
