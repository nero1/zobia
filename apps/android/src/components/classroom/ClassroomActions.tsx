/**
 * apps/android/src/components/classroom/ClassroomActions.tsx
 *
 * Share + Boost buttons for a classroom — the Android counterparts of web's
 * ClassroomShareButton and BoostContentButton.
 *
 *  - Share: the public https://<web>/c/<slug> URL (a verified App Link, so it
 *    opens straight back into this app on other Android devices) via the
 *    Web Share sheet, with a copy-link fallback. The share is recorded for
 *    the creator's stats (best effort).
 *  - Boost: the same pipeline as web — GET /api/ads/boostable → POST
 *    /api/content/boost (creates the ad_campaigns row + moderation) →
 *    optional POST /api/business/ads/campaigns/:id/fund from the Ad Wallet.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { referralLink, PUBLIC_PATHS } from '@/lib/deeplinks/routes';
import { useMyReferralCode } from '@/lib/referral/useReferralCode';
import { apiError } from '@/lib/classroom/api';

const btn = 'rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300';

export function ClassroomShareButton({ roomId, slug, name }: { roomId: string; slug: string | null; name: string }) {
  const { t } = useTranslation();
  const { code: refCode } = useMyReferralCode();
  const [notice, setNotice] = useState<string | null>(null);

  async function share() {
    const url = referralLink(PUBLIC_PATHS.course(slug ?? roomId), refCode);
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setNotice(t('classroom.share.linkCopied', 'Link copied!'));
        setTimeout(() => setNotice(null), 2500);
      }
    } catch {
      /* share sheet dismissed */
    }
    apiClient.post(`/classroom/${roomId}/share`).catch(() => {});
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={() => void share()} className={btn}>
        🔗 {t('classroom.share.button', 'Share')}
      </button>
      {notice && <span className="text-xs text-teal-600">{notice}</span>}
    </span>
  );
}

interface Boostable {
  boostable: boolean;
  reason: string | null;
}

const DURATIONS = [
  { key: '3d', days: 3 },
  { key: '1w', days: 7 },
  { key: '2w', days: 14 },
  { key: '1m', days: 30 },
  { key: 'none', days: null },
] as const;

export function ClassroomBoostButton({ roomId, name }: { roomId: string; name: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<Boostable | null>(null);
  const [budget, setBudget] = useState(1000);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]['key']>('1w');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setMsg(null);
    setCheck(null);
    try {
      const { data } = await apiClient.get<Boostable>('/ads/boostable', { params: { contentType: 'classroom', contentId: roomId } });
      setCheck(data);
    } catch (e) {
      setMsg(apiError(e).message);
    }
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const days = DURATIONS.find((d) => d.key === duration)?.days ?? null;
      const endAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined;
      const { data } = await apiClient.post<{ campaign: { id: string }; moderation: { moderationStatus: string } }>('/content/boost', {
        contentType: 'classroom',
        contentId: roomId,
        endAt,
      });
      let fundNote = '';
      if (budget > 0) {
        try {
          await apiClient.post(`/business/ads/campaigns/${data.campaign.id}/fund`, { amountCredits: budget });
        } catch (e) {
          fundNote = ` ${t('ads.boost.fundFailedNote', 'Boost created, but not funded: {{reason}}. Fund it from the Advertising Panel to start running.', { reason: apiError(e).message })}`;
        }
      }
      setMsg(
        (data.moderation.moderationStatus === 'approved'
          ? t('ads.boost.successBodyApproved', 'Your boost was approved and will start running once funded.')
          : t('ads.boost.successBodyPending', 'Your boost is pending moderation review before it starts running.')) + fundNote
      );
    } catch (e) {
      setMsg(apiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void openModal()} className={btn}>
        🚀 {t('ads.boost.button', 'Boost')}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white dark:bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">🚀 {t('ads.boost.modalTitle', 'Boost this content')}</h2>
            <p className="truncate text-sm text-neutral-600 dark:text-neutral-400">{name}</p>
            {!check && !msg && <div className="h-12 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />}
            {check && !check.boostable && <p className="text-sm text-neutral-500">{check.reason ?? t('ads.boost.ineligibleDefault', "This content isn't eligible to be boosted right now.")}</p>}
            {check?.boostable && (
              <>
                <label className="block text-xs font-semibold text-neutral-500">
                  {t('ads.boost.budgetLabel', 'Budget (Credits)')}
                  <input type="number" min={0} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded-xl border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm" />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATIONS.map((d) => (
                    <button key={d.key} type="button" onClick={() => setDuration(d.key)} className={`rounded-lg border px-2.5 py-1 text-xs ${duration === d.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}>
                      {t(`ads.boost.duration.${d.key}`, d.days ? `${d.days}d` : 'No end date')}
                    </button>
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {busy ? t('ads.boost.submitting', 'Submitting…') : t('ads.boost.submit', 'Boost & Submit for Review')}
                </button>
              </>
            )}
            {msg && <p className="text-sm text-neutral-700 dark:text-neutral-300">{msg}</p>}
            <button type="button" onClick={() => setOpen(false)} className="w-full py-1 text-sm text-neutral-500">
              {t('ads.boost.close', 'Close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
