/**
 * lib/moments/service.ts
 *
 * Shared Zobia Moments creation pipeline — used by both the /moments feed
 * ("Share a Moment") and the Rooms ⚡ moment toggle, so both entry points
 * enforce the same level gate, pricing, and 24h-expiry insert atomically.
 *
 * PRD §5: "Zobia Moments — ephemeral messages visible for 24 hours."
 *
 * @module lib/moments/service
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest, requireFeatureEnabled } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { ApiError, badRequest, forbidden } from "@/lib/api/errors";

export const MAX_ACTIVE_MOMENTS_PER_USER = 5;

export type MomentContentType = "text" | "image" | "video";
export type MomentCurrency = "credits" | "stars";

export interface MomentPricing {
  costCredits: number;
  costStars: number;
  minLevel: number;
  /** True when both costs are 0 — no payment required at all. */
  isFree: boolean;
  /** Which currencies are currently accepted (cost > 0). */
  acceptedCurrencies: MomentCurrency[];
}

export interface MomentEligibility {
  rankNumber: number;
  xpTotal: number;
  creditBalance: number;
  starBalance: number;
  pricing: MomentPricing;
}

/** Reads the current admin-configured Moments pricing/eligibility rules. */
export async function getMomentPricing(): Promise<MomentPricing> {
  const manifest = await loadManifest();
  const { costCredits, costStars, minLevel } = manifest.moments;
  const acceptedCurrencies: MomentCurrency[] = [];
  if (costCredits > 0) acceptedCurrencies.push("credits");
  if (costStars > 0) acceptedCurrencies.push("stars");
  return {
    costCredits,
    costStars,
    minLevel,
    isFree: costCredits <= 0 && costStars <= 0,
    acceptedCurrencies,
  };
}

/**
 * Loads the caller's level + balances alongside the current pricing config,
 * in one read, so both the client-side "can I afford this" check and the
 * server-side gate use the same numbers.
 */
export async function getMomentEligibility(userId: string): Promise<MomentEligibility> {
  const [pricing, userRows] = await Promise.all([
    getMomentPricing(),
    db.query<{ xp_total: number; coin_balance: number; star_balance: number }>(
      `SELECT COALESCE(xp_total, 0) AS xp_total,
              COALESCE(coin_balance, 0) AS coin_balance,
              COALESCE(star_balance, 0) AS star_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    ),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");
  const rankNumber = getRankForXP(row.xp_total).rankNumber;
  return {
    rankNumber,
    xpTotal: row.xp_total,
    creditBalance: row.coin_balance,
    starBalance: row.star_balance,
    pricing,
  };
}

/** Throws a 403 FORBIDDEN if the user's level is below the configured minimum. */
export function assertMomentLevelGate(eligibility: MomentEligibility): void {
  if (eligibility.rankNumber < eligibility.pricing.minLevel) {
    throw forbidden(
      `You must reach Level ${eligibility.pricing.minLevel} to share Moments. Your current level is ${eligibility.rankNumber}.`,
      "MOMENTS_LEVEL_TOO_LOW",
      { minLevel: eligibility.pricing.minLevel, currentLevel: eligibility.rankNumber }
    );
  }
}

/**
 * Picks and validates the currency to charge for a Moment.
 * Falls back to whichever currency the admin has priced if the caller didn't
 * specify one; throws a structured 402-style error (via badRequest) carrying
 * both costs so the client can render "You need X Credits or Y Stars".
 */
export function resolveMomentCurrency(
  eligibility: MomentEligibility,
  requested: MomentCurrency | null | undefined
): MomentCurrency | null {
  const { pricing } = eligibility;
  if (pricing.isFree) return null;

  let currency = requested ?? null;
  if (!currency || !pricing.acceptedCurrencies.includes(currency)) {
    currency = pricing.acceptedCurrencies[0] ?? null;
  }
  if (!currency) {
    throw badRequest("Moments are not currently payable with any currency", "MOMENTS_NOT_PAYABLE");
  }
  return currency;
}

/**
 * Throws INSUFFICIENT_MOMENT_FUNDS with both cost figures and the caller's
 * current balances if they can't afford the Moment — the client uses these
 * to render "You need X Credits and/or Y Stars to share a Moment."
 */
export function assertCanAffordMoment(eligibility: MomentEligibility, currency: MomentCurrency | null): void {
  if (!currency) return; // free
  const { pricing } = eligibility;
  const balance = currency === "credits" ? eligibility.creditBalance : eligibility.starBalance;
  const cost = currency === "credits" ? pricing.costCredits : pricing.costStars;
  if (balance < cost) {
    throw new ApiError(
      402,
      "INSUFFICIENT_MOMENT_FUNDS",
      `You don't have enough ${currency === "credits" ? "Credits" : "Stars"} to share a Moment.`,
      undefined,
      undefined,
      {
        costCredits: pricing.costCredits,
        costStars: pricing.costStars,
        creditBalance: eligibility.creditBalance,
        starBalance: eligibility.starBalance,
        currency,
      }
    );
  }
}

export interface CreateMomentInput {
  userId: string;
  content: string;
  contentType: MomentContentType;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  caption?: string | null;
  currency?: MomentCurrency | null;
  /** Where the Moment originated — surfaced for analytics/debugging only. */
  source: "feed" | "room";
}

export interface CreateMomentResult {
  id: string;
  expiresAt: string;
  costCredits: number;
  costStars: number;
  currencyCharged: MomentCurrency | null;
}

/**
 * Full Moments creation pipeline: feature flag → level gate → active-moment
 * cap → currency resolution/affordability → atomic charge + insert.
 *
 * Charging and the row insert happen in the same DB transaction, so a failed
 * insert (e.g. a race on the active-moment cap) never leaves a user charged
 * for a Moment that was never created.
 */
export async function createMoment(input: CreateMomentInput): Promise<CreateMomentResult> {
  await requireFeatureEnabled("moments");

  const eligibility = await getMomentEligibility(input.userId);
  assertMomentLevelGate(eligibility);

  const { rows: countRows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM moments WHERE user_id = $1 AND expires_at > NOW()`,
    [input.userId]
  );
  if (parseInt(countRows[0]?.cnt ?? "0", 10) >= MAX_ACTIVE_MOMENTS_PER_USER) {
    throw badRequest(`You can have at most ${MAX_ACTIVE_MOMENTS_PER_USER} active moments at a time`, "MOMENTS_LIMIT_REACHED");
  }

  const currency = resolveMomentCurrency(eligibility, input.currency);
  assertCanAffordMoment(eligibility, currency);

  const { pricing } = eligibility;
  const referenceId = `moment_create:${input.userId}:${randomUUID()}`;

  const created = await db.transaction(async (tx: TransactionClient) => {
    if (currency === "credits") {
      await debitCoins(input.userId, pricing.costCredits, "moment_created", referenceId, "Shared a Moment", { source: input.source }, tx);
    } else if (currency === "stars") {
      await debitStars(input.userId, pricing.costStars, "moment_created", referenceId, "Shared a Moment", tx);
    }

    const { rows } = await tx.query<{ id: string; expires_at: string }>(
      `INSERT INTO moments (user_id, content, content_type, media_url, thumbnail_url, caption)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [
        input.userId,
        input.content,
        input.contentType,
        input.mediaUrl ?? null,
        input.thumbnailUrl ?? null,
        input.caption ?? null,
      ]
    );
    return rows[0];
  });

  return {
    id: created.id,
    expiresAt: created.expires_at,
    costCredits: pricing.costCredits,
    costStars: pricing.costStars,
    currencyCharged: currency,
  };
}
