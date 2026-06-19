-- =====================================================================
-- 0015_xp_bigint_and_schema_constraints.sql
--
-- 1. Promote all accumulating XP / legacy-score columns from int4
--    (integer, max ~2.1 billion) to int8 (bigint, max ~9.2 quintillion)
--    so the platform can run for 100+ years without overflow.
--
-- 2. Add CHECK constraints capping financial bigint columns at
--    1 trillion (1_000_000_000_000) — well below JS Number.MAX_SAFE_INTEGER
--    (~9 quadrillion) to prevent silent precision loss when values are read
--    as JavaScript Number via Drizzle mode:"number".
--
-- 3. Add CHECK constraint enforcing that public rooms must have a slug.
--
-- All ALTER TYPE statements are idempotent via the pg_catalog guard.
-- All ADD CONSTRAINT statements use IF NOT EXISTS equivalents.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- SECTION 1: XP columns  integer → bigint
-- ─────────────────────────────────────────────────────────────────────

-- users table — 8 XP tracks + total + season + legacy
ALTER TABLE users
  ALTER COLUMN xp_total        TYPE bigint,
  ALTER COLUMN xp_social       TYPE bigint,
  ALTER COLUMN xp_creator      TYPE bigint,
  ALTER COLUMN xp_competitor   TYPE bigint,
  ALTER COLUMN xp_generosity   TYPE bigint,
  ALTER COLUMN xp_knowledge    TYPE bigint,
  ALTER COLUMN xp_explorer     TYPE bigint,
  ALTER COLUMN xp_gaming       TYPE bigint,
  ALTER COLUMN season_xp       TYPE bigint,
  ALTER COLUMN legacy_score    TYPE bigint;

-- user_season_passes — accumulates XP across a season
ALTER TABLE user_season_passes
  ALTER COLUMN season_xp TYPE bigint;

-- season_rank_archives — snapshot of final season XP
ALTER TABLE season_rank_archives
  ALTER COLUMN final_season_xp TYPE bigint;

-- platform_council_members — snapshot of legacy score at election time
ALTER TABLE platform_council_members
  ALTER COLUMN legacy_score TYPE bigint;

-- ─────────────────────────────────────────────────────────────────────
-- SECTION 2: Financial bigint caps at 1 trillion
-- ─────────────────────────────────────────────────────────────────────

-- users: wallet balances
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_coin_balance_max,
  ADD  CONSTRAINT users_coin_balance_max CHECK (coin_balance <= 1000000000000),
  DROP CONSTRAINT IF EXISTS users_star_balance_max,
  ADD  CONSTRAINT users_star_balance_max CHECK (star_balance <= 1000000000000);

-- guilds: treasury
ALTER TABLE guilds
  DROP CONSTRAINT IF EXISTS guilds_treasury_balance_max,
  ADD  CONSTRAINT guilds_treasury_balance_max CHECK (treasury_balance <= 1000000000000),
  DROP CONSTRAINT IF EXISTS guilds_treasury_cap_max,
  ADD  CONSTRAINT guilds_treasury_cap_max CHECK (treasury_cap <= 1000000000000);

-- rooms: subscription / entry / enrolment pricing
ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_subscription_price_kobo_max,
  ADD  CONSTRAINT rooms_subscription_price_kobo_max
       CHECK (subscription_price_kobo IS NULL OR subscription_price_kobo <= 1000000000000),
  DROP CONSTRAINT IF EXISTS rooms_entry_fee_kobo_max,
  ADD  CONSTRAINT rooms_entry_fee_kobo_max
       CHECK (entry_fee_kobo IS NULL OR entry_fee_kobo <= 1000000000000),
  DROP CONSTRAINT IF EXISTS rooms_subscription_price_ngn_max,
  ADD  CONSTRAINT rooms_subscription_price_ngn_max
       CHECK (subscription_price_ngn IS NULL OR subscription_price_ngn <= 1000000000000),
  DROP CONSTRAINT IF EXISTS rooms_entry_fee_ngn_max,
  ADD  CONSTRAINT rooms_entry_fee_ngn_max
       CHECK (entry_fee_ngn IS NULL OR entry_fee_ngn <= 1000000000000),
  DROP CONSTRAINT IF EXISTS rooms_enrolment_fee_ngn_max,
  ADD  CONSTRAINT rooms_enrolment_fee_ngn_max
       CHECK (enrolment_fee_ngn IS NULL OR enrolment_fee_ngn <= 1000000000000);

-- ─────────────────────────────────────────────────────────────────────
-- SECTION 3: rooms — public rooms must have a slug (BUG-SCHEMA-03)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_public_requires_slug,
  ADD  CONSTRAINT rooms_public_requires_slug
       CHECK (NOT (is_public = TRUE AND slug IS NULL));
