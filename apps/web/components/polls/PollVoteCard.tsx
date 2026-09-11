"use client";

/**
 * components/polls/PollVoteCard.tsx
 *
 * Interactive voting card for the public poll page (app/poll/[slug]/page.tsx).
 * Shows the voting form (radio for single-choice, checkboxes when
 * allowMultiple) to a signed-in viewer who hasn't voted yet; shows results
 * (bars + percentages) to everyone else — an anonymous viewer, or someone
 * who already voted. Mirrors components/blogs/PostActions.tsx's
 * fetch/error-handling conventions.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface PollOption {
  id: string;
  label: string;
  voteCount: number;
}

interface PollForCard {
  slug: string;
  allowMultiple: boolean;
  status: string;
  closesAt: string | null;
  options: PollOption[];
  myVoteOptionIds: string[];
  voterCount: number;
}

function Bars({ options, highlightIds }: { options: PollOption[]; highlightIds: string[] }) {
  const total = options.reduce((sum, o) => sum + o.voteCount, 0);
  return (
    <div className="space-y-2">
      {options.map((o) => {
        const pct = total > 0 ? Math.round((o.voteCount / total) * 100) : 0;
        const mine = highlightIds.includes(o.id);
        return (
          <div key={o.id}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className={`truncate ${mine ? "font-semibold text-foreground" : "text-foreground"}`}>
                {mine && <span className="mr-1">✓</span>}
                {o.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${mine ? "bg-primary-500" : "bg-neutral-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PollVoteCard({ poll, viewerSignedIn }: { poll: PollForCard; viewerSignedIn: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [options, setOptions] = useState<PollOption[]>(poll.options);
  const [myVoteOptionIds, setMyVoteOptionIds] = useState<string[]>(poll.myVoteOptionIds);
  const [voterCount, setVoterCount] = useState(poll.voterCount);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewardNotice, setRewardNotice] = useState<string | null>(null);

  const isClosed = poll.status === "closed" || (poll.closesAt != null && new Date(poll.closesAt) < new Date());
  const hasVoted = myVoteOptionIds.length > 0;
  const showResults = !viewerSignedIn || hasVoted || isClosed;

  function toggleOption(id: string) {
    if (poll.allowMultiple) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  }

  async function submitVote() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/polls/${poll.slug}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionIds: selected }),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(json?.error?.message ?? "Failed to vote") as Error & { code?: string | null };
        err.code = json?.error?.code ?? null;
        throw err;
      }
      const data = json.data as { options: PollOption[]; voterCount: number; rewardClaimed: number | null };
      setOptions(data.options);
      setVoterCount(data.voterCount);
      setMyVoteOptionIds(selected);
      if (data.rewardClaimed != null) {
        setRewardNotice(t("polls.vote.rewardClaimed", "You earned {{amount}} credits from the reward pot!", { amount: data.rewardClaimed }));
      }
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  if (showResults) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <Bars options={options} highlightIds={myVoteOptionIds} />
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{voterCount} {voterCount === 1 ? t("polls.voter", "voter") : t("polls.voters", "voters")}</span>
          {!viewerSignedIn && (
            <Link href="/auth/login" className="font-semibold text-primary-500 hover:text-primary-400">
              {t("polls.vote.signInToVote", "Sign in to vote")}
            </Link>
          )}
          {viewerSignedIn && isClosed && !hasVoted && (
            <span>{t("polls.vote.closed", "Voting is closed.")}</span>
          )}
        </div>
        {rewardNotice && <p className="mt-2 text-xs font-medium text-amber-400">{rewardNotice}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      <div className="space-y-2">
        {options.map((o) => {
          const isSelected = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggleOption(o.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                isSelected
                  ? "border-primary-500 bg-primary-950/30 text-foreground"
                  : "border-border bg-background text-foreground hover:bg-accent"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${poll.allowMultiple ? "rounded-md" : "rounded-full"} ${
                  isSelected ? "border-primary-500 bg-primary-500" : "border-neutral-500"
                }`}
              >
                {isSelected && <span className="text-[10px] leading-none text-white">✓</span>}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={submitVote}
        disabled={selected.length === 0 || submitting}
        className="mt-3 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {submitting ? t("polls.vote.submitting", "Voting…") : t("polls.vote.submit", "Vote")}
      </button>
    </div>
  );
}
