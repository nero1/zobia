/**
 * apps/android/src/components/leaderboard/AnonymousReveal.tsx
 *
 * Mirrors apps/web/components/leaderboard/AnonymousReveal.tsx: shared UI for
 * leaderboard rows whose user chose to hide their name (paid privacy setting).
 * Public boards already arrive as "Anonymous"; sub-leaderboards the viewer
 * administers also carry `revealed` identity behind a small "Reveal" control.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface RevealedIdentity {
  username?: string;
  displayName?: string;
  display_name?: string;
  avatarEmoji?: string;
  avatar_emoji?: string;
}

/** Local reveal state for one row. */
export function useReveal(revealed: RevealedIdentity | undefined) {
  const [shown, setShown] = useState(false);
  return {
    canReveal: Boolean(revealed),
    shown: shown && Boolean(revealed),
    toggle: () => setShown((v) => !v),
  };
}

export function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows are often links; revealing must not navigate.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="ml-2 rounded border border-neutral-300 dark:border-neutral-600 px-1.5 py-0.5 text-[10px] font-semibold text-primary-600 dark:text-primary-300"
    >
      {shown ? t('leaderboard.anonymous.hide', 'Hide') : t('leaderboard.anonymous.reveal', 'Reveal')}
    </button>
  );
}

/** Small tag shown on the viewer's own hidden row. */
export function HiddenFromOthersTag() {
  const { t } = useTranslation();
  return (
    <span className="ml-2 rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:text-neutral-400">
      {t('leaderboard.anonymous.hiddenFromOthers', 'Hidden from others')}
    </span>
  );
}
