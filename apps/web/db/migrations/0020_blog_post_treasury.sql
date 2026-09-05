-- 0020_blog_post_treasury.sql
--
-- Per-post credit reward pot: a blog owner can fund a treasury for one of
-- their posts; the first N people who comment on it or share it earn an
-- equal split of the pot (Credits only per product spec). Also adds minimal
-- share tracking (blog_posts had no share signal at all before this), since
-- the treasury's "share" claim type depends on detecting a share event.

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS share_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS blog_post_shares (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_post_shares_post_user_idx ON blog_post_shares (post_id, user_id);

CREATE TABLE IF NOT EXISTS blog_post_treasuries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Total Credits funded into the pot (lifetime — a re-fund adds to this).
  funded_amount integer NOT NULL DEFAULT 0,
  -- Credits not yet claimed.
  remaining_amount integer NOT NULL DEFAULT 0,
  -- Max number of distinct claimants (comment or share, first-come). The
  -- per-claim reward is funded_amount / max_claimants, computed at claim
  -- time from the *current* funded_amount so a top-up mid-flight raises the
  -- per-claim reward for remaining slots rather than requiring a reset.
  max_claimants integer NOT NULL,
  claimant_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_post_treasuries_post_idx ON blog_post_treasuries (post_id);
ALTER TABLE blog_post_treasuries
  DROP CONSTRAINT IF EXISTS blog_post_treasuries_status_check;
ALTER TABLE blog_post_treasuries
  ADD CONSTRAINT blog_post_treasuries_status_check CHECK (status = ANY (ARRAY['active'::text, 'exhausted'::text, 'closed'::text]));

CREATE TABLE IF NOT EXISTS blog_post_treasury_claims (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  treasury_id uuid NOT NULL REFERENCES blog_post_treasuries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_type text NOT NULL,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_post_treasury_claims_treasury_user_idx ON blog_post_treasury_claims (treasury_id, user_id);
ALTER TABLE blog_post_treasury_claims
  DROP CONSTRAINT IF EXISTS blog_post_treasury_claims_type_check;
ALTER TABLE blog_post_treasury_claims
  ADD CONSTRAINT blog_post_treasury_claims_type_check CHECK (claim_type = ANY (ARRAY['comment'::text, 'share'::text]));
