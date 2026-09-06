/**
 * apps/android/src/routes/support/$ticketId.tsx
 *
 * Ticket thread — mirrors apps/web/app/(app)/support/[id]/page.tsx.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiClient } from '@/lib/api/client';

interface Message {
  id: string;
  sender_type: 'user' | 'staff' | 'ai';
  body: string;
  charged: boolean;
  charged_credits: number;
  charged_stars: number;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
}

function TicketDetailPage() {
  const { ticketId } = Route.useParams();
  const qc = useQueryClient();
  const [reply, setReply] = useState('');

  const { data } = useQuery({
    queryKey: ['support', 'ticket', ticketId],
    queryFn: async () => (await apiClient.get<{ ticket: Ticket; messages: Message[] }>(`/support/tickets/${ticketId}`)).data,
  });

  const sendReply = useMutation({
    mutationFn: () => apiClient.post(`/support/tickets/${ticketId}`, { body: reply }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] });
    },
  });

  const rejectAi = useMutation({
    mutationFn: () => apiClient.post(`/support/tickets/${ticketId}/ai-reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] }),
  });

  if (!data) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-800" /></div>;

  const lastIsAi = data.messages.length > 0 && data.messages[data.messages.length - 1].sender_type === 'ai';

  return (
    <div className="p-4">
      <h1 className="mb-1 text-lg font-bold text-white">{data.ticket.subject}</h1>
      <p className="mb-4 text-sm text-neutral-500">Status: {data.ticket.status}</p>

      <div className="mb-4 space-y-3">
        {data.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl p-3 text-sm ${
              m.sender_type === 'ai' ? 'bg-purple-900/40 text-purple-200' : m.sender_type === 'staff' ? 'bg-primary-900/40 text-primary-200' : 'bg-neutral-800 text-white'
            }`}
          >
            <p className="mb-1 text-xs font-semibold uppercase opacity-70">{m.sender_type === 'ai' ? 'AI Assistant' : m.sender_type === 'staff' ? 'Support' : 'You'}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      {lastIsAi && data.ticket.status !== 'closed' && (
        <button onClick={() => rejectAi.mutate()} className="mb-4 w-full rounded-xl border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-400">
          This didn&apos;t help — talk to a real person
        </button>
      )}

      {data.ticket.status !== 'closed' && (
        <div className="flex gap-2">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Type a message…" className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
          <button onClick={() => sendReply.mutate()} disabled={sendReply.isPending || !reply.trim()} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Send
          </button>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/support/$ticketId')({
  component: TicketDetailPage,
});
