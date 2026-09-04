-- 0011_admin_lockout_magic_word.sql
--
-- Anti-brute-force defense for the staff (/gate44) login: after 3 failed
-- attempts the account is locked (enforced via Redis, see
-- app/api/admin/auth/login/route.ts) and can only be unlocked with a
-- "Secret Magic Word" the admin sets in advance while logged in
-- (app/(admin)/gate44/settings/security/page.tsx). Stored hashed, same as
-- password_hash — never stored or logged in plaintext.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_magic_word_hash TEXT;
