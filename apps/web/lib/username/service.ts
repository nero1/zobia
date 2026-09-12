/**
 * lib/username/service.ts
 *
 * Full Username Change pipeline: eligibility + cooldown re-check ->
 * availability re-check -> charge (Credits or Stars, via the existing
 * ledger primitives) -> update users.username -> record history -> place
 * (or not) a reservation hold on the old username. Everything happens in a
 * single DB transaction so a race can never leave the system in a half-done
 * state (charged but not renamed, renamed but old username left claimable,
 * etc).
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { ApiError, badRequest, forbidden, conflict } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { checkUsernameChangeEligibility } from "@/lib/username/eligibility";
import { checkUsernameAvailability } from "@/lib/username/availability";

export type UsernameChangeCurrency = "credits" | "stars";

export interface ChangeUsernameInput {
  userId: string;
  newUsername: string;
  /** Which currency the user chose to pay with. Required unless both costs are 0. */
  currency?: UsernameChangeCurrency | null;
  /** Whether visits to the OLD username should permanently redirect to the new one. */
  redirectEnabled: boolean;
}

export interface ChangeUsernameResult {
  oldUsername: string;
  newUsername: string;
  redirectEnabled: boolean;
  reservedUntil: string | null;
  costCredits: number;
  costStars: number;
  currencyCharged: UsernameChangeCurrency | null;
}

/**
 * Atomically changes a user's username. Throws ApiError (400/402/403/409) on
 * any failed check — callers should let handleApiError() translate it.
 */
export async function changeUsername(input: ChangeUsernameInput): Promise<ChangeUsernameResult> {
  const newUsername = input.newUsername.toLowerCase().trim();

  const result = await db.transaction(async (tx: TransactionClient) => {
    // 1. Re-check eligibility + cooldown server-side, inside the transaction.
    // Never trust the client-side gate or an earlier read alone.
    const eligibility = await checkUsernameChangeEligibility(input.userId, tx);
    if (!eligibility.eligible) {
      throw forbidden(eligibility.reason ?? "Not eligible to change username.", "USERNAME_CHANGE_NOT_ELIGIBLE", {
        nextEligibleAt: eligibility.nextEligibleAt,
      });
    }
    const config = eligibility.config;

    // 2. Re-check availability inside the transaction (race-safety) — a
    // concurrent claim of the same name between the client-side check and
    // this confirm cannot slip through.
    const { rows: userRows } = await tx.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [input.userId]
    );
    const oldUsername = userRows[0]?.username?.toLowerCase();
    if (!oldUsername) {
      throw badRequest("Account not found.");
    }
    if (oldUsername === newUsername) {
      throw conflict("That's already your username.", "USERNAME_UNCHANGED");
    }

    const availability = await checkUsernameAvailability(newUsername, { client: tx });
    if (!availability.available) {
      throw conflict(availability.reason ?? "This username is not available.", "USERNAME_UNAVAILABLE");
    }

    // 3. Charge — reuse the existing ledger primitives, never write balance
    // SQL directly.
    const isFree = config.costCredits <= 0 && config.costStars <= 0;
    let currencyCharged: UsernameChangeCurrency | null = null;
    if (!isFree) {
      const currency = input.currency;
      if (currency !== "credits" && currency !== "stars") {
        throw badRequest("A payment currency (credits or stars) is required.");
      }
      if (currency === "credits" && config.costCredits <= 0) {
        throw badRequest("Username changes cannot be paid with Credits right now.");
      }
      if (currency === "stars" && config.costStars <= 0) {
        throw badRequest("Username changes cannot be paid with Stars right now.");
      }
      const referenceId = `username_change:${input.userId}:${randomUUID()}`;
      if (currency === "credits") {
        await debitCoins(
          input.userId,
          config.costCredits,
          "username_change",
          referenceId,
          "Changed username",
          { oldUsername, newUsername },
          tx
        );
      } else {
        await debitStars(input.userId, config.costStars, "username_change", referenceId, "Changed username", tx);
      }
      currencyCharged = currency;
    }

    // 4. Update users.username. The pre-existing UNIQUE constraint
    // (users_username_key) is the final race-safety backstop even though
    // step 2 already re-checked inside this same transaction/lock.
    await tx.query(`UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2`, [newUsername, input.userId]);

    // 5. Record history (admin/mod-facing "Username history"). The hold on
    // the old username lasts exactly one year when not redirecting (fixed
    // by product spec, not admin-configurable), or forever when redirecting.
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const finalReservedUntil = input.redirectEnabled ? null : oneYearFromNow;

    await tx.query(
      `INSERT INTO username_change_history
         (user_id, old_username, new_username, changed_at, redirect_enabled, reserved_until, cost_paid_credits, cost_paid_stars)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`,
      [
        input.userId,
        oldUsername,
        newUsername,
        input.redirectEnabled,
        finalReservedUntil,
        currencyCharged === "credits" ? config.costCredits : 0,
        currencyCharged === "stars" ? config.costStars : 0,
      ]
    );

    // 6. Reserve the old username so nobody (including the original owner)
    // can claim it — either indefinitely (redirect case) or for one year
    // (non-redirect case, lazily released by resolveOldUsername/
    // checkUsernameAvailability comparing reserved_until to NOW() at read
    // time — no cron dependency for correctness).
    await tx.query(
      `INSERT INTO username_reservations (old_username, previous_user_id, redirect_to_username, reserved_until)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (old_username) DO UPDATE
         SET previous_user_id = EXCLUDED.previous_user_id,
             redirect_to_username = EXCLUDED.redirect_to_username,
             reserved_until = EXCLUDED.reserved_until,
             created_at = NOW()`,
      [oldUsername, input.userId, input.redirectEnabled ? newUsername : null, finalReservedUntil]
    );

    logger.info(
      { userId: input.userId, oldUsername, newUsername, redirectEnabled: input.redirectEnabled, currencyCharged },
      "[username] username changed"
    );

    return {
      oldUsername,
      newUsername,
      redirectEnabled: input.redirectEnabled,
      reservedUntil: finalReservedUntil,
      costCredits: currencyCharged === "credits" ? config.costCredits : 0,
      costStars: currencyCharged === "stars" ? config.costStars : 0,
      currencyCharged,
    } satisfies ChangeUsernameResult;
  });

  return result;
}

export { ApiError };
