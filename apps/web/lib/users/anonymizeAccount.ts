/**
 * lib/users/anonymizeAccount.ts
 *
 * Shared account soft-delete/anonymization helper.
 *
 * Extracted from the original inline logic in
 * app/api/users/me/route.ts (DELETE) so both the self-service delete route
 * and the admin-triggered delete endpoint
 * (app/api/admin/data-management/users/[id]/route.ts DELETE) share one
 * implementation.
 *
 * Per PRD §23: "User deletion anonymises records rather than hard-deleting
 * to preserve referential integrity."
 *
 * Anonymisation:
 *   - display_name → "Deleted User"
 *   - bio, avatar_emoji, city → cleared / reset
 *   - push_token, pin_hash → NULL
 *   - deleted_at → NOW()
 *
 * PII hard-deleted in the same transaction:
 *   - creator_bank_accounts, creator_wallet_addresses, creator_kyc (payment PII)
 *   - kyc_submissions, kyc_documents (identity KYC PII) — storage objects for
 *     any kyc_documents.storage_key are purged from object storage AFTER the
 *     transaction commits.
 *
 * All active sessions for the user are invalidated after the transaction
 * commits, regardless of who triggered the deletion.
 */

import { db } from "@/lib/db";
import { invalidateAllSessions } from "@/lib/auth/session";
import { storage } from "@/lib/storage";

export interface AnonymizeAccountOptions {
  /** Optional free-text reason, recorded by the caller's own audit log entry — not stored on the user row. */
  reason?: string;
}

/**
 * Soft-delete and anonymize a user account. Idempotent: re-running against an
 * already-deleted account is a harmless no-op (the UPDATE's WHERE clause
 * only matches rows with deleted_at IS NULL).
 */
export async function anonymizeUserAccount(
  userId: string,
  _opts: AnonymizeAccountOptions = {}
): Promise<void> {
  let kycStorageKeys: string[] = [];

  await db.transaction(async (tx) => {
    // Soft delete: anonymise public-facing fields but KEEP identifiers (email,
    // google_id, etc.) so the user can reactivate within the 30-day grace
    // period by logging in again. PII identifiers are only wiped by the
    // scheduled purge job after pending_deletion_at.
    await tx.query(
      `UPDATE users
       SET display_name    = 'Deleted User',
           bio             = NULL,
           avatar_emoji    = '👤',
           city            = NULL,
           push_token      = NULL,
           pin_hash        = NULL,
           deleted_at      = NOW(),
           updated_at      = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    // Hard-delete payment PII — bank accounts and wallet addresses are PII
    // that cannot be retained; payout records preserve accounting data via snapshots.
    await tx.query(`DELETE FROM creator_bank_accounts WHERE creator_id = $1`, [userId]);
    await tx.query(`DELETE FROM creator_wallet_addresses WHERE creator_id = $1`, [userId]);
    await tx.query(`DELETE FROM creator_kyc WHERE creator_id = $1`, [userId]).catch(() => {});

    // Hard-delete identity KYC PII (Tiers 1-3) — BVN digits, encrypted ID
    // numbers, full legal names, uploaded document storage keys. Collect
    // storage keys before deleting so we can purge the underlying objects
    // after the transaction commits.
    const { rows: docRows } = await tx.query<{ storage_key: string }>(
      `SELECT storage_key FROM kyc_documents WHERE user_id = $1`,
      [userId]
    );
    kycStorageKeys = docRows.map((r) => r.storage_key);

    // Cascades to kyc_documents rows attached to a submission via
    // ON DELETE CASCADE; the second delete below catches any documents
    // uploaded but never attached to a submission.
    await tx.query(`DELETE FROM kyc_submissions WHERE user_id = $1`, [userId]);
    await tx.query(`DELETE FROM kyc_documents WHERE user_id = $1`, [userId]);
  });

  if (kycStorageKeys.length > 0) {
    await storage.deleteMany(kycStorageKeys).catch(() => {});
  }

  // Invalidate all active sessions so the (now-deleted) user can't keep
  // refreshing tokens, and so an admin-triggered delete kicks the user out
  // immediately.
  await invalidateAllSessions(userId).catch(() => {});
}
