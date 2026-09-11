/**
 * apps/android/src/routes/tweets/create.tsx
 *
 * Mirrors apps/web/app/(app)/tweets/create/page.tsx. Draft persistence uses
 * localStorage namespaced by the signed-in user's id, same as the web
 * version, so a shared device never leaks one person's draft to the next.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useTweetsConfig } from '@/lib/hooks/useTweetsConfig';
import { useTweetLengthPolicy } from '@/lib/hooks/useTweetLengthPolicy';
import type { TweetVideoProvider } from '@/components/tweets/types';

interface InsufficientFundsInfo {
  costCredits: number;
  kind: 'image' | 'length';
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    params?: { costCredits?: number; minLevel?: number; currentLevel?: number };
  };
}

function CreateTweetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tweetsConfig = useTweetsConfig();
  const lengthPolicy = useTweetLengthPolicy();
  const draftKey = user ? `tweets_draft_${user.id}` : null;

  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [videoProvider, setVideoProvider] = useState<TweetVideoProvider | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [showVideoPicker, setShowVideoPicker] = useState(false);
  const [showVideoHelp, setShowVideoHelp] = useState(false);
  const [insufficientFunds, setInsufficientFunds] = useState<InsufficientFundsInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setContent(saved);
    } catch {
      // localStorage unavailable — no draft restore
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      if (content.trim()) window.localStorage.setItem(draftKey, content);
      else window.localStorage.removeItem(draftKey);
    } catch {
      // Non-fatal
    }
  }, [draftKey, content]);

  function clearDraft() {
    if (!draftKey) return;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // Non-fatal
    }
  }

  async function handleUploadImage(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<{ url: string }>('/tweets/uploads/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImageUrl(res.data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const createTweet = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      if (content.trim()) body.content = content.trim();
      if (imageUrl.trim()) body.image_url = imageUrl.trim();
      if (videoProvider && videoUrl.trim()) {
        body.video_provider = videoProvider;
        body.video_url = videoUrl.trim();
      }
      return apiClient.post('/tweets', body);
    },
    onSuccess: () => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ['tweets', 'feed'] });
      navigate({ to: '/tweets' });
    },
    onError: (err) => {
      if (isAxiosError<ApiErrorBody>(err)) {
        const code = err.response?.data?.error?.code;
        const params = err.response?.data?.error?.params;
        if (code === 'INSUFFICIENT_TWEET_IMAGE_FUNDS') {
          setInsufficientFunds({ costCredits: params?.costCredits ?? tweetsConfig.imageCostCredits, kind: 'image' });
          return;
        }
        if (code === 'INSUFFICIENT_TWEET_LENGTH_FUNDS') {
          setInsufficientFunds({ costCredits: params?.costCredits ?? lengthPolicy.longTweetCostCredits, kind: 'length' });
          return;
        }
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  const canSubmit = Boolean(content.trim() || imageUrl || (videoProvider && videoUrl.trim()));

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('tweets.create.title')}</h1>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      <div className="bg-white rounded-xl shadow-card p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, lengthPolicy.personalMaxLength))}
          placeholder={t('tweets.create.placeholder')}
          rows={4}
          maxLength={lengthPolicy.personalMaxLength}
          className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          {content.length > lengthPolicy.defaultMaxLength && !lengthPolicy.isLongFormExempt ? (
            <span className="text-xs font-semibold text-amber-700">
              {t('tweets.create.longTweetCostNotice', { cost: lengthPolicy.longTweetCostCredits })}
            </span>
          ) : (
            <span />
          )}
          <span className={`text-xs tabular-nums ${content.length >= lengthPolicy.personalMaxLength ? 'text-red-500' : 'text-neutral-400'}`}>
            {content.length}/{lengthPolicy.personalMaxLength}
          </span>
        </div>
      </div>

      {/* Image upload */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <label className="mb-1 block text-xs font-semibold text-neutral-700">{t('tweets.create.image')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            id="tweet-image-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadImage(f);
            }}
          />
          <label htmlFor="tweet-image-input" className="cursor-pointer rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-600">
            {uploading ? t('tweets.create.uploading') : t('tweets.create.addImage')}
          </label>
          {imageUrl && (
            <button type="button" onClick={() => setImageUrl('')} className="text-xs font-semibold text-danger-600">
              {t('tweets.create.removeImage')}
            </button>
          )}
        </div>
        {!tweetsConfig.imageIsFree && (
          <p className="mt-1.5 text-xs text-amber-700">{t('tweets.create.imageCostNotice', { cost: tweetsConfig.imageCostCredits })}</p>
        )}
        {uploadError && <p className="mt-1.5 text-xs text-danger-600">{uploadError}</p>}
        {imageUrl && <img src={imageUrl} alt="" className="mt-2 max-h-48 rounded-lg border border-neutral-200" />}
      </div>

      {/* Video embed */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold text-neutral-700">{t('tweets.create.video')}</label>
          <span className="text-xs font-semibold text-green-600">{t('tweets.create.videoFree')}</span>
        </div>
        {!videoProvider ? (
          <button
            type="button"
            onClick={() => setShowVideoPicker((v) => !v)}
            className="rounded-xl border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-600"
          >
            {t('tweets.create.addVideo')}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold capitalize text-neutral-700">
                {videoProvider}
              </span>
              <button type="button" onClick={() => { setVideoProvider(null); setVideoUrl(''); }} className="text-xs font-semibold text-danger-600">
                {t('tweets.create.removeVideo')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder={videoProvider === 'youtube' ? 'https://youtube.com/watch?v=...' : 'https://www.tiktok.com/@user/video/...'}
                className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowVideoHelp(true)}
                aria-label={t('tweets.create.videoHelpAria')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-sm font-bold text-neutral-500"
              >
                ?
              </button>
            </div>
          </div>
        )}
        {showVideoPicker && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { setVideoProvider('youtube'); setShowVideoPicker(false); }}
              className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700"
            >
              ▶️ YouTube
            </button>
            <button
              type="button"
              onClick={() => { setVideoProvider('tiktok'); setShowVideoPicker(false); }}
              className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700"
            >
              🎵 TikTok
            </button>
          </div>
        )}
      </div>

      {tweetsConfig.minLevel > 1 && (
        <p className="text-xs text-neutral-400">{t('tweets.create.levelNotice', { minLevel: tweetsConfig.minLevel })}</p>
      )}

      <div className="flex gap-3">
        <Link to="/tweets" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700">
          {t('tweets.create.cancel')}
        </Link>
        <button
          type="button"
          onClick={() => createTweet.mutate()}
          disabled={!canSubmit || createTweet.isPending || uploading}
          className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createTweet.isPending ? t('tweets.create.posting') : t('tweets.create.post')}
        </button>
      </div>

      {showVideoHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowVideoHelp(false)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowVideoHelp(false)} className="absolute right-4 top-4 text-neutral-400" aria-label="Close">
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900">{t('tweets.create.videoHelpTitle')}</h2>
            <p className="mb-3 text-sm text-neutral-600">
              {t(videoProvider === 'tiktok' ? 'tweets.create.videoHelpTiktok' : 'tweets.create.videoHelpYoutube')}
            </p>
            <button onClick={() => setShowVideoHelp(false)} className="w-full rounded-xl bg-primary-600 py-2 text-sm font-semibold text-white">
              {t('moments.create.gotIt')}
            </button>
          </div>
        </div>
      )}

      {insufficientFunds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setInsufficientFunds(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setInsufficientFunds(null)} className="absolute right-4 top-4 text-neutral-400" aria-label="Close">
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900">{t('tweets.create.insufficientTitle')}</h2>
            <p className="mb-4 text-sm text-neutral-600">
              {t(
                insufficientFunds.kind === 'length' ? 'tweets.create.insufficientLengthMessage' : 'tweets.create.insufficientMessage',
                { costCredits: insufficientFunds.costCredits }
              )}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setInsufficientFunds(null)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700">
                {t('moments.create.gotIt')}
              </button>
              <Link to="/settings" className="flex-1 rounded-xl bg-amber-500 py-2 text-center text-sm font-semibold text-white" onClick={() => setInsufficientFunds(null)}>
                {t('tweets.create.buyCredits')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/tweets/create')({
  component: CreateTweetPage,
});
