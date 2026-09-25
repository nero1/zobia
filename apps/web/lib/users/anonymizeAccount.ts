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

import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // Soft delete: anonymise public-facing fields but KEEP identifiers (email,
    // google_id, etc.) so the user can reactivate within the 30-day grace
    // period by logging in again. PII identifiers are only wiped by the
    // scheduled purge job after pending_deletion_at.
    await tx
      .update(schema.users)
      .set({
        displayName: "Deleted User",
        bio: null,
        avatarEmoji: "👤",
        city: null,
        pushToken: null,
        pinHash: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));

    // Hard-delete payment PII — bank accounts and wallet addresses are PII
    // that cannot be retained; payout records preserve accounting data via snapshots.
    await tx.delete(schema.creatorBankAccounts).where(eq(schema.creatorBankAccounts.creatorId, userId));
    await tx.delete(schema.creatorWalletAddresses).where(eq(schema.creatorWalletAddresses.creatorId, userId));
    await tx
      .delete(schema.creatorKyc)
      .where(eq(schema.creatorKyc.creatorId, userId))
      .catch(() => {});

    // Hard-delete identity KYC PII (Tiers 1-3) — BVN digits, encrypted ID
    // numbers, full legal names, uploaded document storage keys. Collect
    // storage keys before deleting so we can purge the underlying objects
    // after the transaction commits.
    const docRows = await tx
      .select({ storageKey: schema.kycDocuments.storageKey })
      .from(schema.kycDocuments)
      .where(eq(schema.kycDocuments.userId, userId));
    kycStorageKeys = docRows.map((r) => r.storageKey);

    // Cascades to kyc_documents rows attached to a submission via
    // ON DELETE CASCADE; the second delete below catches any documents
    // uploaded but never attached to a submission.
    await tx.delete(schema.kycSubmissions).where(eq(schema.kycSubmissions.userId, userId));
    await tx.delete(schema.kycDocuments).where(eq(schema.kycDocuments.userId, userId));
  });

  if (kycStorageKeys.length > 0) {
    await storage.deleteMany(kycStorageKeys).catch(() => {});
  }

  // Invalidate all active sessions so the (now-deleted) user can't keep
  // refreshing tokens, and so an admin-triggered delete kicks the user out
  // immediately.
  await invalidateAllSessions(userId).catch(() => {});
}
