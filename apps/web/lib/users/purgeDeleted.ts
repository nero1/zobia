import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
/** Accounting foreign keys survive; recovery identifiers expire after 30 days. */
export async function purgeDeletedAccounts() {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const batch = await tx.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE deleted_at<NOW()-INTERVAL '30 days' AND purged_at IS NULL ORDER BY deleted_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
    );
    for (const { id } of batch.rows) {
      await tx.execute(
        sql`UPDATE users SET username='gone_'||left(replace(id::text,'-',''),24),email=NULL,phone_number=NULL,phone_verified_at=NULL,google_id=NULL,telegram_id=NULL,password_hash=NULL,totp_secret=NULL,totp_enabled=false,pin_hash=NULL,admin_magic_word_hash=NULL,pre_auth_session=NULL,avatar_url=NULL,bio=NULL,city=NULL,country=NULL,date_of_birth=NULL,vibe_quiz_responses=NULL,onboarding_personalization=NULL,kyc_tier=0,is_verified=false,payout_recipient_code=NULL,payout_account_last4=NULL,contact_discovery_enabled=false,contact_discovery_consented_at=NULL,purged_at=NOW(),updated_at=NOW() WHERE id=${id}`,
      );
      await tx.execute(sql`DELETE FROM user_push_tokens WHERE user_id=${id}`);
      await tx.execute(
        sql`DELETE FROM data_export_requests WHERE user_id=${id}`,
      );
      await tx.execute(
        sql`DELETE FROM phone_verification_codes WHERE user_id=${id}`,
      );
      await tx.execute(
        sql`DELETE FROM username_change_history WHERE user_id=${id}`,
      );
      // Login/restore token helpers additionally reject purged accounts by their age.
    }
    return { purged: batch.rows.length };
  });
}
