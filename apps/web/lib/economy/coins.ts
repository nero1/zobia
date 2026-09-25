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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import type { CoinTransactionType, CoinLedgerEntry } from "@zobia/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Drizzle coin_ledger row (camelCase, bigint columns) onto the shared
 * `CoinLedgerEntry` shape, which callers across the codebase read via both
 * camelCase AND snake_case keys (e.g. `entry.balance_after`,
 * `entry.transaction_type`) — both are populated here so no caller outside
 * this migration batch is broken by the raw-SQL -> Drizzle swap.
 */
function toLedgerEntry(row: typeof schema.coinLedger.$inferSelect): CoinLedgerEntry {
  const amount = Number(row.amount);
  const balanceBefore = Number(row.balanceBefore);
  const balanceAfter = Number(row.balanceAfter);
  return {
    id: row.id,
    userId: row.userId,
    user_id: row.userId,
    amount,
    balanceBefore,
    balance_before: balanceBefore,
    balanceAfter,
    balance_after: balanceAfter,
    transactionType: row.transactionType as CoinTransactionType,
    transaction_type: row.transactionType as CoinTransactionType,
    referenceId: row.referenceId ?? undefined,
    reference_id: row.referenceId ?? undefined,
    description: row.description ?? undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
  };
}

/**
 * Fetch and lock the user's current coin balance inside a transaction.
 * Uses SELECT FOR UPDATE so concurrent operations serialize correctly.
 *
 * @param userId - The user's UUID
 * @param tx     - Active transaction client
 * @returns Current coin balance as a Decimal
 * @throws If the user row is not found
 */
async function lockAndGetBalance(userId: string, tx: DbOrTx): Promise<Decimal> {
  const rows = await tx
    .select({ coinBalance: schema.users.coinBalance })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .for("update");
  if (!rows[0]) {
    throw new Error(`[coins] User not found: ${userId}`);
  }
  return new Decimal(rows[0].coinBalance.toString());
}

/**
 * Write a coin_ledger entry inside a transaction.
 * This is the single authoritative write path for all coin movements.
 *
 * SYS-CL-ROOT: `uidx_coin_ledger_tx_type_ref` is a partial unique index on
 * (user_id, transaction_type, reference_id). On a duplicate (e.g. a retried
 * request reusing the same idempotency reference), the INSERT becomes a
 * no-op and we return the already-written row instead of throwing — the
 * caller uses `inserted` to decide whether the balance UPDATE should apply,
 * so a legitimate retry never double-credits/debits the user.
 */
async function writeLedgerEntry(
  tx: DbOrTx,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: CoinTransactionType,
  referenceId: string | null,
  description: string | null,
  metadata: Record<string, unknown> | null
): Promise<{ entry: CoinLedgerEntry; inserted: boolean }> {
  const inserted = await tx
    .insert(schema.coinLedger)
    .values({
      userId,
      amount: BigInt(amount.toFixed(0)),
      balanceBefore: BigInt(balanceBefore.toFixed(0)),
      balanceAfter: BigInt(balanceAfter.toFixed(0)),
      transactionType: type,
      referenceId: referenceId ?? null,
      description: description ?? null,
      metadata: metadata ?? null,
    })
    .onConflictDoNothing({
      target: [schema.coinLedger.userId, schema.coinLedger.transactionType, schema.coinLedger.referenceId],
      where: sql`${schema.coinLedger.referenceId} IS NOT NULL`,
    })
    .returning();

  if (inserted[0]) return { entry: toLedgerEntry(inserted[0]), inserted: true };

  const existing = await tx
    .select()
    .from(schema.coinLedger)
    .where(
      and(
        eq(schema.coinLedger.userId, userId),
        eq(schema.coinLedger.transactionType, type),
        eq(schema.coinLedger.referenceId, referenceId as string)
      )
    )
    .limit(1);
  return { entry: toLedgerEntry(existing[0]), inserted: false };
}

/**
 * Look up an existing coin_ledger row for a dedup key before locking the
 * user row. This lets a retried debit short-circuit as a no-op even if the
 * user's balance has since dropped below the original amount — without it,
 * a legitimate retry of an already-applied debit would incorrectly fail
 * with INSUFFICIENT_BALANCE.
 */
