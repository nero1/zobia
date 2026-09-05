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
 *    to coin_balance (see lib/payments/dodoWebhookHandler.ts / paystackWebhookHandler.ts).
 *
 * Campaign funding (lib/ads/repo.ts fundCampaign) debits from here, not from
 * coin_balance — ads only run once this balance actually has funds in it.
 *
 * @module lib/economy/adWallet
 */

import Decimal from "decimal.js";
import type { TransactionClient } from "@/lib/db/interface";
import { db } from "@/lib/db";

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

async function lockAndGetBalance(userId: string, tx: TransactionClient): Promise<Decimal> {
  const { rows } = await tx.query<{ ad_wallet_balance: string }>(
    `SELECT ad_wallet_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [userId]
  );
  if (!rows[0]) throw new Error(`[adWallet] User not found: ${userId}`);
  return new Decimal(rows[0].ad_wallet_balance);
}

async function findExistingLedgerEntry(
  tx: TransactionClient,
  userId: string,
  type: AdWalletTransactionType,
  referenceId: string | null
): Promise<AdWalletLedgerEntry | null> {
  if (!referenceId) return null;
  const { rows } = await tx.query<AdWalletLedgerEntry>(
    `SELECT * FROM ad_wallet_ledger WHERE user_id = $1 AND transaction_type = $2 AND reference_id = $3 LIMIT 1`,
    [userId, type, referenceId]
  );
  return rows[0] ?? null;
}

async function writeLedgerEntry(
  tx: TransactionClient,
  userId: string,
  amount: Decimal,
  balanceBefore: Decimal,
  balanceAfter: Decimal,
  type: AdWalletTransactionType,
  referenceId: string | null,
  description: string | null,
  metadata: Record<string, unknown> | null
): Promise<{ entry: AdWalletLedgerEntry; inserted: boolean }> {
  const { rows } = await tx.query<AdWalletLedgerEntry>(
    `INSERT INTO ad_wallet_ledger
       (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  if (rows[0]) return { entry: rows[0], inserted: true };

  const { rows: existing } = await tx.query<AdWalletLedgerEntry>(
    `SELECT * FROM ad_wallet_ledger WHERE user_id = $1 AND transaction_type = $2 AND reference_id = $3 LIMIT 1`,
    [userId, type, referenceId]
  );
  return { entry: existing[0], inserted: false };
}

export async function creditAdWallet(
  userId: string,
  amount: number,
  type: AdWalletTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: TransactionClient
): Promise<AdWalletLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[adWallet] creditAdWallet: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<AdWalletLedgerEntry> => {
    const dup = await findExistingLedgerEntry(tx, userId, type, referenceId);
    if (dup) return dup;

    const balanceBefore = await lockAndGetBalance(userId, tx);
    const balanceAfter = balanceBefore.plus(dec);

    const { entry, inserted } = await writeLedgerEntry(tx, userId, dec, balanceBefore, balanceAfter, type, referenceId, description, metadata);

    if (inserted) {
      await tx.query(`UPDATE users SET ad_wallet_balance = $1, updated_at = NOW() WHERE id = $2`, [balanceAfter.toFixed(0), userId]);
    }
    return entry;
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

export async function debitAdWallet(
  userId: string,
  amount: number,
  type: AdWalletTransactionType,
  referenceId: string | null = null,
  description: string | null = null,
  metadata: Record<string, unknown> | null = null,
  txClient?: TransactionClient
): Promise<AdWalletLedgerEntry> {
  const dec = new Decimal(amount);
  if (!dec.isInteger() || dec.lte(0)) {
    throw new Error(`[adWallet] debitAdWallet: amount must be a positive integer, got ${amount}`);
  }

  const run = async (tx: TransactionClient): Promise<AdWalletLedgerEntry> => {
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
      await tx.query(`UPDATE users SET ad_wallet_balance = $1, updated_at = NOW() WHERE id = $2`, [balanceAfter.toFixed(0), userId]);
    }
    return entry;
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

export async function getAdWalletBalance(userId: string, txClient?: TransactionClient): Promise<number> {
  const query = txClient ?? db;
  const { rows } = await query.query<{ ad_wallet_balance: string }>(
    `SELECT ad_wallet_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw new Error(`[adWallet] User not found: ${userId}`);
  return new Decimal(rows[0].ad_wallet_balance).toNumber();
}
