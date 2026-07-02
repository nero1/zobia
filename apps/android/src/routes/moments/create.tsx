/**
 * apps/android/src/routes/moments/create.tsx
 *
 * Create a Moment — mirrors apps/web/app/(app)/moments/create/page.tsx.
 * POST /api/moments.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { useMomentsConfig } from '@/lib/hooks/useMomentsConfig';

const MAX_CONTENT = 500;
const MAX_CAPTION = 200;

interface InsufficientFundsInfo {
  costCredits: number;
  costStars: number;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    params?: { costCredits?: number; costStars?: number; minLevel?: number; currentLevel?: number };
  };
}

function CreateMomentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currency = useCurrency();
  const momentsConfig = useMomentsConfig();

  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [optionalExpanded, setOptionalExpanded] = useState(false);
  const [payCurrency, setPayCurrency] = useState<'credits' | 'stars'>('credits');
  const [insufficientFunds, setInsufficientFunds] = useState<InsufficientFundsInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const bothCurrenciesAvailable = momentsConfig.costCredits > 0 && momentsConfig.costStars > 0;

  const createMoment = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { content: content.trim() };
      if (imageUrl.trim()) {
        body.media_url = imageUrl.trim();
        body.content_type = 'image';
      }
      if (caption.trim()) body.caption = caption.trim();
      if (!momentsConfig.isFree) body.currency = payCurrency;
      return apiClient.post('/moments', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moments', 'feed'] });
      navigate({ to: '/moments' });
    },
    onError: (err) => {
      if (isAxiosError<ApiErrorBody>(err)) {
        const code = err.response?.data?.error?.code;
        const params = err.response?.data?.error?.params;
        if (code === 'INSUFFICIENT_MOMENT_FUNDS') {
          setInsufficientFunds({
            costCredits: params?.costCredits ?? momentsConfig.costCredits,
            costStars: params?.costStars ?? momentsConfig.costStars,
          });
          return;
        }
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('moments.create.title')}</h1>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Content */}
      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('moments.create.whatsHappening')}</h2>
        </div>
        <div className="p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT))}
            placeholder={t('moments.create.placeholder')}
            rows={4}
            maxLength={MAX_CONTENT}
            className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
          />
          <div className="mt-1.5 flex justify-end">
            <span className={`text-xs tabular-nums ${content.length >= MAX_CONTENT ? 'text-red-500' : 'text-neutral-400'}`}>
              {content.length}/{MAX_CONTENT}
            </span>
          </div>
        </div>
      </div>

      {/* Optional fields — collapsed by default */}
      <div className="bg-white rounded-xl shadow-card">
        <button
          type="button"
          onClick={() => setOptionalExpanded((v) => !v)}
          aria-expanded={optionalExpanded}
          className="flex w-full items-center justify-between border-b border-neutral-100 px-4 py-3"
        >
          <h2 className="text-sm font-semibold text-neutral-700">{t('moments.create.optional')}</h2>
          <span className="text-xs text-neutral-400">{optionalExpanded ? '▲' : '▼'}</span>
        </button>
        {optionalExpanded && (
          <div className="space-y-4 p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700">{t('moments.create.imageUrl')}</label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder={t('moments.create.imageUrlPlaceholder')}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700">{t('moments.create.caption')}</label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
                placeholder={t('moments.create.captionPlaceholder')}
                maxLength={MAX_CAPTION}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Pricing notice + currency picker */}
      {!momentsConfig.isFree && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800">
            {t('moments.create.costNotice', {
              cost: payCurrency === 'credits' ? momentsConfig.costCredits : momentsConfig.costStars,
              currency: payCurrency === 'credits' ? currency.softPlural : currency.premiumPlural,
            })}
          </p>
          {bothCurrenciesAvailable && (
            <div className="flex overflow-hidden rounded-lg border border-amber-300">
              <button
                type="button"
                onClick={() => setPayCurrency('credits')}
                className={`px-2.5 py-1 text-xs font-semibold ${payCurrency === 'credits' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700'}`}
              >
                {currency.softPlural}
              </button>
              <button
                type="button"
                onClick={() => setPayCurrency('stars')}
                className={`px-2.5 py-1 text-xs font-semibold ${payCurrency === 'stars' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700'}`}
              >
                {currency.premiumPlural}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Link to="/moments" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700">
          {t('moments.create.cancel')}
        </Link>
        <button
          type="button"
          onClick={() => createMoment.mutate()}
          disabled={!content.trim() || createMoment.isPending}
          className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createMoment.isPending ? t('moments.create.posting') : t('moments.create.post')}
        </button>
      </div>

      {/* Insufficient funds popup */}
      {insufficientFunds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setInsufficientFunds(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setInsufficientFunds(null)}
              className="absolute right-4 top-4 text-neutral-400"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900">
              {t('moments.create.insufficientTitle', { currency: `${currency.softPlural}/${currency.premiumPlural}` })}
            </h2>
            <p className="mb-4 text-sm text-neutral-600">
              {t('moments.create.insufficientMessage', {
                costCredits: insufficientFunds.costCredits,
                costStars: insufficientFunds.costStars,
              })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setInsufficientFunds(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700"
              >
                {t('moments.create.gotIt')}
              </button>
              <Link
                to="/settings"
                className="flex-1 rounded-xl bg-amber-500 py-2 text-center text-sm font-semibold text-white"
                onClick={() => setInsufficientFunds(null)}
              >
                {t('moments.create.buyCredits', { currency: currency.softPlural })}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/moments/create')({
  component: CreateMomentPage,
});
