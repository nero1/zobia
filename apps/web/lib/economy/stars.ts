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
  | "ad_reward"
  | "cosmetic_purchase"
  | "game_reward"
  | "game_play_cost";

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
 *
 * STAR-NOIDEM: `uidx_star_ledger_tx_type_ref` is a partial unique index on
 * (user_id, transaction_type, reference_id), mirroring coin_ledger. On a
 * duplicate, the INSERT is a no-op and the existing row is returned instead
 * of throwing — the caller uses `inserted` to skip the balance UPDATE so a
 * retried request never double-credits/debits stars.
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
): Promise<{ entry: StarLedgerEntry; inserted: boolean }> {
  const { rows } = await tx.query<StarLedgerEntry>(
    `INSERT INTO star_ledger
       (user_id, amount, balance_before, balance_after,
        transaction_type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      userId,
      amount.toFixed(0),
      balanceBefore.toFixed(0),
      balanceAfter.toFixed(0),
      type,
      referenceId ?? null,
      description ?? null,
    ]
  );
  if (rows[0]) return { entry: rows[0], inserted: true };

  const { rows: existing } = await tx.query<StarLedgerEntry>(
    `SELECT * FROM star_ledger
     WHERE user_id = $1 AND transaction_type = $2 AND reference_id = $3
     LIMIT 1`,
    [userId, type, referenceId]
  );
  return { entry: existing[0], inserted: false };
}

/**
 * Look up an existing star_ledger row for a dedup key before locking the
 * user row, so a retried debit short-circuits as a no-op instead of
 * potentially failing INSUFFICIENT_STAR_BALANCE against a balance that has
 * since moved.
 */
async function findExistingStarLedgerEntry(
  tx: TransactionClient,
  userId: string,
  type: StarTransactionType,
  referenceId: string | null
): Promise<StarLedgerEntry | null> {
  if (!referenceId) return null;
  const { rows } = await tx.query<StarLedgerEntry>(
    `SELECT * FROM star_ledger
     WHERE user_id = $1 AND transaction_type = $2 AND reference_id = $3
     LIMIT 1`,
    [userId, type, referenceId]
  );
  return rows[0] ?? null;
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
    const dup = await findExistingStarLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetStarBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    const { entry, inserted } = await writeStarLedgerEntry(
      tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description
    );

    if (inserted) {
      await tx.query(
        `UPDATE users SET star_balance = $1, updated_at = NOW() WHERE id = $2`,
        [balanceAfter.toFixed(0), userId]
      );
    }

    return entry;
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
    const dup = await findExistingStarLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetStarBalance(userId, tx);

    if (balanceBefore.lt(dec)) {
      const err = new Error(`Insufficient star balance`);
      (err as NodeJS.ErrnoException).code = "INSUFFICIENT_STAR_BALANCE";
      throw err;
    }

    const balanceAfter = balanceBefore.minus(dec);
    const debitAmount = dec.negated();

    const { entry, inserted } = await writeStarLedgerEntry(
      tx, userId, debitAmount, balanceBefore, balanceAfter, type, referenceId, description
    );

    if (inserted) {
      await tx.query(
        `UPDATE users SET star_balance = $1, updated_at = NOW() WHERE id = $2`,
        [balanceAfter.toFixed(0), userId]
      );
    }

    return entry;
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
  const { rows } = await query.query<{ star_balance: string }>(
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
export interface StarLedgerCursor {
  createdAt: string;
  id: string;
}

export interface StarLedgerPage {
  entries: StarLedgerEntry[];
  nextCursor: StarLedgerCursor | null;
}

export async function getStarLedgerEntries(
  userId: string,
  limit: number = 20,
  txClient?: TransactionClient,
  cursor?: StarLedgerCursor | null
): Promise<StarLedgerPage> {
  const query = txClient ?? db;
  const params: (string | number)[] = [userId, limit];
  let cursorClause = "";

  if (cursor) {
    cursorClause = `AND (created_at, id) < ($3::timestamptz, $4::uuid)`;
    params.push(cursor.createdAt, cursor.id);
  }

  const { rows } = await query.query<StarLedgerEntry>(
    `SELECT id, user_id, amount, balance_before, balance_after,
            transaction_type, reference_id, description, created_at
     FROM star_ledger
     WHERE user_id = $1
       ${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    params
  );

  const lastRow = rows[rows.length - 1];
  const nextCursor: StarLedgerCursor | null =
    rows.length === limit && lastRow
      ? { createdAt: String(lastRow.created_at), id: lastRow.id }
      : null;

  return { entries: rows, nextCursor };
}
