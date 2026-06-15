/**
 * lib/audit/auditLog.ts
 *
 * Immutable audit log for sensitive operations. (BUG-30)
 * All writes are fire-and-forget — never block the main request path.
 */

import { db } from "@/lib/db";

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
  | "user_profile_read";

export interface AuditLogParams {
  actorId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write an audit log entry. Fire-and-forget — errors are logged but never thrown.
 */
export function writeAuditLog(params: AuditLogParams): void {
  db.query(
    `INSERT INTO audit_log
       (actor_id, action, target_type, target_id, metadata, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())`,
    [
      params.actorId ?? null,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ]
  ).catch((err) => {
    console.error("[audit] Failed to write audit log:", err);
  });
}
