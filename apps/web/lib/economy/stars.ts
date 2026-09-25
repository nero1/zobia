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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
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
  | "game_play_cost"
  | "moment_created"
  | "blog_extra_slot"
  | "blog_theme_purchase"
  | "profile_theme_purchase"
  | "blog_gift_purchase"
  | "blog_gift_earnings"
  | "bbforum_image_upload"
  | "support_ticket_cost"
  | "room_reward_fund"
  | "room_reward_claim"
  | "avatar_change"
  | "username_change";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Drizzle star_ledger row (camelCase, bigint columns) onto the shared
 * `StarLedgerEntry` shape, which callers across the codebase read via both
 * camelCase AND snake_case keys — both are populated here so no caller
 * outside this migration batch is broken by the raw-SQL -> Drizzle swap.
 */
function toStarLedgerEntry(row: typeof schema.starLedger.$inferSelect): StarLedgerEntry {
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
    transactionType: row.transactionType,
    transaction_type: row.transactionType,
    referenceId: row.referenceId ?? undefined,
    reference_id: row.referenceId ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
  };
}

/**
 * Lock and return a user's current star balance within a transaction.
 *
 * @param userId - The user's UUID
 * @param tx     - Active transaction client
 * @returns Current star balance as Decimal
 * @throws If user row is not found
 */
async function lockAndGetStarBalance(userId: string, tx: DbOrTx): Promise<Decimal> {
  const rows = await tx
    .select({ starBalance: schema.users.starBalance })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .for("update");
  if (!rows[0]) {
    throw new Error(`[stars] User not found: ${userId}`);
  }
  return new Decimal(rows[0].starBalance.toString());
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
  tx: DbOrTx,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: StarTransactionType,
  referenceId: string | null,
  description: string | null
): Promise<{ entry: StarLedgerEntry; inserted: boolean }> {
  const inserted = await tx
    .insert(schema.starLedger)
    .values({
      userId,
      amount: BigInt(amount.toFixed(0)),
      balanceBefore: BigInt(balanceBefore.toFixed(0)),
      balanceAfter: BigInt(balanceAfter.toFixed(0)),
      transactionType: type,
      referenceId: referenceId ?? null,
      description: description ?? null,
    })
    .onConflictDoNothing({
      target: [schema.starLedger.userId, schema.starLedger.transactionType, schema.starLedger.referenceId],
      where: sql`${schema.starLedger.referenceId} IS NOT NULL`,
    })
    .returning();

  if (inserted[0]) return { entry: toStarLedgerEntry(inserted[0]), inserted: true };

  const existing = await tx
    .select()
    .from(schema.starLedger)
    .where(
      and(
        eq(schema.starLedger.userId, userId),
        eq(schema.starLedger.transactionType, type),
        eq(schema.starLedger.referenceId, referenceId as string)
      )
    )
    .limit(1);
  return { entry: toStarLedgerEntry(existing[0]), inserted: false };
}

/**
 * Look up an existing star_ledger row for a dedup key before locking the
 * user row, so a retried debit short-circuits as a no-op instead of
 * potentially failing INSUFFICIENT_STAR_BALANCE against a balance that has
 * since moved.
 */
async function findExistingStarLedgerEntry(
  tx: DbOrTx,
  userId: string,
  type: StarTransactionType,
  referenceId: string | null
): Promise<StarLedgerEntry | null> {
  if (!referenceId) return null;
  const rows = await tx
    .select()
    .from(schema.starLedger)
    .where(
      and(
        eq(schema.starLedger.userId, userId),
        eq(schema.starLedger.transactionType, type),
        eq(schema.starLedger.referenceId, referenceId)
      )
    )
    .limit(1);
  return rows[0] ? toStarLedgerEntry(rows[0]) : null;
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
  txClient?: DbOrTx
): Promise<StarLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[stars] creditStars: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<StarLedgerEntry> => {
    const dup = await findExistingStarLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetStarBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    const { entry, inserted } = await writeStarLedgerEntry(
      tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description
    );

    if (inserted) {
      await tx
        .update(schema.users)
        .set({ starBalance: BigInt(balanceAfter.toFixed(0)), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }

    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
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
  txClient?: DbOrTx
): Promise<StarLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[stars] debitStars: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<StarLedgerEntry> => {
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
      await tx
        .update(schema.users)
        .set({ starBalance: BigInt(balanceAfter.toFixed(0)), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    }

    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
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
  txClient?: DbOrTx
): Promise<number> {
  const client = txClient ?? (await getDb());
  const rows = await client
    .select({ starBalance: schema.users.starBalance })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!rows[0]) throw new Error(`[stars] User not found: ${userId}`);
  return new Decimal(rows[0].starBalance.toString()).toNumber();
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
  txClient?: DbOrTx
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
  txClient?: DbOrTx,
  cursor?: StarLedgerCursor | null
): Promise<StarLedgerPage> {
  const client = txClient ?? (await getDb());

  const conditions = [eq(schema.starLedger.userId, userId)];
  if (cursor) {
    conditions.push(
      sql`(${schema.starLedger.createdAt}, ${schema.starLedger.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    );
  }

  const rows = await client
    .select()
    .from(schema.starLedger)
    .where(and(...conditions))
    .orderBy(desc(schema.starLedger.createdAt), desc(schema.starLedger.id))
    .limit(limit);

  const entries = rows.map(toStarLedgerEntry);
  const lastRow = rows[rows.length - 1];
  const nextCursor: StarLedgerCursor | null =
    rows.length === limit && lastRow
      ? { createdAt: lastRow.createdAt ? lastRow.createdAt.toISOString() : "", id: lastRow.id }
      : null;

  return { entries, nextCursor };
}
