"use client";

/**
 * components/rooms/RoomRewardPanel.tsx
 *
 * Room Custom Rewards (see lib/contentTreasury.ts's "Room Custom Rewards"
 * section and app/api/rooms/[roomId]/rewards/route.ts). Every room member
 * sees the active reward (if any) and what it takes to unlock it — sending
 * ANY gift to the room owner while a slot remains. The owner additionally
 * gets a form to create/replace/close it. Mirrors
 * components/polls/FundTreasuryModal.tsx's layout/fetch conventions.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

type RewardAction = "credits" | "stars" | "custom_text";

interface RoomRewardState {
  id: string;
  title: string | null;
  rewardAction: RewardAction;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
  customInstructions: string | null;
}

export function RoomRewardPanel({ roomId, isOwner }: { roomId: string; isOwner: boolean }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [reward, setReward] = useState<RoomRewardState | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [rewardAction, setRewardAction] = useState<RewardAction>("credits");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("100");
  const [maxClaimants, setMaxClaimants] = useState("10");
  const [customInstructions, setCustomInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReward() {
    try {
      const res = await fetch(`/api/rooms/${roomId}/rewards`, { credentials: "include" });
      if (!res.ok) { setReward(null); return; }
      const json = await res.json();
      setReward(json?.data?.reward ?? null);
    } catch {
      setReward(null);
    }
  }

  useEffect(() => {
    void loadReward();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const actionLabel = (action: RewardAction) =>
    action === "stars" ? "Stars" : action === "credits" ? currency.softPlural : t("rooms.reward.customUnlock", "Custom Unlock");

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        rewardAction === "custom_text"
          ? { rewardAction, title: title.trim(), customInstructions: customInstructions.trim(), maxClaimants: parseInt(maxClaimants, 10) }
          : { rewardAction, title: title.trim(), amount: parseInt(amount, 10), maxClaimants: parseInt(maxClaimants, 10) };

      const res = await fetch(`/api/rooms/${roomId}/rewards`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(json?.error?.message ?? t("rooms.reward.createFailed", "Failed to create reward")) as Error & { code?: string | null };
        err.code = json?.error?.code ?? null;
        throw err;
      }
      setReward(json.data.reward as RoomRewardState);
      setEditing(false);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || t("rooms.reward.genericError", "Something went wrong")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose() {
    setSubmitting(true);
    try {
      await fetch(`/api/rooms/${roomId}/rewards`, { method: "DELETE", credentials: "include" });
      await loadReward();
    } finally {
      setSubmitting(false);
    }
  }

  if (reward === undefined) return null; // still loading — avoid layout flash

  const isActive = reward && reward.status === "active";

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        🎁 {t("rooms.reward.title", "Room Reward")}
      </h2>

      {isActive && !editing && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-950/10 px-3 py-2 text-xs dark:bg-amber-950/20">
          <p className="font-semibold text-amber-700 dark:text-amber-300">{reward.title ?? t("rooms.reward.title", "Room Reward")}</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">
            {t("rooms.reward.progress", "{{claimed}}/{{max}} slots claimed", { claimed: reward.claimantCount, max: reward.maxClaimants })} —{" "}
            {reward.rewardAction === "custom_text"
              ? t("rooms.reward.unlocksCustom", "unlocks a custom instruction")
              : `${reward.rewardPerClaimant} ${actionLabel(reward.rewardAction)} each`}
            {" "}
            {t("rooms.reward.forFirstN", "for the first {{count}} people who send the room owner any gift.", { count: reward.maxClaimants })}
          </p>
        </div>
      )}

      {!isActive && !editing && (
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          {isOwner
            ? t("rooms.reward.emptyOwner", "No active reward. Set one up so members are rewarded for gifting you in this room.")
            : t("rooms.reward.emptyMember", "The room owner hasn't set up a reward yet.")}
        </p>
      )}

      {isOwner && !editing && (
        <button
          type="button"
          onClick={() => {
            setTitle(reward?.title ?? "");
            setRewardAction(reward?.rewardAction ?? "credits");
            setMaxClaimants(String(reward?.maxClaimants ?? 10));
            setEditing(true);
          }}
          className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
        >
          {isActive ? t("rooms.reward.replace", "Replace Reward") : t("rooms.reward.setUp", "Set Up a Reward")}
        </button>
      )}

      {isOwner && isActive && !editing && (
        <button
          type="button"
          onClick={() => void handleClose()}
          disabled={submitting}
          className="ml-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          {t("rooms.reward.deactivate", "Deactivate")}
        </button>
      )}

      {isOwner && editing && (
        <div className="rounded-xl border border-border bg-background p-4">
          {error && <div className="mb-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</div>}

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("rooms.reward.nameLabel", "Reward name")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("rooms.reward.namePlaceholder", "e.g. VIP Shoutout")}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("rooms.reward.typeLabel", "Reward type")}</span>
            <div className="flex gap-2">
              {(["credits", "stars", "custom_text"] as RewardAction[]).map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => setRewardAction(action)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${rewardAction === action ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300" : "border-border text-muted-foreground"}`}
                >
                  {action === "credits" ? currency.softPlural : action === "stars" ? "Stars" : t("rooms.reward.customUnlock", "Custom Unlock")}
                </button>
              ))}
            </div>
          </label>

          {rewardAction === "custom_text" ? (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("rooms.reward.instructionsLabel", "Claim instructions (shown to whoever unlocks it)")}
              </span>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={3}
                placeholder={t("rooms.reward.instructionsPlaceholder", "e.g. DM me your Discord username to get the VIP role.")}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
          ) : (
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("rooms.reward.amountLabel", "Total {{currency}} to fund (split evenly)", { currency: rewardAction === "stars" ? "Stars" : currency.softPlural })}
              </span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("rooms.reward.maxClaimantsLabel", "For the first how many people?")}</span>
            <input
              type="number"
              min={1}
              value={maxClaimants}
              onChange={(e) => setMaxClaimants(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>

          {rewardAction !== "custom_text" && amount && maxClaimants && parseInt(amount, 10) > 0 && parseInt(maxClaimants, 10) > 0 && (
            <p className="mb-3 text-xs text-neutral-500">
              {t("rooms.reward.perClaimantPreview", "≈ {{perClaimant}} {{unit}} per person", { perClaimant: Math.floor(parseInt(amount, 10) / parseInt(maxClaimants, 10)), unit: actionLabel(rewardAction).toLowerCase() })}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-border py-2 text-sm font-semibold text-foreground hover:bg-accent"
            >
              {t("rooms.reward.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting || !title.trim()}
              className="flex-1 rounded-xl bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? t("rooms.reward.saving", "Saving…") : t("rooms.reward.save", "Save Reward")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
