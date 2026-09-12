/**
 * lib/profile/avatarService.ts
 *
 * Profile Pictures feature — shared business logic behind
 * POST /api/users/me/avatar and the "switch to a default icon" path of
 * PUT /api/users/me.
 *
 * Rules (see ZobiaSocial-PRD.md § Profile Pictures):
 *  - Uploading a CUSTOM photo is free for any paid-plan user (plan !== "free").
 *    A user who uploaded while paid and later downgrades KEEPS that photo —
 *    this file only gates the change action, never clears avatar_url on
 *    downgrade.
 *  - A free-plan user can still upload a custom photo by paying the
 *    admin-configured cost (Credits OR Stars, their choice) — see
 *    lib/manifest ZobiaManifest.avatarChange.
 *  - Switching to one of the default onboarding icons
 *    (lib/profile/defaultAvatars.ts) is always free, on any plan.
 *  - Once-a-week cooldown applies to EVERY avatar change (custom upload or
 *    default-icon switch), tracked via `users.avatar_changed_at`.
 *
 * Charging and the avatar_url/avatar_emoji update happen in the same DB
 * transaction (mirrors lib/moments/service.ts's createMoment), so a failed
 * update (e.g. a race on the cooldown) never leaves a user charged without
 * the change actually applying.
 *
 * @module lib/profile/avatarService
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest } from "@/lib/manifest";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { ApiError, badRequest, forbidden } from "@/lib/api/errors";
import { isDefaultAvatarEmoji } from "@/lib/profile/defaultAvatars";
import { logger } from "@/lib/logger";

export const AVATAR_CHANGE_COOLDOWN_DAYS = 7;

export type AvatarCurrency = "credits" | "stars";

interface AvatarUserRow {
  plan: string;
  avatar_changed_at: string | null;
  coin_balance: string | number;
  star_balance: string | number;
}

/** Any plan other than "free" is treated as paid — mirrors the isPaidPlan
 * pattern already used in lib/ads/limits.ts and settings/subscription/page.tsx
 * (plan !== "free"), rather than settings/page.tsx's narrower isProPlan()
 * which only matches pro/max/premium and would miss the "plus" tier. */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return !!plan && plan.toLowerCase() !== "free";
}

function assertCooldownElapsed(avatarChangedAt: string | null): void {
  if (!avatarChangedAt) return;
  const changedAt = new Date(avatarChangedAt);
  const nextEligibleAt = new Date(
    changedAt.getTime() + AVATAR_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  );
  if (nextEligibleAt.getTime() > Date.now()) {
    throw new ApiError(
      429,
      "AVATAR_CHANGE_RATE_LIMITED",
      `You can only change your profile picture once every ${AVATAR_CHANGE_COOLDOWN_DAYS} days. Next available at ${nextEligibleAt.toISOString()}`,
      undefined,
      undefined,
      { nextEligibleAt: nextEligibleAt.toISOString() }
    );
  }
}

export interface AvatarEligibility {
  plan: string;
  isPaid: boolean;
  avatarChangedAt: string | null;
  nextEligibleAt: string | null;
  creditBalance: number;
  starBalance: number;
  costCredits: number;
  costStars: number;
}

/**
 * Read-only snapshot of the caller's avatar-change eligibility — used by the
 * client (AvatarCropModal) to show the right cost/cooldown copy before the
 * user even picks a file.
 */
