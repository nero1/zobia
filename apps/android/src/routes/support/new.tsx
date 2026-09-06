/**
 * apps/android/src/routes/support/new.tsx
 *
 * Create a new support ticket — mirrors apps/web/app/(app)/support/new/page.tsx.
 * POST /api/support/tickets, prefixed by GET /api/support/eligibility so the
 * cost (if any) is shown before submitting.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

interface Eligibility {
  freeAccess: boolean;
  costCredits: number;
  costStars: number;
  blocked: boolean;
}

function NewTicketPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [subject, setSubject] = useState(search.prefillSubject ?? '');
  const [message, setMessage] = useState(search.prefillBody ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: eligibility } = useQuery({
    queryKey: ['support', 'eligibility'],
    queryFn: async () => (await apiClient.get<Eligibility>('/support/eligibility')).data,
  });

  const createTicket = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string }>('/support/tickets', {
        subject: subject.trim(),
        firstMessage: message.trim(),
        source: search.docId ? 'help_center_ai' : 'ticket',
        sourceHelpDocId: search.docId,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
      const id = res.data?.id;
      if (id) navigate({ to: '/support/$ticketId', params: { ticketId: id } });
    },
    onError: (err) => {
      setError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Failed to create ticket' : 'Failed to create ticket');
    },
  });

  return (
    <div className="p-4">
      <h1 className="mb-1 text-xl font-bold text-white">New Support Ticket</h1>
      {eligibility && !eligibility.freeAccess && !eligibility.blocked && (
        <p className="mb-3 text-sm text-neutral-400">
          Costs {eligibility.costCredits > 0 && `${eligibility.costCredits} credits`}
          {eligibility.costCredits > 0 && eligibility.costStars > 0 && ' or '}
          {eligibility.costStars > 0 && `${eligibility.costStars} stars`}.
        </p>
      )}
      {eligibility?.blocked && <p className="mb-3 text-sm text-red-400">Support tickets aren&apos;t available on your current plan.</p>}

      <div className="space-y-3">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your issue…"
          rows={6}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={() => createTicket.mutate()}
          disabled={createTicket.isPending || !subject.trim() || !message.trim() || eligibility?.blocked}
          className="w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createTicket.isPending ? 'Submitting…' : 'Submit Ticket'}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/support/new')({
  validateSearch: (search: Record<string, unknown>): { prefillSubject?: string; prefillBody?: string; docId?: string } => ({
    prefillSubject: typeof search.prefillSubject === 'string' ? search.prefillSubject : undefined,
    prefillBody: typeof search.prefillBody === 'string' ? search.prefillBody : undefined,
    docId: typeof search.docId === 'string' ? search.docId : undefined,
  }),
  component: NewTicketPage,
});
