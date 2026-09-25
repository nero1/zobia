/**
 * lib/economy/adWallet.ts
 *
 * Ad Wallet — a distinct prepaid Credits balance for running ads, separate
 * from the main `coin_balance`. Mirrors lib/economy/coins.ts exactly (same
 * append-only ledger + idempotency + SELECT FOR UPDATE pattern) so it gets
 * the same atomicity guarantees, just against `ad_wallet_ledger` /
 * `users.ad_wallet_balance` instead of `coin_ledger` / `users.coin_balance`.
 *
 * Funded two ways:
 *  - Transfer from the user's main Credits balance (debitCoins + creditAdWallet
 *    in one transaction — see POST /api/business/ads/wallet/transfer).
 *  - Direct purchase via the existing payment-provider flow, with
 *    `destination: "ad_wallet"` routing the webhook's credit here instead of
 *    to coin_balance (see lib/payments/paystackWebhookHandler.ts and lib/payments/crypto/).
 *
 * Campaign funding (lib/ads/repo.ts fundCampaign) debits from here, not from
 * coin_balance — ads only run once this balance actually has funds in it.
 *
 * @module lib/economy/adWallet
 */

import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";

export type AdWalletTransactionType =
  | "topup_purchase"
  | "transfer_in"
  | "ad_campaign_funding"
  | "ad_campaign_refund";

export interface AdWalletLedgerEntry {
  id: string;
  user_id: string;
  amount: string;
  balance_before: string;
  balance_after: string;
  transaction_type: AdWalletTransactionType;
  reference_id: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function toEntry(row: typeof schema.adWalletLedger.$inferSelect): AdWalletLedgerEntry {
  return {
    id: row.id,
    user_id: row.userId,
    amount: row.amount.toString(),
    balance_before: row.balanceBefore.toString(),
    balance_after: row.balanceAfter.toString(),
    transaction_type: row.transactionType as AdWalletTransactionType,
    reference_id: row.referenceId ?? null,
    description: row.description ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    created_at: row.createdAt ? row.createdAt.toISOString() : "",
  };
}

// NOTE (schema gap): `users.ad_wallet_balance` is not modeled in
// lib/db/schema.ts (only `ad_wallet_ledger`, the ledger table, is). Reads/
// writes of that one column therefore go through Drizzle's `sql` tagged
// template via `.execute()` (still the shared Drizzle-wrapped pg.Pool, still
// fully parameterised) instead of the query builder, until schema.ts is
// extended to include it. Report this gap — do not edit schema.ts here.

async function lockAndGetBalance(userId: string, tx: DbOrTx): Promise<Decimal> {
  const result = await tx.execute<{ ad_wallet_balance: string }>(
    sql`SELECT ad_wallet_balance FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE`
  );
  if (!result.rows[0]) throw new Error(`[adWallet] User not found: ${userId}`);
  return new Decimal(result.rows[0].ad_wallet_balance);
}

async function findExistingLedgerEntry(
  tx: DbOrTx,
  userId: string,
  type: AdWalletTransactionType,
  referenceId: string | null
): Promise<AdWalletLedgerEntry | null> {
  if (!referenceId) return null;
  const rows = await tx
    .select()
    .from(schema.adWalletLedger)
    .where(
      and(
        eq(schema.adWalletLedger.userId, userId),
        eq(schema.adWalletLedger.transactionType, type),
        eq(schema.adWalletLedger.referenceId, referenceId)
      )
    )
    .limit(1);
  return rows[0] ? toEntry(rows[0]) : null;
}

async function writeLedgerEntry(
  tx: DbOrTx,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: AdWalletTransactionType,
  referenceId: string | null,
  description: string | null,
  metadata: Record<string, unknown> | null
): Promise<{ entry: AdWalletLedgerEntry; inserted: boolean }> {
  const inserted = await tx
    .insert(schema.adWalletLedger)
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
      target: [schema.adWalletLedger.userId, schema.adWalletLedger.transactionType, schema.adWalletLedger.referenceId],
      where: sql`${schema.adWalletLedger.referenceId} IS NOT NULL`,
    })
    .returning();

  if (inserted[0]) return { entry: toEntry(inserted[0]), inserted: true };

  const existing = await tx
    .select()
    .from(schema.adWalletLedger)
    .where(
      and(
        eq(schema.adWalletLedger.userId, userId),
        eq(schema.adWalletLedger.transactionType, type),
        eq(schema.adWalletLedger.referenceId, referenceId as string)
      )
    )
    .limit(1);
  return { entry: toEntry(existing[0]), inserted: false };
}

export async function creditAdWallet(
  userId: string,
  amount: number,
  type: AdWalletTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: DbOrTx
): Promise<AdWalletLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[adWallet] creditAdWallet: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<AdWalletLedgerEntry> => {
    const dup = await findExistingLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    const { entry, inserted } = await writeLedgerEntry(tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description, metadata);

    if (inserted) {
      await tx.execute(
        sql`UPDATE users SET ad_wallet_balance = ${balanceAfter.toFixed(0)}, updated_at = NOW() WHERE id = ${userId}`
      );
    }
    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
}

export async function debitAdWallet(
  userId: string,
  amount: number,
  type: AdWalletTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: DbOrTx
): Promise<AdWalletLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[adWallet] debitAdWallet: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: DbOrTx): Promise<AdWalletLedgerEntry> => {
    const dup = await findExistingLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetBalance(userId, tx);
    if (balanceBefore.lt(dec)) {
      const err = new Error("Insufficient ad wallet balance");
      (err as NodeJS.ErrnoException).code = "INSUFFICIENT_AD_WALLET_BALANCE";
      throw err;
    }

    const balanceAfter = balanceBefore.minus(dec);
    const { entry, inserted } = await writeLedgerEntry(tx, userId, dec.negated(), balanceBefore, balanceAfter, type, referenceId, description, metadata);

    if (inserted) {
      await tx.execute(
        sql`UPDATE users SET ad_wallet_balance = ${balanceAfter.toFixed(0)}, updated_at = NOW() WHERE id = ${userId}`
      );
    }
    return entry;
  };

  if (txClient) return run(txClient);
  const orm = await getDb();
  return orm.transaction(run);
}

export async function getAdWalletBalance(userId: string, txClient?: DbOrTx): Promise<number> {
  const client = txClient ?? (await getDb());
  const result = await client.execute<{ ad_wallet_balance: string }>(
    sql`SELECT ad_wallet_balance FROM users WHERE id = ${userId} AND deleted_at IS NULL LIMIT 1`
  );
  if (!result.rows[0]) throw new Error(`[adWallet] User not found: ${userId}`);
  return new Decimal(result.rows[0].ad_wallet_balance).toNumber();
}
