/**
 * apps/android/src/components/settings/CancelPlanModal.tsx
 *
 * Android port of apps/web/components/settings/CancelPlanModal.tsx.
 *
 * Personal Plus/Pro/Max plans purchased on Android go through Google Play
 * Billing (lib/payments/googlePlay.ts) and are tracked only via
 * `users.plan` — no row is ever written to the `subscriptions` table for
 * them (only Paystack-billed plans get one; see
 * app/api/economy/subscriptions/route.ts). Per Google Play policy, only
 * Play itself can actually stop a Play-billed recurring charge, so when
 * `managedByPlayStore` is true this modal's primary action opens the Play
 * Store subscription center instead of calling our own DELETE — calling our
 * DELETE alone would silently do nothing (no `subscriptions` row exists to
 * cancel) while giving the user false confidence they won't be charged
 * again.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';

export interface CancelPlanFeature {
  text: string;
  included: boolean;
}

type Step = 'confirm' | 'cancelling' | 'feedback' | 'thanks';

const REASON_KEYS = ['errors_bugs', 'missing_features', 'temporary_break', 'too_expensive', 'other'] as const;
type ReasonKey = (typeof REASON_KEYS)[number];

const FOLLOW_UP_QUESTION: Partial<Record<ReasonKey, string>> = {
  errors_bugs: 'What types of errors or bugs did you most frequently encounter?',
  missing_features: 'What kinds of features are you looking for that was missing?',
  too_expensive: 'How much do you suggest we charge?',
  other: 'What made you to cancel it?',
};

const PLAY_PACKAGE_NAME = 'com.zobiasocial.app';

export function CancelPlanModal({
  planName,
  endDate,
  features,
  managedByPlayStore,
  onKeepPlan,
  onConfirmCancel,
  onSubmitFeedback,
  onClose,
}: {
  planName: string;
  endDate: string | null;
  features: CancelPlanFeature[];
  /** True when this plan was purchased via Google Play Billing (no
   *  Paystack-tracked `subscriptions` row) — routes to Play Store instead
   *  of our own cancel endpoint. */
  managedByPlayStore: boolean;
  onKeepPlan: () => void;
  /** Only called when !managedByPlayStore. Thrown errors are shown inline. */
  onConfirmCancel: () => Promise<void>;
  onSubmitFeedback: (payload: { reasons: string[]; followUps: Record<string, string>; generalFeedback: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('confirm');
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Set<ReasonKey>>(new Set());
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasonLabels: Record<ReasonKey, string> = {
    errors_bugs: t('subscription.cancelSurvey.reason.errorsBugs', 'I kept running into errors or bugs'),
    missing_features: t('subscription.cancelSurvey.reason.missingFeatures', "Zobia doesn't have the features I need"),
    temporary_break: t('subscription.cancelSurvey.reason.temporaryBreak', "I'm taking a temporary break"),
    too_expensive: t('subscription.cancelSurvey.reason.tooExpensive', 'The subscription cost is too high for me'),
    other: t('subscription.cancelSurvey.reason.other', "My reason for cancelling isn't listed above"),
  };

  const lostBenefits = features.filter((f) => f.included);

  async function handlePrimaryAction() {
    if (managedByPlayStore) {
      await Browser.open({
        url: `https://play.google.com/store/account/subscriptions?package=${PLAY_PACKAGE_NAME}`,
        presentationStyle: 'popover',
      });
      onClose();
      return;
    }
    setError(null);
    setStep('cancelling');
    try {
      await onConfirmCancel();
      setStep('feedback');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('subscription.cancelFailed', 'Cancel failed'));
      setStep('confirm');
    }
  }

  function toggleReason(key: ReasonKey) {
    setReasons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submitFeedback() {
    setSubmitting(true);
    try {
      await onSubmitFeedback({
        reasons: Array.from(reasons),
        followUps,
        generalFeedback: generalFeedback.trim() || null,
      }).catch(() => {});
    } finally {
      setSubmitting(false);
      setStep('thanks');
      setTimeout(onClose, 1400);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 p-5">
        {step === 'confirm' && (
          <>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {t('subscription.cancelModal.title', 'Cancel plan')}
            </h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t('subscription.cancelModal.onPlan', 'You are on the {{plan}} plan.', { plan: planName })}
            </p>
            {managedByPlayStore ? (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
                {t(
                  'subscription.cancelModal.playStoreBody',
                  'This plan was purchased through Google Play. To stop future billing, manage or cancel it from your Play Store subscriptions.'
                )}
              </p>
            ) : (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
                {endDate
                  ? t(
                      'subscription.cancelModal.body',
                      "Cancel to stop recurring billing. After cancelling you can still use Zobia {{plan}} until your current plan ends, which is on {{date}}.",
                      { plan: planName, date: endDate }
                    )
                  : t('subscription.cancelModal.bodyNoDate', 'Cancel to stop recurring billing.')}
              </p>
            )}
            {lostBenefits.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("subscription.cancelModal.afterThat", "After that date, you'll lose access to the following {{plan}} benefits:", { plan: planName })}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {lostBenefits.map((f) => (
                    <li key={f.text} className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                      <span className="text-red-500">✕</span> {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => void handlePrimaryAction()}
                className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white"
              >
                {managedByPlayStore
                  ? t('subscription.cancelModal.manageInPlayStore', 'Manage in Play Store')
                  : t('subscription.cancelModal.cancelPlan', 'Cancel Plan')}
              </button>
              <button
                type="button"
                onClick={onKeepPlan}
                className="w-full rounded-full border border-neutral-300 dark:border-neutral-700 py-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300"
              >
                {t('subscription.cancelModal.keepPlan', 'Keep my {{plan}} plan', { plan: planName })}
              </button>
            </div>
          </>
        )}

        {step === 'cancelling' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 dark:border-neutral-700 border-t-red-600" />
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('subscription.cancelModal.cancelling', 'Cancelling plan…')}</p>
          </div>
        )}

        {step === 'feedback' && (
          <>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {t('subscription.cancelSurvey.title', 'Plan Cancelled Successfully.')}
            </h2>
            <p className="mt-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {t('subscription.cancelSurvey.subtitle', 'Before You Go — Please Help Us Improve')}
            </p>

            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {t('subscription.cancelSurvey.reasonPrompt', 'What is your main reason for canceling?')}
            </p>
            <div className="mt-2 space-y-1.5">
              {REASON_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <input type="checkbox" checked={reasons.has(key)} onChange={() => toggleReason(key)} />
                  {reasonLabels[key]}
                </label>
              ))}
            </div>

            {REASON_KEYS.filter((key) => reasons.has(key) && FOLLOW_UP_QUESTION[key]).map((key) => (
              <div key={key} className="mt-3">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{FOLLOW_UP_QUESTION[key]}</label>
                <textarea
                  maxLength={500}
                  rows={2}
                  value={followUps[key] ?? ''}
                  onChange={(e) => setFollowUps((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                />
                <p className="text-right text-[10px] text-neutral-400">{followUps[key]?.length ?? 0}/500</p>
              </div>
            ))}

            <div className="mt-4">
              <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                {t('subscription.cancelSurvey.additionalFeedback', 'Any additional feedback, requests or suggestions?')}
              </label>
              <textarea
                maxLength={500}
                rows={3}
                value={generalFeedback}
                onChange={(e) => setGeneralFeedback(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              />
              <p className="text-right text-[10px] text-neutral-400">{generalFeedback.length}/500</p>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('thanks');
                  setTimeout(onClose, 1000);
                }}
                disabled={submitting}
                className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 py-2.5 text-sm font-semibold text-neutral-600 dark:text-neutral-300 disabled:opacity-60"
              >
                {t('subscription.cancelSurvey.skip', 'Skip')}
              </button>
              <button
                type="button"
                onClick={() => void submitFeedback()}
                disabled={submitting}
                className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {submitting ? t('subscription.cancelSurvey.submitting', 'Submitting…') : t('subscription.cancelSurvey.submit', 'Submit')}
              </button>
            </div>
          </>
        )}

        {step === 'thanks' && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="text-3xl">💜</span>
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              {t('subscription.cancelSurvey.thanks', 'Thank you!')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
