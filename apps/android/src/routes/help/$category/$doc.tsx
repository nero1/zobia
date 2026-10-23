/**
 * apps/android/src/routes/help/$category.$doc.tsx
 *
 * Help Center doc page — mirrors apps/web/app/help/[category]/[doc]/page.tsx,
 * including the "Ask AI" block (Feature 2 §5-6). Renders body_html (already
 * sanitized server-side via lib/security/htmlSanitizer.ts, same as blog posts).
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface DocResponse {
  category: { slug: string; name: string };
  doc: { id: string; title: string; body_html: string };
}

function AskAi({ docId, docTitle }: { docId: string; docTitle: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useAuth();
  const isAuthenticated = !!token;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number; cost: number; resetsAt: string } | null>(null);
  const [quotaReached, setQuotaReached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (confirmPaid: boolean) => {
      requestId.current ??= crypto.randomUUID();
      return apiClient.post<{ answer: string; usage: { used: number; limit: number; cost: number; resetsAt: string } }>('/help/ask-ai', { question, docId, requestId: requestId.current, confirmPaid, confirmedCost: confirmPaid ? usage?.cost : undefined });
    },
    onSuccess: (res) => { setAnswer(res.data.answer); setUsage(res.data.usage); requestId.current = null; },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'HELP_AI_WEEKLY_LIMIT') {
        setUsage(err.response.data.error.params); setQuotaReached(true); return;
      }
      requestId.current = null;
      const fallback = t('help.askAi.unavailable', 'The AI assistant is unavailable right now.');
      setError(isAxiosError(err) ? err.response?.data?.error?.message ?? fallback : fallback);
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
        <p className="mb-3 text-sm text-neutral-400 dark:text-neutral-500">{t('help.askAi.loggedOutPrompt', "Can't find what you're looking for? Log in or sign up to ask the AI assistant or contact a support staff member.")}</p>
        <Link to="/auth/login" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">{t('auth.login', 'Log in')}</Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="mb-1 text-sm font-semibold text-white">{t('help.askAi.title', 'Ask AI')}</p>
      <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">{t('help.askAi.subtext', "Can't find what you're looking for? Try asking the AI.")}</p>
      {usage && (usage.used >= 11 || quotaReached) && <p className="mb-3 text-xs">{t('helpQuota.usage', '{{used}}/{{limit}} questions used; {{remaining}} included questions left. Resets {{date}}.', { used: usage.used, limit: usage.limit, remaining: Math.max(0, usage.limit - usage.used), date: new Date(usage.resetsAt).toLocaleString() })} <Link to={'/settings/subscription' as never} className="underline">{t('helpQuota.upgrade', 'Upgrade your plan')}</Link></p>}
      {quotaReached && usage && usage.cost > 0 && <button disabled={ask.isPending} className="mb-3 rounded-lg border px-4 py-2 text-sm" onClick={() => { if (window.confirm(t('helpQuota.confirm', 'Deduct {{cost}} credits from your wallet for this question?', { cost: usage.cost }))) ask.mutate(true); }}>{t('helpQuota.pay', 'Ask for {{cost}} credits', { cost: usage.cost })}</button>}
      {!answer ? (
        <div className="flex gap-2">
          <input value={question} onChange={(e) => { setQuestion(e.target.value); requestId.current = null; setQuotaReached(false); }} placeholder={t('help.askAi.placeholder', 'Ask a question about this topic…')} className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white" />
          <button onClick={() => ask.mutate(false)} disabled={ask.isPending || !question.trim()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {t('help.askAi.ask', 'Ask')}
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-3 rounded-lg bg-neutral-950 p-3 text-sm text-white">{answer}</div>
          <button
            onClick={() => navigate({ to: '/support/new', search: { prefillSubject: `Re: ${docTitle}`, prefillBody: `My question: ${question}\n\nAI answer: ${answer}`, docId } })}
            className="rounded-lg border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-400"
          >
            {t('help.askAi.contactHuman', 'Contact a real person')}
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
