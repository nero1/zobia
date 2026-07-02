"use client";

/**
 * app/(app)/home/page.tsx
 *
 * Home feed page (web version).
 * Sections: Activity Banner, Mystery XP Drop toast, Nemesis Widget,
 * Daily Quest Deck, Online Friends Row, Leaderboard Position card,
 * Guild Discovery panel (PRD §4 — shown when user has no guild).
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ActivityBanner } from "@/components/ui/ActivityBanner";
import { OnlineRing } from "@/components/ui/OnlineRing";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { CreatorSpotlight } from "@/components/discovery/CreatorSpotlight";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useFloatingNotification } from "@/hooks/useFloatingNotification";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformEvent {
  name: string;
  description: string;
  xp_multiplier: number;
}

interface NemesisData {
  rivalUserId: string;
  rivalUsername: string;
  rivalAvatarEmoji: string;
  myXP: number;
  rivalXP: number;
}

interface NemesisApiResponse {
  me: { userId: string; displayName: string; avatarEmoji: string; xp: number } | null;
  nemesis: { userId: string; displayName: string; avatarEmoji: string; xp: number } | null;
  comparison?: { userXP: number; nemesisXP: number; delta: number; userIsAhead: boolean } | null;
}

interface DailyQuest {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  coinReward: number;
  progress: number;
  goal: number;
  completed: boolean;
}

interface DailyQuestApiRow {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  xp_reward?: unknown;
  xpReward?: unknown;
  coin_reward?: unknown;
  coinReward?: unknown;
  progress_count?: unknown;
  progress?: unknown;
  target_count?: unknown;
  goal?: unknown;
  completed?: unknown;
}

interface Friend {
  userId: string;
  username: string;
  avatarEmoji: string;
  isOnline?: boolean;
}

interface LeaderboardPosition {
  rank: number;
  rankDelta: number; // positive = moved up, negative = moved down
  xp: number;
}

interface DiscoveryGuild {
  id: string;
  name: string;
  crestEmoji: string;
  tier: string;
  memberCount: number;
  warWins: number;
  city: string | null;
}

interface MysteryDropNotification {
  xpAmount: number;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Skeleton helpers
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

// ---------------------------------------------------------------------------
// Nemesis Widget
// ---------------------------------------------------------------------------

function NemesisSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <SkeletonBlock className="mb-3 h-4 w-24" />
      <div className="flex items-center gap-4">
        <SkeletonBlock className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-2 w-full" />
        </div>
        <SkeletonBlock className="h-12 w-12 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-9 w-full rounded-xl" />
    </div>
  );
}

interface NemesisWidgetProps {
  data: NemesisData;
  onChallenge: () => Promise<void>;
  challenging: boolean;
}

function NemesisWidget({ data, onChallenge, challenging }: NemesisWidgetProps) {
  const total = data.myXP + data.rivalXP;
  const myPct = total > 0 ? Math.round((data.myXP / total) * 100) : 50;
  const ahead = data.myXP >= data.rivalXP;
  const diff = Math.abs(data.myXP - data.rivalXP);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Your Nemesis</h2>
      <div className="flex items-center gap-4">
        {/* My avatar placeholder */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900">
          🧑
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-blue-600">You</span>
            <span className="font-semibold text-red-600">@{data.rivalUsername}</span>
          </div>
          {/* XP comparison bar */}
          <div className="h-3 overflow-hidden rounded-full bg-red-100 dark:bg-red-900/30">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${myPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            {ahead ? (
              <span className="text-teal-600">You&apos;re ahead by {diff.toLocaleString()} XP</span>
            ) : (
              <span className="text-red-600">Behind by {diff.toLocaleString()} XP</span>
            )}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-900">
          {data.rivalAvatarEmoji}
        </div>
      </div>
      <button
        onClick={onChallenge}
        disabled={challenging}
        className="mt-4 w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {challenging ? "Challenging…" : "⚔️ Challenge Rival"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Quest Deck
// ---------------------------------------------------------------------------

function QuestDeckSkeleton() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <SkeletonBlock className="h-4 w-28" />
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse px-5 py-4">
            <div className="flex items-start gap-3">
              <SkeletonBlock className="mt-0.5 h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-2 w-full rounded-full" />
              </div>
              <SkeletonBlock className="h-5 w-14 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface QuestDeckProps {
  quests: DailyQuest[];
}

