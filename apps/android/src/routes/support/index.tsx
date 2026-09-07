/**
 * apps/android/src/routes/support/index.tsx
 *
 * "My Tickets" — mirrors apps/web/app/(app)/support/page.tsx against the
 * same GET /api/support/tickets endpoint.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Ticket {
  id: string;
  subject: string;
  status: 'open' | 'pending' | 'escalated' | 'resolved' | 'closed';
  message_count: number;
  last_activity_at: string;
}

const STATUS_CLASS: Record<Ticket['status'], string> = {
  open: 'bg-blue-500/20 text-blue-300',
  pending: 'bg-amber-500/20 text-amber-300',
  escalated: 'bg-red-500/20 text-red-300',
  resolved: 'bg-teal-500/20 text-teal-300',
  closed: 'bg-neutral-500/20 text-neutral-300',
};

function MyTicketsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['support', 'tickets'],
    queryFn: async () => (await apiClient.get<Ticket[]>('/support/tickets')).data,
  });

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('support.myTickets', 'My Tickets')}</h1>
        <Link to="/support/new" className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">
          {t('support.newTicket', 'New Ticket')}
        </Link>
      </div>

      {isLoading && <div className="h-16 animate-pulse rounded-xl bg-neutral-800" />}
      {isError && (
        <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">
          {t('support.unavailable', "Support tickets aren't available right now. Try the")}{' '}
          <Link to="/help" className="text-primary-400 underline">{t('help.title', 'Help Center')}</Link> {t('support.unavailableSuffix', 'instead.')}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">
          {t('support.noTicketsPrompt', 'No tickets yet. Need help?')}
        </p>
      )}
      {data && data.length > 0 && (
        <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
          {data.map((ticket) => (
            <Link key={ticket.id} to="/support/$ticketId" params={{ ticketId: ticket.id }} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{ticket.subject}</p>
                <p className="text-xs text-neutral-500">{t('support.messageCount', '{{count}} message', { count: ticket.message_count })}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[ticket.status]}`}>{t(`support.status.${ticket.status}`, ticket.status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/support/')({
  component: MyTicketsPage,
});