export async function getAvatarEligibility(userId: string): Promise<AvatarEligibility> {
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    db.query<AvatarUserRow>(
      `SELECT plan, avatar_changed_at, coin_balance, star_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    ),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");

  let nextEligibleAt: string | null = null;
  if (row.avatar_changed_at) {
    const next = new Date(
      new Date(row.avatar_changed_at).getTime() + AVATAR_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    );
    nextEligibleAt = next.getTime() > Date.now() ? next.toISOString() : null;
  }

  return {
    plan: row.plan,
    isPaid: isPaidPlan(row.plan),
    avatarChangedAt: row.avatar_changed_at,
    nextEligibleAt,
    creditBalance: Number(row.coin_balance),
    starBalance: Number(row.star_balance),
    costCredits: manifest.avatarChange.costCredits,
    costStars: manifest.avatarChange.costStars,
  };
}

export interface ApplyCustomAvatarResult {
  avatarUrl: string;
  /** Which currency was charged, or null if the change was free (paid plan). */
  charged: AvatarCurrency | null;
  costCredits: number;
  costStars: number;
}

/**
 * Records a newly-uploaded custom avatar (the image itself must already be
 * uploaded to storage by the caller — see app/api/users/me/avatar/route.ts).
 * Free-plan users are charged the admin-configured cost atomically with the
 * DB update; paid-plan users are never charged. The cooldown is re-checked
 * under `FOR UPDATE` so a concurrent request can't race past it.
 */
export async function applyCustomAvatar(
  userId: string,
  avatarUrl: string,
  currencyPreference: AvatarCurrency | null | undefined
): Promise<ApplyCustomAvatarResult> {
  const manifest = await loadManifest();
  const { costCredits, costStars } = manifest.avatarChange;
  const referenceId = `avatar_change:${userId}:${randomUUID()}`;

  const charged = await db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<AvatarUserRow>(
      `SELECT plan, avatar_changed_at, coin_balance, star_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [userId]
    );
    if (!rows[0]) throw forbidden("User account not found");
    const row = rows[0];

    assertCooldownElapsed(row.avatar_changed_at);

    let currency: AvatarCurrency | null = null;
    if (!isPaidPlan(row.plan)) {
      const creditBalance = Number(row.coin_balance);
      const starBalance = Number(row.star_balance);
      const canPayCredits = costCredits > 0 && creditBalance >= costCredits;
      const canPayStars = costStars > 0 && starBalance >= costStars;

      currency = currencyPreference ?? null;
      if (currency === "credits" && !canPayCredits) currency = null;
      if (currency === "stars" && !canPayStars) currency = null;
      if (!currency) {
        currency = canPayCredits ? "credits" : canPayStars ? "stars" : null;
      }

      if (!currency) {
        throw new ApiError(
          402,
          "INSUFFICIENT_AVATAR_CHANGE_FUNDS",
          `You need ${costCredits} Credits or ${costStars} Star${costStars === 1 ? "" : "s"} to upload a custom profile photo on the Free plan. Upgrade to a paid plan to upload for free.`,
          undefined,
          undefined,
          { costCredits, costStars, creditBalance, starBalance }
        );
      }

      if (currency === "credits") {
        await debitCoins(userId, costCredits, "avatar_change", referenceId, "Changed profile photo (Free plan)", null, tx);
      } else {
        await debitStars(userId, costStars, "avatar_change", referenceId, "Changed profile photo (Free plan)", tx);
      }
    }

    await tx.query(
      `UPDATE users
       SET avatar_url = $1, avatar_emoji = NULL, avatar_changed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [avatarUrl, userId]
    );

    return currency;
  });

  logger.info({ userId, charged }, "[avatarService] custom avatar applied");

  return { avatarUrl, charged, costCredits, costStars };
}

/**
 * Switches the caller's avatar to one of the default onboarding icons.
 * Always free regardless of plan, but still subject to the once-a-week
 * cooldown — "can only change once a week" is a blanket rule for the whole
 * feature, not just paid custom uploads.
 */
export async function applyDefaultAvatarIcon(userId: string, emoji: string): Promise<void> {
  if (!isDefaultAvatarEmoji(emoji)) {
    throw badRequest("Not a recognised default avatar icon", "INVALID_DEFAULT_AVATAR");
  }

  await db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<{ avatar_changed_at: string | null }>(
      `SELECT avatar_changed_at FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [userId]
    );
    if (!rows[0]) throw forbidden("User account not found");
    assertCooldownElapsed(rows[0].avatar_changed_at);

    await tx.query(
      `UPDATE users
       SET avatar_url = NULL, avatar_emoji = $1, avatar_changed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [emoji, userId]
    );
  });

  logger.info({ userId, emoji }, "[avatarService] default avatar icon applied");
}