async function findExistingLedgerEntry(
  tx: DbOrTx,
  userId: string,
  type: CoinTransactionType,
  referenceId: string | null
): Promise<CoinLedgerEntry | null> {
  if (!referenceId) return null;
  const rows = await tx
    .select()
    .from(schema.coinLedger)
    .where(
      and(
        eq(schema.coinLedger.userId, userId),
        eq(schema.coinLedger.transactionType, type),
        eq(schema.coinLedger.referenceId, referenceId)
      )
    )
    .limit(1);
  return rows[0] ? toLedgerEntry(rows[0]) : null;
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
  txClient?: DbOrTx
): Promise<CoinLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[coins] creditCoins: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<CoinLedgerEntry> => {
    const dup = await findExistingLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    const { entry, inserted } = await writeLedgerEntry(
      tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description, metadata
    );

    // Only apply the balance change if this is a genuinely new ledger entry —
    // a duplicate reference means an earlier call already updated the balance.
    if (inserted) {
      await tx
        .update(schema.users)
        .set({ coinBalance: BigInt(balanceAfter.toFixed(0)), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }

    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
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
  txClient?: DbOrTx
): Promise<CoinLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[coins] debitCoins: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<CoinLedgerEntry> => {
    const dup = await findExistingLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetBalance(userId, tx);

    if (balanceBefore.lt(dec)) {
      const err = new Error(`Insufficient coin balance`);
      (err as NodeJS.ErrnoException).code = "INSUFFICIENT_BALANCE";
      throw err;
    }

    const balanceAfter = balanceBefore.minus(dec);
    const debitAmount = dec.negated();

    const { entry, inserted } = await writeLedgerEntry(
      tx, userId, debitAmount, balanceBefore, balanceAfter, type, referenceId, description, metadata
    );

    if (inserted) {
      await tx
        .update(schema.users)
        .set({ coinBalance: BigInt(balanceAfter.toFixed(0)), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }

    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
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
  txClient?: DbOrTx
): Promise<number> {
  const client = txClient ?? (await getDb());
  const rows = await client
    .select({ coinBalance: schema.users.coinBalance })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!rows[0]) throw new Error(`[coins] User not found: ${userId}`);
  return new Decimal(rows[0].coinBalance.toString()).toNumber();
}

/**
 * Check whether a user can afford a given coin amount.
 *
 * READ-ONLY — does not lock. Use before debitCoins in UX flows.
 *
 * ADVISORY ONLY — does not lock the user row. Never use as the sole gate on a
 * financial debit. The balance can change between this check and the actual
 * debit, creating a race condition.
 *
 * Always use debitCoins() (which uses SELECT FOR UPDATE internally) to actually
 * debit. For an atomic check-and-debit in a single operation, use checkAndDebit().
 *
 * @param userId - The user's UUID
 * @param amount - Coin amount to check affordability for
 * @param txClient - Optional transaction client
 * @returns true if the user's balance is >= amount
 */
export async function canAfford(
  userId: string,
  amount: number,
  txClient?: DbOrTx
): Promise<boolean> {
  const balance = await getBalance(userId, txClient);
  return new Decimal(balance).gte(new Decimal(amount));
}

/**
 * Atomically check the user's balance and debit coins in a single operation.
 *
 * This is the correct way to enforce affordability before debiting. Unlike
 * calling canAfford() then debitCoins() separately, this function cannot race:
 * debitCoins() internally acquires SELECT FOR UPDATE on the user row, so the
 * balance cannot change between the check and the debit.
 *
 * @param userId      - The user's UUID
 * @param amount      - Positive integer number of coins to debit
 * @param type        - Ledger transaction type
 * @param referenceId - Optional external reference
 * @param description - Human-readable description
 * @param metadata    - Arbitrary structured data
 * @param txClient    - If provided, runs inside the given transaction
 * @returns The ledger entry that was created
 * @throws `INSUFFICIENT_BALANCE` if the user cannot afford the amount
 */
export async function checkAndDebit(
  userId: string,
  amount: number,
  type: CoinTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: DbOrTx
): Promise<CoinLedgerEntry> {
  // debitCoins already does SELECT FOR UPDATE + balance check atomically
  return debitCoins(userId, amount, type, referenceId, description, metadata, txClient);
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
 * @param fromUserId     - Sender user UUID
 * @param toUserId       - Recipient user UUID
 * @param amount         - Gross coins to transfer (fee deducted from this)
 * @param idempotencyRef - Stable reference so retries don't double-debit
 * @param feePercent     - Platform fee percentage (0–100); default 5
 * @param txClient       - Optional outer transaction client
 * @returns Object with debit and credit ledger entries and the fee amount
 * @throws `INSUFFICIENT_BALANCE` if sender cannot afford the gross amount
 */
export async function transferCoins(
  fromUserId: string,
  toUserId: string,
  amount: number,
  idempotencyRef: string,
  feePercent: number = 5,
  txClient?: DbOrTx,
  senderTransactionType: CoinTransactionType = "gift_sent",
  recipientTransactionType: CoinTransactionType = "gift_received"
): Promise<{ debit: CoinLedgerEntry; credit: CoinLedgerEntry; feeCoins: number }> {
  const gross = new Decimal(amount);
  if (!gross.isInteger() || gross.lte(0)) {
    throw new Error(`[coins] transferCoins: amount must be a positive integer, got ${amount}`);
  }
  const fee = gross.times(feePercent).dividedBy(100).floor();
  const net = gross.minus(fee);

  const debitRef = `${idempotencyRef}:debit`;
  const creditRef = `${idempotencyRef}:credit`;

  const run = async (tx: DbOrTx) => {
    // Lock both rows in deterministic ascending UUID order to prevent deadlocks (BUG-20)
    const [firstId, secondId] = fromUserId < toUserId
      ? [fromUserId, toUserId]
      : [toUserId, fromUserId];
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, firstId)).for("update");
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, secondId)).for("update");
    // debitCoins and creditCoins will re-lock their rows (already locked above)

    const debit = await debitCoins(
      fromUserId,
      gross.toNumber(),
      senderTransactionType,
      debitRef,
      `Transfer to user ${toUserId} (${feePercent}% fee)`,
      { toUserId, feePercent, feeCoins: fee.toNumber() },
      tx
    );

    const credit = await creditCoins(
      toUserId,
      net.toNumber(),
      recipientTransactionType,
      creditRef,
      `Transfer from user ${fromUserId}`,
      { fromUserId, feePercent, feeCoins: fee.toNumber() },
      tx
    );

    return { debit, credit, feeCoins: fee.toNumber() };
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
}

/**
 * Fetch recent coin ledger entries for a user.
 *
 * @param userId - The user's UUID
 * @param limit  - Max entries to return (default 20)
 * @param txClient - Optional transaction client
 * @returns Array of ledger entries, newest first
 */
export interface LedgerCursor {
  createdAt: string;
  id: string;
}

export interface LedgerPage {
  entries: CoinLedgerEntry[];
  nextCursor: LedgerCursor | null;
}

export async function getLedgerEntries(
  userId: string,
  limit: number = 20,
  txClient?: DbOrTx,
  cursor?: LedgerCursor | null
): Promise<LedgerPage> {
  const client = txClient ?? (await getDb());

  const conditions = [eq(schema.coinLedger.userId, userId)];
  if (cursor) {
    // Keyset pagination on (created_at, id) — must match the ORDER BY below
    // exactly so a page boundary that lands mid-timestamp-tie is stable.
    conditions.push(
      sql`(${schema.coinLedger.createdAt}, ${schema.coinLedger.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    );
  }

  const rows = await client
    .select()
    .from(schema.coinLedger)
    .where(and(...conditions))
    .orderBy(desc(schema.coinLedger.createdAt), desc(schema.coinLedger.id))
    .limit(limit);

  const entries = rows.map(toLedgerEntry);
  const lastRow = rows[rows.length - 1];
  const nextCursor: LedgerCursor | null =
    rows.length === limit && lastRow
      ? { createdAt: lastRow.createdAt ? lastRow.createdAt.toISOString() : "", id: lastRow.id }
      : null;

  return { entries, nextCursor };
}
