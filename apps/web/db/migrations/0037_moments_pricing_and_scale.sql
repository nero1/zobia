-- 0037_moments_pricing_and_scale.sql
--
-- Zobia Moments: admin-configurable pricing/eligibility + feed scalability.
--
-- All keys are admin-editable via /admin/config; the manifest loader
-- (lib/manifest/index.ts) falls back to the same defaults when a row is
-- absent, so this seed is purely to surface the keys in the admin UI.
--
-- Idempotent: ON CONFLICT (key) DO NOTHING so re-running is safe and existing
-- admin overrides are never clobbered.

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_moments',      'true', 'Master toggle for the Zobia Moments feature'),
  ('moments_cost_credits', '100',  'Credits charged to post a Moment (0 = not payable with Credits)'),
  ('moments_cost_stars',   '1',    'Stars charged to post a Moment (0 = not payable with Stars)'),
  ('moments_min_level',    '2',    'Minimum account level (main rank number) required to post a Moment')
ON CONFLICT (key) DO NOTHING;

-- Composite index for the feed's hot query: WHERE expires_at > NOW() ORDER BY created_at DESC.
-- At thousands of moments/day the existing single-column indexes force a full
-- index scan + sort; this lets Postgres range-scan on expires_at and return
-- rows already close to created_at order.
CREATE INDEX IF NOT EXISTS idx_moments_active_feed ON moments (expires_at, created_at DESC);
