/**
 * lib/audit/auditLog.ts
 *
 * Immutable audit log for sensitive operations. (BUG-30)
 * Required evidence is persisted before the request completes.
 */

import { getDb, schema } from "@/lib/db/drizzle";

export type AuditAction =
  | "login_success"
  | "login_failure"
  | "logout"
  | "admin_ban_user"
  | "admin_unban_user"
  | "admin_suspend_user"
  | "admin_unsuspend_user"
  | "kyc_viewed"
  | "kyc_updated"
  | "payout_approved"
  | "payout_rejected"
  | "pin_changed"
  | "pin_verify_failed"
  | "user_suspended"
  | "user_unsuspended"
  | "2fa_enabled"
  | "2fa_disabled"
  | "session_rotated"
  | "account_reactivated"
  // Read-path admin access auditing (BUG-45)
  | "financial_read"
  | "user_profile_read"
  // Admin guild management (/gate44/guilds)
  | "admin_suspend_guild"
  | "admin_unsuspend_guild"
  | "admin_ban_guild"
  | "admin_disable_guild"
  | "admin_enable_guild"
  | "admin_delete_guild"
  | "admin_transfer_guild_captain"
  | "admin_remove_guild_member"
  // Centralized Data Management (/gate44/data-management)
  | "data_management_stats_read"
  | "admin_export_users"
  | "admin_export_accounts"
  | "admin_import_users_job_created"
  | "admin_import_users_job_batch"
  | "admin_import_users_job_completed"
  | "admin_create_user"
  | "admin_edit_user"
  | "admin_delete_user"
  // Crypto payments
  | "user_crypto_wallet_saved"
  | "user_crypto_wallet_deleted"
  | "admin_payment_context_updated"
  | "admin_crypto_rate_override_set"
  | "admin_all_payments_made_free"
  | "crypto_withdrawal_requested"
  // Hashtags + Portals (/gate44/portals)
  | "admin_portal_upsert"
  | "admin_portal_update"
  | "admin_portal_delete"
  | "admin_hashtag_merge"
  | "admin_hashtag_block"
  | "admin_hashtag_unblock";

export interface AuditLogParams {
  actorId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/** Await before responding; callers can include a transaction for atomic evidence. */
export async function writeAuditLog(params:AuditLogParams,client?:import('@/lib/db/drizzle').DbOrTx):Promise<void>{
  const db=client??await getDb();
  await db.insert(schema.auditLog).values({actorId:params.actorId??null,action:params.action,targetType:params.targetType??null,targetId:params.targetId??null,metadata:params.metadata??null,ipAddress:params.ipAddress??null,userAgent:params.userAgent??null});
}
