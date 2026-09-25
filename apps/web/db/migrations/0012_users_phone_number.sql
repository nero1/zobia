-- Migration 0012: users.phone_number
--
-- BUG FIX (found during the Drizzle ORM migration): app/api/users/contacts/
-- cross-reference/route.ts has always queried `users.phone_number`, but that
-- column has never existed anywhere in the schema (only the unrelated
-- staff_alert_contacts.phone_number, used for SMS alert routing). Every call
-- to this endpoint has always thrown "column phone_number does not exist".
--
-- This migration adds the column so the query no longer errors. Note: there
-- is currently no UI/API for a user to actually set their own phone number
-- (most users authenticate via Google/Telegram, which don't provide one) —
-- so until a phone-capture/verification flow is added elsewhere, this
-- endpoint will legitimately return an empty match list for everyone. That
-- capture flow is a separate feature, not part of this fix.
--
-- users already has anon/authenticated/service_role grants from its
-- creation in 0001_consolidated_schema.sql, so no GRANT statements are
-- needed here (only brand-new tables require them).

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number text;

-- Supports the cross-reference endpoint's `phone_number = ANY($1::text[])`
-- lookup. Partial (excludes NULL) since most users will never set one.
CREATE INDEX IF NOT EXISTS idx_users_phone_number
  ON users (phone_number)
  WHERE phone_number IS NOT NULL;

COMMIT;
