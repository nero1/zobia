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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

  // 1. Eligibility + cooldown and availability checks. These deliberately run
  // BEFORE the transaction below (lib/username/eligibility.ts and
  // lib/username/availability.ts still take the legacy raw-adapter Queryable
  // client type, so they can't safely share this function's Drizzle tx — and
  // checking out a second pool connection while a transaction is already
  // holding one risks starving a small pool, see lib/manifest's dbClient doc
  // comment for the same concern). Never trust the client-side gate alone.
  const eligibility = await checkUsernameChangeEligibility(input.userId);
  if (!eligibility.eligible) {
    throw forbidden(eligibility.reason ?? "Not eligible to change username.", "USERNAME_CHANGE_NOT_ELIGIBLE", {
      nextEligibleAt: eligibility.nextEligibleAt,
    });
  }
  const config = eligibility.config;

  const availability = await checkUsernameAvailability(newUsername, { excludeUserId: input.userId });
  if (!availability.available) {
    throw conflict(availability.reason ?? "This username is not available.", "USERNAME_UNAVAILABLE");
  }

  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    // 2. Lock the user's row and re-read the current username inside the
    // transaction (race-safety for concurrent changes on the SAME account).
    // The users_username_key UNIQUE constraint remains the final backstop
    // against a same-new-name race with a DIFFERENT account between the
    // pre-checks above and this write.
    const { rows: userRows } = await tx.execute<{ username: string }>(sql`
      SELECT username FROM users WHERE id = ${input.userId} AND deleted_at IS NULL LIMIT 1 FOR UPDATE
    `);
    const oldUsername = userRows[0]?.username?.toLowerCase();
    if (!oldUsername) {
      throw badRequest("Account not found.");
    }
    if (oldUsername === newUsername) {
      throw conflict("That's already your username.", "USERNAME_UNCHANGED");
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
    // the pre-checks above already re-checked before this write.
    await tx.update(schema.users).set({ username: newUsername, updatedAt: new Date() }).where(eq(schema.users.id, input.userId));

    // 5. Record history (admin/mod-facing "Username history"). The hold on
    // the old username lasts exactly one year when not redirecting (fixed
    // by product spec, not admin-configurable), or forever when redirecting.
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const finalReservedUntilDate = input.redirectEnabled ? null : oneYearFromNow;
    const finalReservedUntil = finalReservedUntilDate ? finalReservedUntilDate.toISOString() : null;

    await tx.insert(schema.usernameChangeHistory).values({
      userId: input.userId,
      oldUsername,
      newUsername,
      redirectEnabled: input.redirectEnabled,
      reservedUntil: finalReservedUntilDate,
      costPaidCredits: currencyCharged === "credits" ? config.costCredits : 0,
      costPaidStars: currencyCharged === "stars" ? config.costStars : 0,
    });

    // 6. Reserve the old username so nobody (including the original owner)
    // can claim it — either indefinitely (redirect case) or for one year
    // (non-redirect case, lazily released by resolveOldUsername/
    // checkUsernameAvailability comparing reserved_until to NOW() at read
    // time — no cron dependency for correctness).
    await tx
      .insert(schema.usernameReservations)
      .values({
        oldUsername,
        previousUserId: input.userId,
        redirectToUsername: input.redirectEnabled ? newUsername : null,
        reservedUntil: finalReservedUntilDate,
      })
      .onConflictDoUpdate({
        target: schema.usernameReservations.oldUsername,
        set: {
          previousUserId: input.userId,
          redirectToUsername: input.redirectEnabled ? newUsername : null,
          reservedUntil: finalReservedUntilDate,
          createdAt: new Date(),
        },
      });

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
