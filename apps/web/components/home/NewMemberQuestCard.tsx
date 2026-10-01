"use client";

/**
 * components/home/NewMemberQuestCard.tsx
 *
 * Home Dashboard New Member Quest card. Fetches GET /api/quests/new-member;
 * never shown once the quest is fully complete. Dismissal (X button) uses
 * useNewMemberQuestDismissal — 7-day snooze normally, and past the 4th
 * dismissal a small confirm ("remind me later" vs "don't remind me again")
 * per the product spec.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useCurrentUserId } from "@/lib/hooks/useCurrentUserId";
import { useNewMemberQuestDismissal } from "@/lib/hooks/useNewMemberQuestDismissal";
import { Icon } from "@/components/ui/Icon";

interface QuestStep { id: string; title: string; completed: boolean; }
interface QuestState { steps: QuestStep[]; allComplete: boolean; rewardClaimed: boolean; }
interface QuestResponse {
  data?: { steps?: Array<{ id: string; label: string; completed: boolean }>; allComplete?: boolean; rewardClaimed?: boolean };
}

function toQuestState(d: QuestResponse | null): QuestState | null {
  const qd = d?.data;
  if (!qd) return null;
  return {
    steps: (qd.steps ?? []).map((s) => ({ id: s.id, title: s.label, completed: s.completed })),
    allComplete: Boolean(qd.allComplete),
    rewardClaimed: Boolean(qd.rewardClaimed),
  };
}

const TOTAL_COINS = 1000;
const TOTAL_XP = 2000;

export function NewMemberQuestCard({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const userId = useCurrentUserId();
  const { shouldShow, needsConfirm, dismiss, dontRemindAgain } = useNewMemberQuestDismissal(userId);

  const [quest, setQuest] = useState<QuestState | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/quests/new-member", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: QuestResponse | null) => { if (active) setQuest(toQuestState(d)); })
        .catch(() => { if (active) setQuest(null); });
    void load();
    // Progress is advanced by actions on other screens; re-read when the user
    // comes back to this tab/app (the read cache is dropped on every write).
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  async function claimReward() {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/quests/new-member", { method: "POST", credentials: "include" });
      // 409 means it was already claimed (another tab/device): same end state.
      if (res.ok || res.status === 409) {
        setQuest((q) => (q ? { ...q, rewardClaimed: true } : q));
      }
    } finally {
      setClaiming(false);
    }
  }

  if (quest === undefined) return null; // avoid a flash of skeleton for a low-priority card
  if (!quest || quest.rewardClaimed) return null;
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
    <div className="rounded-xl border border-violet-200 bg-white shadow-sm dark:border-violet-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3 dark:border-violet-900">
        <div className="flex items-center gap-2">
          <Icon emoji="🎯" size={18} />
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-50">{t("home.newMemberQuest.title")}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-neutral-500 tabular-nums">{completedCount}/{totalCount}</span>
          {!alwaysShow && (
            <button
              onClick={handleCloseClick}
              className="text-neutral-400 hover:text-neutral-600"
              aria-label={t("action.close")}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {confirming && !alwaysShow ? (
        <div className="px-4 py-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("home.newMemberQuest.confirmMessage")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => { setConfirming(false); dismiss(); }}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t("home.newMemberQuest.remindLater")}
            </button>
            <button
              onClick={() => { setConfirming(false); dontRemindAgain(); }}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
            >
              {t("home.newMemberQuest.dontRemind")}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-3">
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-right text-xs text-neutral-400">{t("home.newMemberQuest.percentComplete", { pct: progressPct })}</p>
          </div>
          <div className="space-y-2">
            {quest.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2.5">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${step.completed ? "border-teal-500 bg-teal-500 text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                  {step.completed && <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                <span className={`text-sm ${step.completed ? "text-neutral-400 line-through" : "text-neutral-700 dark:text-neutral-300"}`}>{t(`home.newMemberQuest.steps.${step.id}`, { defaultValue: step.title })}</span>
              </div>
            ))}
          </div>
          {quest.allComplete && (
            <button
              onClick={claimReward}
              disabled={claiming}
              className="mt-3 w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {t("home.newMemberQuest.claim")}
            </button>
          )}
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              {t("home.newMemberQuest.reward", { coins: TOTAL_COINS.toLocaleString(), coinName: currency.softPlural, xp: TOTAL_XP.toLocaleString() })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
