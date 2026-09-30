"use client";

/**
 * components/leaderboard/AnonymousReveal.tsx
 *
 * Shared UI for leaderboard rows whose user chose to hide their name (paid
 * privacy setting; see lib/privacy/leaderboardAnonymity.ts).
 *
 *   - Public boards: the API already sends "Anonymous" — nothing to reveal.
 *   - Sub-leaderboards the viewer administers (classroom, guild board): the
 *     API also sends `revealed` identity; this renders a small "Reveal"
 *     control that swaps the real name in locally, and "Hide" to swap back.
 *   - The user's own row shows their real name plus a "Hidden from others" tag.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

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
      onClick={onToggle}
      className="ml-2 rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {shown ? t("leaderboard.anonymous.hide", "Hide") : t("leaderboard.anonymous.reveal", "Reveal")}
    </button>
  );
}

/** Small tag shown on the viewer's own hidden row. */
export function HiddenFromOthersTag() {
  const { t } = useTranslation();
  return (
    <span className="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {t("leaderboard.anonymous.hiddenFromOthers", "Hidden from others")}
    </span>
  );
}
