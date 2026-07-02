-- ---------------------------------------------------------------------------
-- Platform Advertising system (PRD §17, Pillar 3) — professional-grade ad
-- control panel for business advertisers, admin-authored ads, and boosted
-- posts/rooms. Reuses existing infrastructure rather than a parallel system:
--   - Billing rides the existing `coin_ledger` (lib/economy/coins.ts) —
--     campaigns are funded by debiting the business owner's Credit balance
--     (topped up via the existing Paystack/DodoPayments/Play-Billing coin
--     purchase flow) and CPM-billed per impression from that budget.
--   - Moderation reuses the Sponsored-Quest AI/manual review pattern
--     (lib/moderation/aiClassifier.ts + x_manifest moderation-mode toggle,
--     admin approve/reject queue + admin_audit_log).
--   - Eligibility gate: business_accounts.verified = true AND the owning
--     user's kyc_tier >= ad_min_kyc_tier_to_advertise (x_manifest, default 1).
--   - A "boost" (blog post / room promotion) is simply a campaign with
--     objective = 'boost_post' | 'boost_room' and boosted_content_id set —
--     no separate boost table.
--
-- Adds:
--   - ad_placements              — admin-managed slot catalogue (size, base CPM)
--   - ad_campaigns                — advertiser campaigns (business- or admin-owned)
--   - ad_creatives                — creative assets per campaign, per placement
--   - ad_events                   — append-only impression/click log + cost
--   - ad_campaign_daily_stats     — per-day rollup (Enterprise-tier CSV export)
--   - ad_coupons / ad_coupon_redemptions — free/discounted ad budget codes
--   - x_manifest keys             — CPM defaults, moderation mode, AdMob unit IDs,
--                                    per-plan ad exposure level, rewarded-ad config
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ad_placements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    size text NOT NULL,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    base_cpm_credits numeric(12,2) NOT NULL DEFAULT 500,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ad_placements_size_check CHECK (size = ANY (ARRAY['300x250'::text, '320x50'::text, 'interstitial'::text, 'rewarded'::text, 'native'::text]))
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type text NOT NULL DEFAULT 'business',
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
    business_page_id uuid REFERENCES business_pages(id) ON DELETE SET NULL,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    objective text NOT NULL DEFAULT 'traffic',
    status text NOT NULL DEFAULT 'draft',
    moderation_status text NOT NULL DEFAULT 'pending',
    moderation_mode text,
    moderation_reason text,
    ai_confidence numeric(4,3),
    moderated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    moderated_at timestamp with time zone,
    cpm_credits numeric(12,2) NOT NULL DEFAULT 500,
    daily_budget_credits numeric(14,2),
    total_budget_credits numeric(14,2) NOT NULL DEFAULT 0,
    spent_credits numeric(14,2) NOT NULL DEFAULT 0,
    target_plans text[],
    target_countries text[],
    frequency_cap_per_user_per_day integer NOT NULL DEFAULT 20,
    boosted_content_type text,
    boosted_content_id uuid,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    deleted_at timestamp with time zone,
    CONSTRAINT ad_campaigns_owner_type_check CHECK (owner_type = ANY (ARRAY['business'::text, 'admin'::text])),
    CONSTRAINT ad_campaigns_objective_check CHECK (objective = ANY (ARRAY['awareness'::text, 'traffic'::text, 'boost_post'::text, 'boost_room'::text])),
    CONSTRAINT ad_campaigns_status_check CHECK (status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text, 'active'::text, 'paused'::text, 'completed'::text, 'stopped'::text])),
    CONSTRAINT ad_campaigns_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
    CONSTRAINT ad_campaigns_boosted_content_type_check CHECK (boosted_content_type IS NULL OR boosted_content_type = ANY (ARRAY['blog_post'::text, 'room'::text])),
    CONSTRAINT ad_campaigns_business_owner_check CHECK (owner_type = 'admin' OR business_account_id IS NOT NULL),
    CONSTRAINT ad_campaigns_budget_check CHECK (total_budget_credits >= 0 AND spent_credits >= 0)
);