function QuestDeck({ quests }: QuestDeckProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Daily Quests</h2>
      </div>
      {quests.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-neutral-500">No quests today. Check back soon!</div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {quests.map((q) => {
            const pct = q.goal > 0 ? Math.min(100, Math.round((q.progress / q.goal) * 100)) : 0;
            return (
              <div key={q.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${q.completed ? "border-teal-500 bg-teal-500 text-white" : "border-neutral-300 dark:border-neutral-600"}`}
                  >
                    {q.completed && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${q.completed ? "text-neutral-400 line-through dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"}`}>
                      {q.title}
                    </p>
                    {q.description && (
                      <p className="mt-0.5 text-xs text-neutral-500">{q.description}</p>
                    )}
                    {!q.completed && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                          <span className="tabular-nums">{q.progress} / {q.goal}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                    +{q.xpReward} XP
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Online Friends Row
// ---------------------------------------------------------------------------

function FriendsSkeleton() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <SkeletonBlock className="mb-3 h-4 w-28" />
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse flex flex-col items-center gap-1">
            <SkeletonBlock className="h-11 w-11 rounded-full" />
            <SkeletonBlock className="h-2.5 w-10 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface FriendsRowProps {
  friends: Friend[];
}

function FriendsRow({ friends }: FriendsRowProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Online Friends</h2>
      {friends.length === 0 ? (
        <p className="text-xs text-neutral-400">No friends online right now.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {friends.map((f) => (
            <Link key={f.userId} href={`/profile/${f.userId}`} className="flex flex-col items-center gap-1 hover:opacity-80">
              <OnlineRing userId={f.userId} size="md" knownStatus={f.isOnline ? "online" : "recently_active"}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
                  {f.avatarEmoji}
                </div>
              </OnlineRing>
              <span className="max-w-[3rem] truncate text-xs text-neutral-500">@{f.username}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard Position Card
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <SkeletonBlock className="mb-2 h-4 w-24" />
      <SkeletonBlock className="mb-1 h-8 w-32" />
      <SkeletonBlock className="h-3 w-20" />
    </div>
  );
}

interface LeaderboardCardProps {
  position: LeaderboardPosition;
}

function LeaderboardCard({ position }: LeaderboardCardProps) {
  const delta = position.rankDelta;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Your Leaderboard Rank</h2>
      <div className="flex items-end gap-2">
        <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          #{position.rank.toLocaleString()}
        </p>
        {delta !== 0 && (
          <span className={`mb-1 text-sm font-semibold ${delta > 0 ? "text-teal-600" : "text-red-500"}`}>
            {delta > 0 ? `+${delta}` : delta} today
          </span>
        )}
        {delta === 0 && (
          <span className="mb-1 text-sm text-neutral-400">no change today</span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-400">{position.xp.toLocaleString()} XP total</p>
      <Link href="/leaderboards" className="mt-3 block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
        View full leaderboard →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mystery XP Drop toast (PRD §2.1)
// Shows when user received a mystery drop in-session
// ---------------------------------------------------------------------------

function MysteryDropToast({
  drop,
  onDismiss,
}: {
  drop: MysteryDropNotification;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 shadow-md dark:border-yellow-700 dark:bg-yellow-950/40">
      <span className="text-2xl">⚡</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-yellow-900 dark:text-yellow-200">
          Mystery XP Drop!
        </p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          You just received <span className="font-semibold">{drop.xpAmount.toLocaleString()} XP</span> — surprise!
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-300"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Member Quest Banner (PRD §4)
// ---------------------------------------------------------------------------

interface MemberQuestStep { id: string; title: string; completed: boolean; }
interface MemberQuestState {
  steps: MemberQuestStep[];
  totalXp: number;
  totalCoins: number;
  isComplete: boolean;
  completedAt?: string | null;
}

function MemberQuestBanner({ quest, onDismiss }: { quest: MemberQuestState; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const currency = useCurrency();

  if (quest.isComplete) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 shadow-sm dark:border-teal-700 dark:bg-teal-950/40">
        <span className="mt-0.5 text-2xl">🎉</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-teal-900 dark:text-teal-200">New Member Quest Complete!</p>
          <p className="mt-0.5 text-xs text-teal-700 dark:text-teal-400">
            You earned <span className="font-semibold">{quest.totalCoins.toLocaleString()} {currency.softPlural}</span>{" "}
            and <span className="font-semibold">{quest.totalXp.toLocaleString()} XP</span>. Welcome to Zobia!
          </p>
        </div>
        <button onClick={onDismiss} className="shrink-0 text-teal-500 hover:text-teal-700" aria-label="Dismiss">✕</button>
      </div>
    );
  }

  const completedCount = quest.steps.filter((s) => s.completed).length;
  const totalCount = quest.steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="rounded-xl border border-violet-200 bg-white shadow-sm dark:border-violet-800 dark:bg-neutral-900">
      {/* Clickable header toggles list visibility */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        className="flex cursor-pointer items-center justify-between border-b border-violet-100 px-4 py-3 dark:border-violet-900"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-50">New Member Quest</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-neutral-500 tabular-nums">{completedCount}/{totalCount}</span>
          <span className="text-xs text-neutral-400">{expanded ? "▲" : "▼"}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="text-neutral-400 hover:text-neutral-600"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 py-3">
          <div className="mb-3">
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1 text-right text-xs text-neutral-400">{progressPct}% complete</p>
          </div>
          <div className="space-y-2">
            {quest.steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2.5">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${step.completed ? "border-teal-500 bg-teal-500 text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                  {step.completed && <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                <span className={`text-sm ${step.completed ? "text-neutral-400 line-through" : "text-neutral-700 dark:text-neutral-300"}`}>{step.title}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              🏆 Complete all steps to earn <span className="font-bold">{quest.totalCoins.toLocaleString()} {currency.softPlural}</span>{" "}
              + <span className="font-bold">{quest.totalXp.toLocaleString()} XP</span>!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan Expiry Banner — warns when a paid (or business) plan is about to lapse.
// Dismissible with an × while >7 days remain; once ≤7 days remain the × is
// removed and the banner becomes persistent until the user resubscribes.
// Dismissal is persisted to localStorage, keyed by the specific expiry
// timestamp so a renewal (which changes plan_ends_at) resets the dismissal.
// ---------------------------------------------------------------------------

interface PlanExpiryInfo {
  /** "personal" (Plus/Pro/Max) or "business" plan */
  kind: "personal" | "business";
  endsAt: string;
  daysRemaining: number;
}

const PLAN_EXPIRY_WARNING_DAYS = 14;
const PLAN_EXPIRY_URGENT_DAYS = 7;
const PLAN_EXPIRY_DISMISS_KEY = "zobia_plan_expiry_dismissed";

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Picks whichever of the user's personal/business plans expires soonest, if within the warning window. */
function resolvePlanExpiry(planEndsAt: string | null, businessPlanEndsAt: string | null): PlanExpiryInfo | null {
  const candidates: PlanExpiryInfo[] = [];
  if (planEndsAt) candidates.push({ kind: "personal", endsAt: planEndsAt, daysRemaining: daysUntil(planEndsAt) });
  if (businessPlanEndsAt) candidates.push({ kind: "business", endsAt: businessPlanEndsAt, daysRemaining: daysUntil(businessPlanEndsAt) });
  const withinWindow = candidates.filter((c) => c.daysRemaining <= PLAN_EXPIRY_WARNING_DAYS);
  if (withinWindow.length === 0) return null;
  return withinWindow.sort((a, b) => a.daysRemaining - b.daysRemaining)[0];
}

function PlanExpiryBanner({ info }: { info: PlanExpiryInfo }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const urgent = info.daysRemaining <= PLAN_EXPIRY_URGENT_DAYS;

  useEffect(() => {
    if (urgent) return; // urgent state is never dismissible
    try {
      const stored = JSON.parse(localStorage.getItem(PLAN_EXPIRY_DISMISS_KEY) ?? "{}") as { endsAt?: string };
      setDismissed(stored.endsAt === info.endsAt);
    } catch {
      setDismissed(false);
    }
  }, [info.endsAt, urgent]);

  function dismiss() {
    try {
      localStorage.setItem(PLAN_EXPIRY_DISMISS_KEY, JSON.stringify({ endsAt: info.endsAt }));
    } catch { /* ignore */ }
    setDismissed(true);
  }

  if (dismissed) return null;

  const message =
    info.daysRemaining <= 0
      ? t(info.kind === "business" ? "home.planExpiry.businessExpired" : "home.planExpiry.personalExpired")
      : t(info.kind === "business" ? "home.planExpiry.businessEndsIn" : "home.planExpiry.personalEndsIn", { count: info.daysRemaining });

  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
        urgent
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
    >
      <span>
        {message}{" "}
        <Link
          href={info.kind === "business" ? "/settings/business" : "/settings/subscription"}
          className="font-semibold underline underline-offset-2"
        >
          {t("home.planExpiry.resubscribe")}
        </Link>
      </span>
      {!urgent && (
        <button
          onClick={dismiss}
          aria-label={t("home.planExpiry.dismiss")}
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guild Discovery Panel (PRD §4 — shows 24h after signup, user has no guild)
// ---------------------------------------------------------------------------

function GuildDiscoverySkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-28 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-2.5 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuildDiscoveryPanel({ guilds }: { guilds: DiscoveryGuild[] }) {
  if (guilds.length === 0) return null;
  return (
    <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-card dark:border-blue-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          🏆 Crews near you are recruiting
        </h2>
        <Link href="/guild" className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
          See all →
        </Link>
      </div>
      <div className="space-y-3">
        {guilds.map((guild) => (
          <div key={guild.id} className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl dark:bg-blue-950/40">
              {guild.crestEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {guild.name}
              </p>
              <p className="text-xs text-neutral-500">
                <span className="capitalize">{guild.tier.replace("_", " ")}</span>
                {" · "}
                {guild.memberCount} members
                {(guild.warWins ?? 0) > 0 && ` · ${guild.warWins} wars won`}
                {guild.city && ` · ${guild.city}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Link
                href={`/guilds/${guild.id}`}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
              >
                View
              </Link>
              <Link
                href={`/guild?join=${guild.id}`}
                className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Join
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity count banner (plain, non-dismissible — uses presence endpoint)
// ---------------------------------------------------------------------------

function ActivityCountBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
      {count.toLocaleString()} user{count === 1 ? "" : "s"} earned XP in the last hour
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Home feed page — nemesis, quests, presence, friends, leaderboard.
 */
export default function HomePage() {
  const { t } = useTranslation();
  const { questUpdateKey } = useFloatingNotification();
  const [platformEvent, setPlatformEvent] = useState<PlatformEvent | null>(null);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [nemesis, setNemesis] = useState<NemesisData | null | undefined>(undefined);

  const [quests, setQuests] = useState<DailyQuest[] | undefined>(undefined);
  const [friends, setFriends] = useState<Friend[] | undefined>(undefined);
  const [leaderboard, setLeaderboard] = useState<LeaderboardPosition | null | undefined>(undefined);
  const [challenging, setChallenging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PRD §4: Guild Discovery — 3 local guilds for users without a guild
  const [discoveryGuilds, setDiscoveryGuilds] = useState<DiscoveryGuild[] | null>(null);
  const [loadingGuilds, setLoadingGuilds] = useState(true);

  // PRD §2.1: Mystery XP Drop toast — surfaces recent unread mystery drops
  const [mysteryDrop, setMysteryDrop] = useState<MysteryDropNotification | null>(null);

  // PRD §4: New Member Quest progress banner
  const [memberQuest, setMemberQuest] = useState<MemberQuestState | null>(null);
  const [questBannerDismissed, setQuestBannerDismissed] = useState(false);

  // Plan/business plan expiry alert
  const [planExpiry, setPlanExpiry] = useState<PlanExpiryInfo | null>(null);

  const fetchQuests = useCallback(() => {
    fetch("/api/quests/daily", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { quests?: DailyQuestApiRow[] } | null) => {
        const mapped: DailyQuest[] = (d?.quests ?? []).map((q) => ({
          id: String(q.id ?? ""),
          title: String(q.title ?? ""),
          description: String(q.description ?? ""),
          xpReward: Number(q.xp_reward ?? q.xpReward ?? 0),
          coinReward: Number(q.coin_reward ?? q.coinReward ?? 0),
          progress: Number(q.progress_count ?? q.progress ?? 0),
          goal: Number(q.target_count ?? q.goal ?? 1),
          completed: Boolean(q.completed ?? false),
        }));
        setQuests(mapped);
      })
      .catch(() => setQuests([]));
  }, []);

  // Refresh quest list when a quest_complete or deck_complete realtime event arrives
  useEffect(() => {
    if (questUpdateKey === 0) return;
    fetchQuests();
  }, [questUpdateKey, fetchQuests]);

  useEffect(() => {
    // Presence / XP activity count
    // API returns { success, data: { activeCount, event }, error }
    fetch("/api/presence", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: { activeCount?: number; event?: PlatformEvent } } | null) => {
        const payload = d?.data;
        if (payload) {
          if (typeof payload.activeCount === "number") setActiveCount(payload.activeCount);
          if (payload.event) setPlatformEvent(payload.event);
        }
      })
      .catch(() => {});

    // Nemesis
    fetch("/api/nemesis", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NemesisApiResponse | null) => {
        if (!d?.nemesis || !d?.me) { setNemesis(null); return; }
        setNemesis({
          rivalUserId: d.nemesis.userId,
          rivalUsername: d.nemesis.displayName,
          rivalAvatarEmoji: d.nemesis.avatarEmoji,
          myXP: d.comparison?.userXP ?? d.me.xp,
          rivalXP: d.comparison?.nemesisXP ?? d.nemesis.xp,
        });
      })
      .catch(() => setNemesis(null));

    // Daily quests
    fetchQuests();

    // Online friends — GET /api/friends/online filters to friends who opted
    // in to show_online_status AND are online/recently active (unlike plain
    // GET /api/friends, which returns every accepted friend regardless of
    // presence).
    fetch("/api/friends/online", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: Friend[]; friends?: Friend[] } | null) => setFriends(d?.data ?? d?.friends ?? []))
      .catch(() => setFriends([]));

    // Leaderboard position — fetch rank from /api/leaderboards/me and XP from /api/users/me
    Promise.all([
      fetch("/api/leaderboards/me", { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null),
      fetch("/api/users/me", { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null),
    ]).then(([lbData, meData]) => {
      const ranks: Array<{ track: string; globalRank: number | null }> =
        lbData?.data?.ranks ?? [];
      const mainRank = ranks.find((r) => r.track === "main");
      const me = meData?.user ?? meData;
      const xp = me?.xp_total ?? 0;
      if (mainRank?.globalRank != null) {
        setLeaderboard({ rank: mainRank.globalRank, rankDelta: 0, xp });
      } else {
        setLeaderboard(null);
      }
      setPlanExpiry(resolvePlanExpiry(me?.plan_ends_at ?? null, me?.business_plan_ends_at ?? null));
    }).catch(() => setLeaderboard(null));

    // PRD §4: Guild Discovery — fetch 3 nearby guilds
    // API returns empty array if user is already in a guild
    fetch("/api/guilds/discovery", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: { guilds?: DiscoveryGuild[] } } | null) => {
        setDiscoveryGuilds(d?.data?.guilds ?? []);
      })
      .catch(() => setDiscoveryGuilds([]))
      .finally(() => setLoadingGuilds(false));

    // PRD §4: New Member Quest
    fetch("/api/quests/new-member", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: { steps?: Array<{id:string;label:string;completed:boolean}>; allComplete?: boolean; rewardClaimed?: boolean } } | null) => {
        const qd = d?.data;
        if (qd && !qd.allComplete && !qd.rewardClaimed) {
          const steps = (qd.steps ?? []).map((s) => ({ id: s.id, title: s.label, completed: s.completed }));
          setMemberQuest({ steps, totalCoins: 1000, totalXp: 2000, isComplete: false });
        }
      })
      .catch(() => {});

    // PRD §2.1: Check for unread mystery XP drop notifications
    fetch("/api/notifications?type=mystery_xp_drop&unread=true&limit=1", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { notifications?: Array<{ payload?: { xpAmount?: number }; created_at?: string }> } | null) => {
        const latest = d?.notifications?.[0];
        if (latest) {
          setMysteryDrop({
            xpAmount: latest.payload?.xpAmount ?? 0,
            receivedAt: latest.created_at ?? new Date().toISOString(),
          });
        }
      })
      .catch(() => {});
  }, [fetchQuests]);

  async function handleChallenge() {
    setChallenging(true);
    try {
      const res = await fetch("/api/nemesis", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "challenge" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const errParams = typeof body.error === "string" ? {} : (body.error?.params ?? {});
        const err = new Error(errMsg ?? body.message ?? "Challenge failed") as Error & { code?: string | null; params?: Record<string, unknown> };
        err.code = errCode;
        err.params = errParams;
        throw err;
      }
    } catch (e) {
      const err = e as Error & { code?: string | null; params?: Record<string, unknown> };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to challenge rival", err.params ?? {}) : "Failed to challenge rival");
    } finally {
      setChallenging(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* Activity Banner (XP multiplier events) */}
      <ActivityBanner event={platformEvent} />

      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Home</h1>

        {/* Error */}
        <ErrorAlert error={error} />

        {/* Plan / business plan expiry alert */}
        {planExpiry && <PlanExpiryBanner info={planExpiry} />}

        {/* Activity count banner */}
        <ActivityCountBanner count={activeCount} />

        {/* Mystery XP Drop toast — PRD §2.1 */}
        {mysteryDrop && mysteryDrop.xpAmount > 0 && (
          <MysteryDropToast
            drop={mysteryDrop}
            onDismiss={() => setMysteryDrop(null)}
          />
        )}

        {/* New Member Quest — PRD §4 */}
        {memberQuest && !questBannerDismissed && (
          <MemberQuestBanner quest={memberQuest} onDismiss={() => setQuestBannerDismissed(true)} />
        )}

        {/* Leaderboard position */}
        {leaderboard === undefined ? (
          <LeaderboardSkeleton />
        ) : leaderboard ? (
          <LeaderboardCard position={leaderboard} />
        ) : null}

        {/* Nemesis widget */}
        {nemesis === undefined ? (
          <NemesisSkeleton />
        ) : nemesis ? (
          <NemesisWidget data={nemesis} onChallenge={handleChallenge} challenging={challenging} />
        ) : null}

        {/* Daily Quest Deck */}
        {quests === undefined ? (
          <QuestDeckSkeleton />
        ) : (
          <QuestDeck quests={quests} />
        )}

        {/* Online Friends Row */}
        {friends === undefined ? (
          <FriendsSkeleton />
        ) : (
          <FriendsRow friends={friends} />
        )}

        {/* Guild Discovery Panel — PRD §4 (shown to users without a guild) */}
        {loadingGuilds ? (
          <GuildDiscoverySkeleton />
        ) : discoveryGuilds && discoveryGuilds.length > 0 ? (
          <GuildDiscoveryPanel guilds={discoveryGuilds} />
        ) : null}

        {/* Creator of the Month Spotlight — PRD §25 */}
        <CreatorSpotlight />
      </div>
    </div>
  );
}
