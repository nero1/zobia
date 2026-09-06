/**
 * apps/android/src/routes/help/$category.$doc.tsx
 *
 * Help Center doc page — mirrors apps/web/app/help/[category]/[doc]/page.tsx,
 * including the "Ask AI" block (Feature 2 §5-6). Renders body_html (already
 * sanitized server-side via lib/security/htmlSanitizer.ts, same as blog posts).
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface DocResponse {
  category: { slug: string; name: string };
  doc: { id: string; title: string; body_html: string };
}

function AskAi({ docId, docTitle }: { docId: string; docTitle: string }) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const isAuthenticated = !!token;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: () => apiClient.post<{ answer: string }>('/help/ask-ai', { question, docId }),
    onSuccess: (res) => setAnswer(res.data.answer),
    onError: (err) => setError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'AI unavailable' : 'AI unavailable'),
  });

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
        <p className="mb-3 text-sm text-neutral-400">Log in or sign up to ask the AI assistant or contact a support staff member.</p>
        <Link to="/auth/login" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Log in</Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="mb-1 text-sm font-semibold text-white">Ask AI</p>
      <p className="mb-3 text-xs text-neutral-400">Can&apos;t find what you&apos;re looking for? Try asking the AI.</p>
      {!answer ? (
        <div className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question…" className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white" />
          <button onClick={() => ask.mutate()} disabled={ask.isPending || !question.trim()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Ask
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-3 rounded-lg bg-neutral-950 p-3 text-sm text-white">{answer}</div>
          <button
            onClick={() => navigate({ to: '/support/new', search: { prefillSubject: `Re: ${docTitle}`, prefillBody: `My question: ${question}\n\nAI answer: ${answer}`, docId } })}
            className="rounded-lg border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-400"
          >
            Contact a real person
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function HelpDocPage() {
  const { category, doc } = Route.useParams();
  const { data } = useQuery({
    queryKey: ['help', 'doc', category, doc],
    queryFn: async () => (await apiClient.get<DocResponse>(`/help/docs/${category}/${doc}`)).data,
  });

  if (!data) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-800" /></div>;

  return (
    <div className="p-4">
      <Link to="/help/$category" params={{ category: data.category.slug }} className="text-sm text-primary-400 underline">&larr; {data.category.name}</Link>
      <h1 className="mt-2 mb-4 text-xl font-bold text-white">{data.doc.title}</h1>
      <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: data.doc.body_html }} />
      <div className="mt-8 border-t border-neutral-800 pt-6">
        <AskAi docId={data.doc.id} docTitle={data.doc.title} />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/help/$category/$doc')({
  component: HelpDocPage,
});