CREATE INDEX IF NOT EXISTS ad_campaigns_business_idx ON ad_campaigns (business_account_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ad_campaigns_moderation_idx ON ad_campaigns (moderation_status, created_at ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON ad_campaigns (status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ad_creatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    placement_key text NOT NULL REFERENCES ad_placements(key) ON DELETE RESTRICT,
    format text NOT NULL DEFAULT 'text',
    size text NOT NULL,
    title text,
    body text,
    image_url text,
    click_url text,
    third_party_tag text,
    cta_label text,
    is_active boolean NOT NULL DEFAULT true,
    impressions_count bigint NOT NULL DEFAULT 0,
    clicks_count bigint NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ad_creatives_format_check CHECK (format = ANY (ARRAY['html'::text, 'text'::text, 'image'::text, 'native'::text, 'third_party'::text])),
    CONSTRAINT ad_creatives_size_check CHECK (size = ANY (ARRAY['300x250'::text, '320x50'::text, 'interstitial'::text, 'rewarded'::text, 'native'::text]))
);

CREATE INDEX IF NOT EXISTS ad_creatives_campaign_idx ON ad_creatives (campaign_id);
CREATE INDEX IF NOT EXISTS ad_creatives_placement_idx ON ad_creatives (placement_key, is_active);

CREATE TABLE IF NOT EXISTS ad_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id uuid NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    placement_key text NOT NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    cost_credits numeric(12,4) NOT NULL DEFAULT 0,
    client_event_id text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ad_events_type_check CHECK (event_type = ANY (ARRAY['impression'::text, 'click'::text]))
);

CREATE INDEX IF NOT EXISTS ad_events_campaign_idx ON ad_events (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_events_creative_idx ON ad_events (creative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_events_user_idx ON ad_events (user_id, campaign_id, created_at DESC) WHERE user_id IS NOT NULL;
-- Idempotency: a client-generated per-impression/click id (localStorage-tracked) lets a
-- retried "beacon" flush be deduped server-side without an extra Redis round trip,
-- same idiom as coin_ledger's (user_id, transaction_type, reference_id) partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS ad_events_client_dedupe_idx ON ad_events (creative_id, event_type, client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ad_campaign_daily_stats (
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    date date NOT NULL,
    impressions integer NOT NULL DEFAULT 0,
    clicks integer NOT NULL DEFAULT 0,
    spend_credits numeric(14,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, date)
);

CREATE TABLE IF NOT EXISTS ad_coupons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    discount_type text NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    max_redemptions integer,
    redemptions_count integer NOT NULL DEFAULT 0,
    min_budget_credits numeric(12,2) NOT NULL DEFAULT 0,
    expires_at timestamp with time zone,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ad_coupons_discount_type_check CHECK (discount_type = ANY (ARRAY['percent'::text, 'flat_credits'::text, 'free_credits'::text])),
    CONSTRAINT ad_coupons_discount_value_check CHECK (discount_value > 0)
);

CREATE TABLE IF NOT EXISTS ad_coupon_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id uuid NOT NULL REFERENCES ad_coupons(id) ON DELETE CASCADE,
    campaign_id uuid NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits_applied numeric(12,2) NOT NULL DEFAULT 0,
    redeemed_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ad_coupon_redemptions_unique UNIQUE (coupon_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS ad_coupon_redemptions_user_idx ON ad_coupon_redemptions (user_id);

-- x_manifest — ad system config (typed accessors added to lib/manifest/index.ts)
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_ads_system', 'true', 'Master toggle for the platform ad control panel (self-service + admin)'),
  ('feature_native_ads', 'true', 'Show in-house/user/native ads in ad slots'),
  ('feature_instream_ads', 'true', 'Interleave native ads inside free-tier Room message streams'),
  ('feature_boosted_posts', 'true', 'Allow Business Pages to boost Blog posts and Rooms'),
  ('feature_ad_coupons', 'true', 'Enable the ad-budget coupon/promo-code system'),
  ('ad_moderation_mode', 'manual', 'Ad campaign moderation: manual (admin queue) or ai (DeepSeek/Gemini auto-review)'),
  ('ad_ai_auto_approve_threshold', '0.85', 'Minimum AI approvalConfidence (0-1) to auto-approve a submitted ad campaign'),
  ('ad_min_kyc_tier_to_advertise', '1', 'Minimum users.kyc_tier the business account owner must hold to submit ad campaigns'),
  ('ad_default_cpm_credits', '500', 'Default Credits charged per 1000 impressions when a placement has no custom CPM'),
  ('ad_room_instream_interval', '10', 'Show one in-stream ad after this many messages in free Rooms'),
  ('ad_rewarded_daily_cap', '5', 'Max rewarded-ad claims per user per day'),
  ('ad_rewarded_credits_min', '10', 'Minimum Credits awarded per rewarded ad'),
  ('ad_rewarded_credits_max', '20', 'Maximum Credits awarded per rewarded ad'),
  ('ad_plan_free_ads_level', 'full', 'Ad exposure level for Free plan: full | reduced | none'),
  ('ad_plan_plus_ads_level', 'reduced', 'Ad exposure level for Plus plan: full | reduced | none'),
  ('ad_plan_pro_ads_level', 'none', 'Ad exposure level for Pro plan: full | reduced | none'),
  ('ad_plan_max_ads_level', 'none', 'Ad exposure level for Max plan: full | reduced | none'),
  ('ad_admob_app_id', '', 'AdMob App ID (Capacitor Android)'),
  ('ad_admob_banner_unit_id', '', 'AdMob banner ad unit ID (Capacitor Android)'),
  ('ad_admob_interstitial_unit_id', '', 'AdMob interstitial ad unit ID (Capacitor Android)'),
  ('ad_admob_rewarded_unit_id', '', 'AdMob rewarded video ad unit ID (Capacitor Android)'),
  ('ad_admob_test_mode', 'true', 'Serve AdMob test ads instead of live inventory (Capacitor Android)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ad_placements (key, label, size, description, base_cpm_credits, sort_order) VALUES
  ('room_instream', 'Room in-stream', 'native', 'Interleaved every N messages in free Room chat streams', 400, 10),
  ('feed_banner', 'Feed banner', '300x250', 'Home/Moments feed banner', 500, 20),
  ('messages_banner', 'Messages banner', '320x50', 'Messages/DM list banner', 350, 30),
  ('games_banner', 'Games banner', '300x250', 'Games directory banner', 450, 40),
  ('blog_inline', 'Blog inline native', 'native', 'Inline native ad inside Blog article body', 450, 50),
  ('business_page_native', 'Business Page native', 'native', 'Native ad on Business Page feeds', 400, 60),
  ('interstitial_global', 'Interstitial', 'interstitial', 'Full-screen interstitial shown between screens', 1500, 70),
  ('rewarded_global', 'Rewarded video', 'rewarded', 'Opt-in rewarded video, pays the viewer in Credits', 1200, 80)
ON CONFLICT (key) DO NOTHING;
