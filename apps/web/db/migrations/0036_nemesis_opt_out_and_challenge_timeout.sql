-- 0036_nemesis_opt_out_and_challenge_timeout.sql
--
-- Nemesis System additions:
--   1. `users.nemesis_opt_out` — lets an eligible user turn the Nemesis
--      system off from Profile Settings. Respected by lib/nemesis/nemesisEngine.ts
--      (assignNemesis, refreshNemesisAssignments) both as "don't assign me
--      one" and "don't assign ME as anyone else's rival".
--   2. `nemesis_challenge_accept_days` x_manifest key — admin-editable number
--      of days a challenged user has to accept an XP-sprint challenge before
--      the challenger is given a new nemesis (see
--      expireUnacceptedNemesisChallenges in lib/nemesis/nemesisEngine.ts).
--      Default 3, per product spec.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nemesis_opt_out boolean NOT NULL DEFAULT false;

-- Without this row, the setting exists only as a code default (see
-- DEFAULT_CHALLENGE_ACCEPT_DAYS in nemesisEngine.ts) and never appears as an
-- editable field at /gate44/config (which only lists rows that already exist
-- in this table). ON CONFLICT DO NOTHING so re-running this migration, or an
-- admin who already changed the value, is a no-op.
INSERT INTO x_manifest (key, value, description) VALUES
  ('nemesis_challenge_accept_days', '3', 'Days a challenged user has to accept a Nemesis XP-sprint challenge before the challenger is assigned a new Nemesis.')
ON CONFLICT (key) DO NOTHING;
