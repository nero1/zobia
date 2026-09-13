/**
 * apps/android/src/routes/admin/support.tsx
 *
 * Support Tickets admin — mirrors apps/web/app/(admin)/gate44/support/{queue,
 * settings,tickets/[id]}.tsx, collapsed into one screen with tabs (same
 * pattern as admin/forum.tsx): a status-filterable ticket queue with a
 * detail overlay (thread + reply + assign/escalate/status), plus the
 * Support Ticket System config tab.
 *
 * GET  /admin/support/tickets?status=            -> Ticket[]
 * GET  /admin/support/tickets/:id                -> { ticket, messages }
 * POST /admin/support/tickets/:id                { body }  (staff reply)
 * POST /admin/support/tickets/:id/status         { status }
 * POST /admin/support/tickets/:id/assign         { targetUserId }
 * POST /admin/support/tickets/:id/escalate       { targetUserId }
 * GET/PUT /admin/config[/:key]                   (Support settings, shared with /admin/config)
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminTabs,
  AdminBadge,
  AdminToggle,
  adminInputClass,
} from '@/components/admin/AdminUI';

type Tab = 'queue' | 'settings';
type TicketStatus = 'open' | 'pending' | 'escalated' | 'resolved' | 'closed';

interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  assigned_to: string | null;
  is_ai_handled: boolean;
  message_count: number;
  last_activity_at: string;
}

interface Message {
  id: string;
  sender_id: string | null;
  sender_type: 'user' | 'staff' | 'ai';
  body: string;
  created_at: string;
}

interface TicketDetail {
  ticket: Ticket;
  messages: Message[];
}

interface ConfigEntry {
  key: string;
  value: string;
}

const STATUS_TABS: (TicketStatus | 'all')[] = ['all', 'open', 'pending', 'escalated', 'resolved', 'closed'];

const STATUS_COLOR: Record<TicketStatus, 'blue' | 'gold' | 'red' | 'green' | 'neutral'> = {
  open: 'blue',
  pending: 'gold',
  escalated: 'red',
  resolved: 'green',
  closed: 'neutral',
};

const SETTINGS_FIELDS: { key: string; label: string; type: 'boolean' | 'number' | 'text' }[] = [
  { key: 'feature_support_tickets', label: 'Enable Support Tickets', type: 'boolean' },
  { key: 'support_ai_triage_enabled', label: 'AI Triage', type: 'boolean' },
  { key: 'support_eligible_plans', label: 'Free-Access Plans (JSON)', type: 'text' },
  { key: 'support_ticket_cost_credits', label: 'Ticket Cost (Credits)', type: 'number' },
  { key: 'support_ticket_cost_stars', label: 'Ticket Cost (Stars)', type: 'number' },
  { key: 'support_charging_model', label: 'Message Charging Model', type: 'text' },
  { key: 'support_charging_x', label: 'Charging Model X', type: 'number' },
  { key: 'support_staff_roles', label: 'Staff Roles (JSON)', type: 'text' },
  { key: 'feature_help_center_ai', label: 'Enable Help Center "Ask AI"', type: 'boolean' },
  { key: 'help_center_ai_free_for_all', label: 'Help Center Contact-a-Human Always Free', type: 'boolean' },
];

async function fetchTickets(status: TicketStatus | 'all'): Promise<Ticket[]> {
  const qs = status === 'all' ? '' : `?status=${status}`;
  const { data } = await apiClient.get<Ticket[]>(`/admin/support/tickets${qs}`);
  return data ?? [];
}

async function fetchTicketDetail(id: string): Promise<TicketDetail> {
  const { data } = await apiClient.get<TicketDetail>(`/admin/support/tickets/${id}`);
  return data;
}

async function fetchConfig(): Promise<Record<string, string>> {
  const { data } = await apiClient.get<ConfigEntry[]>('/admin/config');
  const map: Record<string, string> = {};
  (data ?? []).forEach((e) => { map[e.key] = e.value; });
  return map;
}

function TicketDetailOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [escalateTarget, setEscalateTarget] = useState('');

  const { data, status } = useQuery({ queryKey: ['admin', 'support', 'ticket', id], queryFn: () => fetchTicketDetail(id) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'support', 'ticket', id] });
    qc.invalidateQueries({ queryKey: ['admin', 'support', 'tickets'] });
  };

  const sendReply = useMutation({
    mutationFn: () => apiClient.post(`/admin/support/tickets/${id}`, { body: reply }),
    onSuccess: () => { setReply(''); invalidate(); },
  });

  const setStatus = useMutation({
    mutationFn: (s: TicketStatus) => apiClient.post(`/admin/support/tickets/${id}/status`, { status: s }),
    onSuccess: () => invalidate(),
  });

  const escalate = useMutation({
    mutationFn: () => apiClient.post(`/admin/support/tickets/${id}/escalate`, { targetUserId: escalateTarget.trim() }),
    onSuccess: () => { setEscalateTarget(''); invalidate(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="truncate text-base font-semibold text-neutral-900">{data?.ticket.subject ?? t('admin.support.ticket', 'Ticket')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {status === 'pending' && <AdminCardSkeleton />}
        {status === 'success' && data && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <AdminBadge label={t(`support.status.${data.ticket.status}`, data.ticket.status)} color={STATUS_COLOR[data.ticket.status]} />
              {data.ticket.is_ai_handled && <AdminBadge label={t('admin.support.aiTriaged', 'AI-triaged')} color="blue" />}
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              <button onClick={() => setStatus.mutate('pending')} className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-700">{t('admin.support.markPending', 'Mark Pending')}</button>
              <button onClick={() => setStatus.mutate('resolved')} className="rounded-lg bg-success-100 px-2.5 py-1.5 text-xs font-semibold text-success-700">{t('admin.support.markResolved', 'Mark Resolved')}</button>
              <button onClick={() => setStatus.mutate('closed')} className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs font-semibold text-neutral-700">{t('action.close', 'Close')}</button>
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={escalateTarget}
                onChange={(e) => setEscalateTarget(e.target.value)}
                placeholder={t('admin.support.escalateToUserId', 'Escalate to user ID')}
                className={`${adminInputClass} text-xs`}
              />
              <button
                onClick={() => escalate.mutate()}
                disabled={!escalateTarget.trim() || escalate.isPending}
                className="shrink-0 rounded-lg bg-danger-100 px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-50"
              >
                {t('admin.support.escalate', 'Escalate')}
              </button>
            </div>

            <div className="mb-4 space-y-2.5">
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl p-3 text-sm ${
                    m.sender_type === 'ai' ? 'bg-purple-50 text-purple-900' : m.sender_type === 'staff' ? 'bg-primary-50 text-primary-900' : 'bg-neutral-100 text-neutral-900'
                  }`}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase opacity-70">
                    {m.sender_type === 'ai' ? t('support.aiAssistant', 'Zobia AI Assistant') : m.sender_type === 'staff' ? t('support.staffReply', 'Support Team') : t('support.you', 'User')}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-none flex items-end gap-2 border-t border-neutral-200 p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t('support.admin.writeReply', 'Write a reply…')}
          rows={2}
          className={`${adminInputClass} flex-1 resize-none`}
        />
        <button
          onClick={() => sendReply.mutate()}
          disabled={!reply.trim() || sendReply.isPending}
          className="shrink-0 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('support.send', 'Send')}
        </button>
      </div>
    </div>
  );
}

function AdminSupportPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('queue');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('open');
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const { data: tickets, status: ticketsStatus, refetch } = useQuery({
    queryKey: ['admin', 'support', 'tickets', statusFilter],
    queryFn: () => fetchTickets(statusFilter),
    enabled: tab === 'queue',
  });

  const { data: config, status: configStatus } = useQuery({ queryKey: ['admin', 'config'], queryFn: fetchConfig, enabled: tab === 'settings' });

  const saveConfig = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiClient.put(`/admin/config/${key}`, { value }),
    onMutate: ({ key }) => setSavingKey(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'config'] }),
    onSettled: () => setSavingKey(null),
  });

  const tabs = [
    { key: 'queue' as const, label: t('admin.support.tabQueue', 'Queue') },
    { key: 'settings' as const, label: t('admin.support.tabSettings', 'Settings') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.support', 'Support Tickets')}</h1>

      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'queue' && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {STATUS_TABS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setStatusFilter(v)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusFilter === v ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
              >
                {v === 'all' ? t('admin.support.tabAll', 'All') : t(`support.status.${v}`, v)}
              </button>
            ))}
          </div>

          <div className="space-y-2.5">
            {ticketsStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
            {ticketsStatus === 'error' && <AdminErrorState onRetry={() => refetch()} />}
            {ticketsStatus === 'success' && (tickets?.length ?? 0) === 0 && (
              <AdminEmptyState icon="🎫" title={t('admin.support.noTickets', 'No tickets in this view')} />
            )}
            {ticketsStatus === 'success' &&
              tickets?.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setOpenTicketId(ticket.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 text-left shadow-card active:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">{ticket.subject}</p>
                    <p className="text-xs text-neutral-500">
                      {t('support.messageCount', '{{count}} message', { count: ticket.message_count })} · {ticket.is_ai_handled ? t('admin.support.aiTriaged', 'AI-triaged') : t('admin.support.human', 'Human')}
                    </p>
                  </div>
                  <AdminBadge label={t(`support.status.${ticket.status}`, ticket.status)} color={STATUS_COLOR[ticket.status]} />
                </button>
              ))}
          </div>
        </>
      )}

      {tab === 'settings' && (
        <div className="space-y-2.5">
          {configStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {configStatus === 'success' &&
            SETTINGS_FIELDS.map((field) => {
              const raw = config?.[field.key] ?? '';
              const isSaving = savingKey === field.key;
              return (
                <div key={field.key} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-card">
                  <p className="pr-2 text-sm font-medium text-neutral-800">{field.label}</p>
                  {field.type === 'boolean' ? (
                    <AdminToggle checked={raw === 'true'} disabled={isSaving} onChange={(v) => saveConfig.mutate({ key: field.key, value: v ? 'true' : 'false' })} />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      defaultValue={raw}
                      disabled={isSaving}
                      onBlur={(e) => { if (e.target.value !== raw) saveConfig.mutate({ key: field.key, value: e.target.value }); }}
                      className={`rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 disabled:opacity-50 ${field.type === 'number' ? 'w-20 text-right' : 'w-36'}`}
                    />
                  )}
                </div>
              );
            })}
        </div>
      )}

      {openTicketId && <TicketDetailOverlay id={openTicketId} onClose={() => setOpenTicketId(null)} />}
    </div>
  );
}

export const Route = createFileRoute('/admin/support')({
  component: AdminSupportPage,
});
