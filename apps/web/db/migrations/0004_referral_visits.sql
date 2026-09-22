-- 0004_referral_visits.sql
--
-- Referral link click/visit tracking, plus the admin-configurable "stats
-- detail" gate (see x_manifest key `referral_stats_full_plans`, mirroring
-- `profile_stats_full_plans`).
--
-- A "visit" is recorded whenever anyone (member or anonymous visitor) loads
-- a page carrying a valid `?r=<code>` referral parameter — see
-- components/referral/ReferralCapture.tsx and lib/referrals/visits.ts. This
-- is separate from the `referrals` table, which only tracks completed
-- sign-ups/qualifications: a click does not require the visitor to sign up.
--
-- One row per (referrer, visitor, day): the unique index below caps a single
-- anonymous visitor at one counted visit per referrer per calendar day, so
-- repeated page loads/refreshes from the same browser don't inflate stats.
-- `visitor_key` is a random, non-PII identifier generated client-side
-- (localStorage on web/PWA, Preferences on the Capacitor app) — never an IP
-- address or fingerprint.

CREATE TABLE IF NOT EXISTS referral_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  path text NOT NULL,
  visitor_key text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  visited_date date NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_visits_dedup_idx
  ON referral_visits (referrer_id, visitor_key, visited_date);

CREATE INDEX IF NOT EXISTS referral_visits_referrer_idx
  ON referral_visits (referrer_id, visited_at DESC);

-- Admin-configurable gate for the referral stats "Full" view (daily visit
-- breakdown, top pages, conversion rate, per-referral list) — see
-- gate44/settings/referrals and lib/plans/eligibility.ts. Default mirrors
-- profile_stats_full_plans: every plan/tier except free.
INSERT INTO public.x_manifest (key, value, description, updated_at)
VALUES (
  'referral_stats_full_plans',
  '["plus","pro","max"]',
  'Plans/prestige tiers that get the Full referral stats view (visit breakdown, top pages, conversion rate, per-referral list); everyone else gets totals only',
  now()
)
ON CONFLICT DO NOTHING;
