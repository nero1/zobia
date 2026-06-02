/**
 * lib/economy/stars.ts
 *
 * Star currency operations — scarce premium currency, separate from coins.
 *
 * Stars are harder to obtain than coins (earned through special events,
 * achievements, or direct purchase). All operations mirror the coin ledger
 * pattern: append-only `star_ledger`, SELECT FOR UPDATE, Decimal.js arithmetic.
 *
 * @module lib/economy/stars
 */

import Decimal from "decimal.js";
import type { TransactionClient } from "@/lib/db/interface";
import { db } from "@/lib/db";
import type { StarLedgerEntry } from "@zobia/types";

// ---------------------------------------------------------------------------
// Star transaction types — separate from CoinTransactionType
// ---------------------------------------------------------------------------

export type StarTransactionType =
  | "purchase"
  | "quest_reward"
  | "achievement_reward"
  | "gift_sent"
  | "gift_received"
  | "season_pass"
  | "admin_grant"
  | "refund"
  | "ad_reward";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Lock and return a user's current star balance within a transaction.
 *
 * @param userId - The user's UUID
 * @param tx     - Active transaction client
 * @returns Current star balance as Decimal
 * @throws If user row is not found
 */
async function lockAndGetStarBalance(
  userId: string,
  tx: TransactionClient
): Promise<Decimal> {
  const { rows } = await tx.query<{ star_balance: string }>(
    `SELECT star_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) {
    throw new Error(`[stars] User not found: ${userId}`);
  }
  return new Decimal(rows[0].star_balance);
}

/**
 * Write a star_ledger entry inside a transaction.
 */
async function writeStarLedgerEntry(
  tx: TransactionClient,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: StarTransactionType,
  referenceId: string | null,
  description: string | null
): Promise<void> {
  await tx.query(
    `INSERT INTO star_ledger
       (user_id, amount, balance_before, balance_after,
        transaction_type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      amount.toNumber(),
      balanceBefore.toNumber(),
      balanceAfter.toNumber(),
      type,
      referenceId ?? null,
      description ?? null,
    ]
  );
}

// ---------------------------------------------------------------------------
// Exported operations
// ---------------------------------------------------------------------------

/**
 * Credit stars to a user's balance atomically.
 *
 * @param userId      - Recipient user UUID
 * @param amount      - Positive integer number of stars to credit
 * @param type        - Star transaction type
 * @param referenceId - Optional external reference ID
 * @param description - Human-readable description stored in the ledger
 * @param txClient    - Optional outer transaction client
 * @returns The star ledger entry that was created
 * @throws If amount is not a positive integer
 */
export async function creditStars(
  userId: string,
  amount: number,
  type: StarTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  txClient?: TransactionClient
): Promise<StarLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[stars] creditStars: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<StarLedgerEntry> => {
    const balanceBefore = await lockAndGetStarBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    await tx.query(
      `UPDATE users SET star_balance = $1, updated_at = NOW() WHERE id = $2`,
      [balanceAfter.toNumber(), userId]
    );

    await writeStarLedgerEntry(tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description);

    const { rows } = await tx.query<StarLedgerEntry>(
      `SELECT * FROM star_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0];
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/**
 * Debit stars from a user's balance atomically.
 *
 * Fails if the user cannot afford the deduction (no negative balances).
 *
 * @param userId      - Payer user UUID
 * @param amount      - Positive integer number of stars to debit
 * @param type        - Star transaction type
 * @param referenceId - Optional external reference
 * @param description - Human-readable description
 * @param txClient    - Optional outer transaction client
 * @returns The star ledger entry that was created
 * @throws `INSUFFICIENT_STAR_BALANCE` if balance is too low
 */
export async function debitStars(
  userId: string,
  amount: number,
  type: StarTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  txClient?: TransactionClient
): Promise<StarLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[stars] debitStars: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<StarLedgerEntry> => {
    const balanceBefore = await lockAndGetStarBalance(userId, tx);

    if (balanceBefore.lt(dec)) {
      const err = new Error(`Insufficient star balance`);
      (err as NodeJS.ErrnoException).code = "INSUFFICIENT_STAR_BALANCE";
      throw err;
    }

    const balanceAfter = balanceBefore.minus(dec);
    const debitAmount = dec.negated();

    await tx.query(
      `UPDATE users SET star_balance = $1, updated_at = NOW() WHERE id = $2`,
      [balanceAfter.toNumber(), userId]
    );

    await writeStarLedgerEntry(tx, userId, debitAmount, balanceBefore, balanceAfter, type, referenceId, description);

    const { rows } = await tx.query<StarLedgerEntry>(
      `SELECT * FROM star_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0];
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/**
 * Return the current star balance for a user.
 *
 * @param userId   - The user's UUID
 * @param txClient - Optional transaction client for consistency in multi-step ops
 * @returns Current star balance as a number (integer stars)
 */
export async function getStarBalance(
  userId: string,
  txClient?: TransactionClient
): Promise<number> {
  const query = txClient ?? db;
  const { rows } = await query.query<{ star_balance: number }>(
    `SELECT star_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw new Error(`[stars] User not found: ${userId}`);
  return new Decimal(rows[0].star_balance).toNumber();
}

/**
 * Check if a user can afford a given star amount.
 *
 * READ-ONLY. Use before debitStars in UX confirmation flows.
 *
 * @param userId - The user's UUID
 * @param amount - Star amount to check
 * @param txClient - Optional transaction client
 * @returns true if balance >= amount
 */
export async function canAffordStars(
  userId: string,
  amount: number,
  txClient?: TransactionClient
): Promise<boolean> {
  const balance = await getStarBalance(userId, txClient);
  return new Decimal(balance).gte(new Decimal(amount));
}

/**
 * Fetch recent star ledger entries for a user.
 *
 * @param userId - The user's UUID
 * @param limit  - Max entries to return (default 20)
 * @param txClient - Optional transaction client
 * @returns Array of ledger entries, newest first
 */
export async function getStarLedgerEntries(
  userId: string,
  limit: number = 20,
  txClient?: TransactionClient
): Promise<StarLedgerEntry[]> {
  const query = txClient ?? db;
  const { rows } = await query.query<StarLedgerEntry>(
    `SELECT id, user_id, amount, balance_before, balance_after,
            transaction_type, reference_id, description, created_at
     FROM star_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
