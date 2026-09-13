/**
 * apps/android/src/components/home/NewMemberQuestCard.tsx
 *
 * Mirrors apps/web/components/home/NewMemberQuestCard.tsx. Fetches GET
 * /api/quests/new-member; never shown once the quest is fully complete.
 * Dismissal (X button) uses useNewMemberQuestDismissal — 7-day snooze
 * normally, and past the 4th dismissal a small confirm ("remind me later"
 * vs "don't remind me again") per the product spec.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { useNewMemberQuestDismissal } from '@/lib/hooks/useNewMemberQuestDismissal';

interface QuestStep {
  id: string;
  title: string;
  completed: boolean;
}
interface QuestState {
  steps: QuestStep[];
  allComplete: boolean;
}

const TOTAL_COINS = 1000;
const TOTAL_XP = 2000;

async function fetchNewMemberQuest(): Promise<QuestState | null> {
  const { data } = await apiClient.get<{ steps?: Array<{ id: string; label: string; completed: boolean }>; allComplete?: boolean }>(
    '/quests/new-member'
  );
  if (!data) return null;
  return {
    steps: (data.steps ?? []).map((s) => ({ id: s.id, title: s.label, completed: s.completed })),
    allComplete: Boolean(data.allComplete),
  };
}

export function NewMemberQuestCard({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const { user } = useAuth();
  const { shouldShow, needsConfirm, dismiss, dontRemindAgain } = useNewMemberQuestDismissal(user?.id ?? null);
  const { data: quest } = useQuery({ queryKey: ['home', 'quests', 'newMember'], queryFn: fetchNewMemberQuest });
  const [confirming, setConfirming] = useState(false);

  if (quest === undefined) return null; // avoid a flash of skeleton for a low-priority card
  if (!quest || quest.allComplete) return null;
  // The Home Dashboard card respects the localStorage dismiss/snooze state;
  // the dedicated Quests page (alwaysShow) is where users are told they can
  // "still find it" after dismissing it from Home, so it ignores that state
  // and never shows a close button.
  if (!alwaysShow && !shouldShow) return null;

  const completedCount = quest.steps.filter((s) => s.completed).length;
  const totalCount = quest.steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function handleCloseClick() {
    if (needsConfirm) {
      setConfirming(true);
    } else {
      dismiss();
    }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-white dark:bg-neutral-800 shadow-sm">
      <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('home.newMemberQuest.title')}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 tabular-nums">
            {completedCount}/{totalCount}
          </span>
          {!alwaysShow && (
            <button type="button" onClick={handleCloseClick} className="text-neutral-400 dark:text-neutral-500" aria-label={t('action.close')}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {confirming && !alwaysShow ? (
        <div className="px-4 py-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('home.newMemberQuest.confirmMessage')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                dismiss();
              }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              {t('home.newMemberQuest.remindLater')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                dontRemindAgain();
              }}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white"
            >
              {t('home.newMemberQuest.dontRemind')}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-3">
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-right text-xs text-neutral-400 dark:text-neutral-500">{t('home.newMemberQuest.percentComplete', { pct: progressPct })}</p>
          </div>
          <div className="space-y-2">
            {quest.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2.5">
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${step.completed ? 'border-teal-500 bg-teal-500 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}
                >
                  {step.completed && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm ${step.completed ? 'text-neutral-400 dark:text-neutral-500 line-through' : 'text-neutral-700 dark:text-neutral-300'}`}>{step.title}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              {t('home.newMemberQuest.reward', {
                coins: TOTAL_COINS.toLocaleString(),
                coinName: currency.softPlural,
                xp: TOTAL_XP.toLocaleString(),
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
