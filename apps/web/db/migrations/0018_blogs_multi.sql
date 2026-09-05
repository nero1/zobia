-- 0018_blogs_multi.sql
--
-- Multi-Blog quota system: blogs stop being strictly 1:1 with users.
--
--   - Personal account blogs: quota depends on the owner's creator/reputation
--     level (users.level_creator) AND plan.
--       * Free plan, at/above the admin-configured level threshold: 1 blog
--         included.
--       * Free plan, below the threshold: 0 included — every blog (including
--         the first) must be paid-unlocked.
--       * Paid plans (plus/pro/max) always qualify regardless of level, with
--         a higher included count per plan.
--       * Any blog beyond the included count costs a one-time unlock (Credits
--         or Stars, admin-configurable amount/currencies).
--   - Business account blogs: additive to personal blogs, tier-gated included
--     count (starter/growth/enterprise), same extra-slot unlock mechanic,
--     independently priced from the personal one. Subject to the business
--     account's existing self-service downgrade grace period — see
--     lib/business/downgradeSweep.ts, extended here to also deactivate excess
--     blogs the same way it already deactivates excess business_pages.
--
-- Modeled on 0003_business_expansion.sql's business_pages slot-limit pattern.

-- ---------------------------------------------------------------------------
-- blogs — drop the 1:1-with-owner constraint, add business-account
-- attribution and slot-acquisition bookkeeping.
-- ---------------------------------------------------------------------------

-- A blog no longer has to be unique per owner; owner_id stays NOT NULL + FK
-- (a business blog's owner_id is the business account's owner user, same
-- person who manages business_accounts/business_pages) but many blogs can
-- now share an owner_id.
ALTER TABLE blogs DROP CONSTRAINT IF EXISTS blogs_owner_id_key;

-- owner_id is still queried on every "my blog(s)" lookup — keep an index now
-- that it's no longer backed by a unique constraint's implicit index.
CREATE INDEX IF NOT EXISTS blogs_owner_id_idx ON blogs (owner_id) WHERE deleted_at IS NULL;

ALTER TABLE blogs
  -- NULL = personal blog (quota comes from the owner's plan/level). Set =
  -- business blog (quota comes from the business account's tier), additive
  -- to the owner's personal quota.
  ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
  -- How this blog's slot was acquired, so a slot already paid for is never
  -- re-charged (or silently lost) by later quota recalculations, e.g. after
  -- a plan/tier change or a replay of the create request.
  ADD COLUMN IF NOT EXISTS slot_source text DEFAULT 'included' NOT NULL,
  -- Currency used for a 'purchased' slot's one-time unlock. NULL for
  -- 'included' slots.
  ADD COLUMN IF NOT EXISTS slot_unlock_currency text,
  -- Amount actually charged for a 'purchased' slot's one-time unlock (in the
  -- unit of slot_unlock_currency). NULL for 'included' slots.
  ADD COLUMN IF NOT EXISTS slot_unlock_cost integer,
  -- The referenceId passed to checkAndDebit()/debitStars() for the unlock
  -- charge — kept for audit/support lookups tying a blog back to its ledger
  -- entry.
  ADD COLUMN IF NOT EXISTS slot_unlock_reference_id text;

ALTER TABLE blogs
  DROP CONSTRAINT IF EXISTS blogs_slot_source_check;
ALTER TABLE blogs
  ADD CONSTRAINT blogs_slot_source_check CHECK (slot_source = ANY (ARRAY['included'::text, 'purchased'::text]));

ALTER TABLE blogs
  DROP CONSTRAINT IF EXISTS blogs_slot_unlock_currency_check;
ALTER TABLE blogs
  ADD CONSTRAINT blogs_slot_unlock_currency_check CHECK (slot_unlock_currency IS NULL OR slot_unlock_currency = ANY (ARRAY['credits'::text, 'stars'::text]));

CREATE INDEX IF NOT EXISTS blogs_business_account_idx ON blogs (business_account_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- x_manifest defaults — admin-configurable multi-blog quota settings
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('blog_creator_level_threshold', '2', 'Creator/reputation level (users.level_creator) a Free-plan user must reach to get any blog included free; below this, every blog (including the first) must be unlocked with Credits/Stars'),
  ('blog_included_free', '1', 'Blogs included free for Free-plan personal accounts at/above blog_creator_level_threshold (0 below the threshold)'),
  ('blog_included_plus', '2', 'Blogs included free for Plus-plan personal accounts (no level gate)'),
  ('blog_included_pro', '5', 'Blogs included free for Pro-plan personal accounts (no level gate)'),
  ('blog_included_max', '10', 'Blogs included free for Max-plan personal accounts (no level gate)'),
  ('blog_extra_slot_cost_credits', '500', 'One-time Credits cost to unlock an additional personal-account blog slot beyond the plan''s included count'),
  ('blog_extra_slot_cost_stars', '3', 'One-time Stars cost to unlock an additional personal-account blog slot beyond the plan''s included count'),
  ('blog_extra_slot_currencies', 'credits,stars', 'Comma-separated list of currencies accepted for a personal-account extra blog slot unlock (credits, stars, or both)'),
  ('blog_business_included_starter', '5', 'Blogs included for a Business Starter-tier account (additive to the owner''s personal blog quota)'),
  ('blog_business_included_growth', '20', 'Blogs included for a Business Growth-tier account (additive to the owner''s personal blog quota)'),
  ('blog_business_included_enterprise', '50', 'Blogs included for a Business Enterprise-tier account (additive to the owner''s personal blog quota)'),
  ('blog_business_extra_slot_cost_credits', '500', 'One-time Credits cost to unlock an additional business-account blog slot beyond the tier''s included count'),
  ('blog_business_extra_slot_cost_stars', '3', 'One-time Stars cost to unlock an additional business-account blog slot beyond the tier''s included count'),
  ('blog_business_extra_slot_currencies', 'credits,stars', 'Comma-separated list of currencies accepted for a business-account extra blog slot unlock (credits, stars, or both)')
ON CONFLICT (key) DO NOTHING;
