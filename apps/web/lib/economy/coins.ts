/**
 * lib/economy/coins.ts
 *
 * Coin economy operations — all DB-transaction-safe, immutable ledger,
 * Decimal.js arithmetic throughout.
 *
 * Design principles:
 *  - All mutations go through `coin_ledger` (append-only); the user's
 *    `coin_balance` column is always the derived truth but updated atomically.
 *  - `SELECT FOR UPDATE` on the user row prevents race conditions.
 *  - Amounts are always positive integers (coins, not kobo).
 *  - Decimal.js is used for all arithmetic to prevent float drift.
 *
 * @module lib/economy/coins
 */

import Decimal from "decimal.js";
import type { TransactionClient } from "@/lib/db/interface";
import { db } from "@/lib/db";
import type { CoinTransactionType, CoinLedgerEntry } from "@zobia/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch and lock the user's current coin balance inside a transaction.
 * Uses SELECT FOR UPDATE so concurrent operations serialize correctly.
 *
 * @param userId - The user's UUID
 * @param tx     - Active transaction client
 * @returns Current coin balance as a Decimal
 * @throws If the user row is not found
 */
async function lockAndGetBalance(
  userId: string,
  tx: TransactionClient
): Promise<Decimal> {
  const { rows } = await tx.query<{ coin_balance: string }>(
    `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) {
    throw new Error(`[coins] User not found: ${userId}`);
  }
  return new Decimal(rows[0].coin_balance);
}

/**
 * Write a coin_ledger entry inside a transaction.
 * This is the single authoritative write path for all coin movements.
 */
async function writeLedgerEntry(
  tx: TransactionClient,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: CoinTransactionType,
  referenceId: string | null,
  description: string | null,
  metadata: Record<string, unknown> | null
): Promise<CoinLedgerEntry> {
  const { rows } = await tx.query<CoinLedgerEntry>(
    `INSERT INTO coin_ledger
       (user_id, amount, balance_before, balance_after,
        transaction_type, reference_id, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      amount.toFixed(0),
      balanceBefore.toFixed(0),
      balanceAfter.toFixed(0),
      type,
      referenceId ?? null,
      description ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Exported operations
// ---------------------------------------------------------------------------

/**
 * Credit coins to a user's balance atomically.
 *
 * Locks the user row, appends a ledger entry, and updates the balance in a
 * single transaction. Safe to call from webhook handlers.
 *
 * @param userId      - Recipient user UUID
 * @param amount      - Positive integer number of coins to credit
 * @param type        - Ledger transaction type (e.g. "purchase", "quest_reward")
 * @param referenceId - Optional external reference (payment ID, quest ID…)
 * @param description - Human-readable description stored in the ledger
 * @param metadata    - Arbitrary structured data (stored as JSONB)
 * @param txClient    - If provided, runs inside the given transaction; otherwise wraps in one
 * @returns The ledger entry that was created
 * @throws If amount is not a positive integer
 */
export async function creditCoins(
  userId: string,
  amount: number,
  type: CoinTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: TransactionClient
): Promise<CoinLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[coins] creditCoins: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<CoinLedgerEntry> => {
    const balanceBefore = await lockAndGetBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    await tx.query(
      `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
      [balanceAfter.toFixed(0), userId]
    );

    return writeLedgerEntry(tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description, metadata);
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/**
 * Debit coins from a user's balance atomically.
 *
 * Fails with an error if the user cannot afford the amount, preventing the
 * balance from going negative.
 *
 * @param userId      - Payer user UUID
 * @param amount      - Positive integer number of coins to debit
 * @param type        - Ledger transaction type (e.g. "gift_sent", "dm_cost")
 * @param referenceId - Optional external reference
 * @param description - Human-readable description
 * @param metadata    - Arbitrary structured data
 * @param txClient    - If provided, runs inside the given transaction; otherwise wraps in one
 * @returns The ledger entry that was created
 * @throws `INSUFFICIENT_BALANCE` if the user cannot afford the amount
 */
export async function debitCoins(
  userId: string,
  amount: number,
  type: CoinTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: TransactionClient
): Promise<CoinLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[coins] debitCoins: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<CoinLedgerEntry> => {
    const balanceBefore = await lockAndGetBalance(userId, tx);

    if (balanceBefore.lt(dec)) {
      const err = new Error(`Insufficient coin balance`);
      (err as NodeJS.ErrnoException).code = "INSUFFICIENT_BALANCE";
      throw err;
    }

    const balanceAfter = balanceBefore.minus(dec);
    const debitAmount = dec.negated();

    await tx.query(
      `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
      [balanceAfter.toFixed(0), userId]
    );

    return writeLedgerEntry(tx, userId, debitAmount, balanceBefore, balanceAfter, type, referenceId, description, metadata);
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/**
 * Return the current coin balance for a user.
 *
 * @param userId   - The user's UUID
 * @param txClient - Optional transaction client for consistency in multi-step ops
 * @returns Current balance as a number (integer coins)
 */
export async function getBalance(
  userId: string,
  txClient?: TransactionClient
): Promise<number> {
  const query = txClient ?? db;
  const { rows } = await query.query<{ coin_balance: number }>(
    `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw new Error(`[coins] User not found: ${userId}`);
  return new Decimal(rows[0].coin_balance).toNumber();
}

/**
 * Check whether a user can afford a given coin amount.
 *
 * READ-ONLY — does not lock. Use before debitCoins in UX flows.
 *
 * @param userId - The user's UUID
 * @param amount - Coin amount to check affordability for
 * @param txClient - Optional transaction client
 * @returns true if the user's balance is >= amount
 */
export async function canAfford(
  userId: string,
  amount: number,
  txClient?: TransactionClient
): Promise<boolean> {
  const balance = await getBalance(userId, txClient);
  return new Decimal(balance).gte(new Decimal(amount));
}

/**
 * Transfer coins from one user to another, deducting a platform fee.
 *
 * Atomically:
 *  1. Debits `amount` from `fromUserId`
 *  2. Credits `amount * (1 - feePercent/100)` to `toUserId`
 *  3. The fee remainder stays on the platform (not credited anywhere)
 *
 * Both ledger entries reference the same transaction so the audit trail
 * is complete.
 *
 * @param fromUserId - Sender user UUID
 * @param toUserId   - Recipient user UUID
 * @param amount     - Gross coins to transfer (fee deducted from this)
 * @param feePercent - Platform fee percentage (0–100); default 5
 * @param txClient   - Optional outer transaction client
 * @returns Object with debit and credit ledger entries and the fee amount
 * @throws `INSUFFICIENT_BALANCE` if sender cannot afford the gross amount
 */
export async function transferCoins(
  fromUserId: string,
  toUserId: string,
  amount: number,
  feePercent: number = 5,
  txClient?: TransactionClient,
  senderTransactionType: CoinTransactionType = "gift_sent",
  recipientTransactionType: CoinTransactionType = "gift_received",
  idempotencyRef?: string
): Promise<{ debit: CoinLedgerEntry; credit: CoinLedgerEntry; feeCoins: number }> {
  const gross = new Decimal(amount);
  if (!gross.isInteger() || gross.lte(0)) {
    throw new Error(`[coins] transferCoins: amount must be a positive integer, got ${amount}`);
  }
  const fee = gross.times(feePercent).dividedBy(100).floor();
  const net = gross.minus(fee);

  const transferRef = idempotencyRef ?? `transfer:${fromUserId}:${toUserId}:${amount}`;

  const run = async (tx: TransactionClient) => {
    // Lock both rows in deterministic ascending UUID order to prevent deadlocks (BUG-20)
    const [firstId, secondId] = fromUserId < toUserId
      ? [fromUserId, toUserId]
      : [toUserId, fromUserId];
    await tx.query(
      `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
      [firstId]
    );
    await tx.query(
      `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
      [secondId]
    );
    // debitCoins and creditCoins will re-lock their rows (already locked above)

    const debit = await debitCoins(
      fromUserId,
      gross.toNumber(),
      senderTransactionType,
      transferRef,
      `Transfer to user ${toUserId} (${feePercent}% fee)`,
      { toUserId, feePercent, feeCoins: fee.toNumber() },
      tx
    );

    const credit = await creditCoins(
      toUserId,
      net.toNumber(),
      recipientTransactionType,
      transferRef,
      `Transfer from user ${fromUserId}`,
      { fromUserId, feePercent, feeCoins: fee.toNumber() },
      tx
    );

    return { debit, credit, feeCoins: fee.toNumber() };
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/**
 * Fetch recent coin ledger entries for a user.
 *
 * @param userId - The user's UUID
 * @param limit  - Max entries to return (default 20)
 * @param txClient - Optional transaction client
 * @returns Array of ledger entries, newest first
 */
export async function getLedgerEntries(
  userId: string,
  limit: number = 20,
  txClient?: TransactionClient
): Promise<CoinLedgerEntry[]> {
  const query = txClient ?? db;
  const { rows } = await query.query<CoinLedgerEntry>(
    `SELECT id, user_id, amount, balance_before, balance_after,
            transaction_type, reference_id, description, metadata, created_at
     FROM coin_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
