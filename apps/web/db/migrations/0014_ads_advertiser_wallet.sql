-- 0014_ads_advertiser_wallet.sql
--
-- Ads: prepaid Ad Wallet (separate from the main Credits wallet), advertiser
-- identity selection (personal account / business account / business page),
-- and a grace period so a page/account that stops being a valid advertiser
-- (e.g. business subscription lapses) keeps its already-approved ads running
-- for a short window instead of yanking them mid-flight.

-- ---------------------------------------------------------------------------
-- Ad Wallet — a distinct prepaid balance, funded either by direct purchase
-- (payment provider, same store_items catalogue as Credits) or by transfer
-- from the user's main Credits balance. Campaign funding draws from this
-- balance instead of coin_balance directly.
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_wallet_balance bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ad_wallet_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    reference_id text,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_wallet_ledger_user ON ad_wallet_ledger(user_id, created_at DESC);

-- Idempotency guard mirroring coin_ledger's uidx_coin_ledger_tx_type_ref.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_ad_wallet_ledger_tx_type_ref
    ON ad_wallet_ledger(user_id, transaction_type, reference_id)
    WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Advertiser identity on a campaign — which entity is shown to viewers as
-- the advertiser: the user's own personal profile, their business account,
-- or one of their business pages.
-- ---------------------------------------------------------------------------

ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS advertiser_type text NOT NULL DEFAULT 'business_account';
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_advertiser_type_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_advertiser_type_check
    CHECK (advertiser_type IN ('personal', 'business_account', 'business_page'));

ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS advertiser_user_id uuid REFERENCES users(id);

-- business_account_id must already be nullable (owner_type='admin' campaigns
-- carry no business account) — this is a defensive no-op if so.
ALTER TABLE ad_campaigns ALTER COLUMN business_account_id DROP NOT NULL;

-- Grace period: when the underlying business subscription/page lapses, an
-- already-approved, currently-serving campaign keeps running under its
-- original (now-stale) advertiser identity until this timestamp, or until
-- it naturally stops (budget exhausted / manually stopped) — whichever
-- comes first. NULL means no grace period is in effect.
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS advertiser_grace_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_advertiser_grace
    ON ad_campaigns(advertiser_grace_until) WHERE advertiser_grace_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_created_by ON ad_campaigns(created_by);

-- ---------------------------------------------------------------------------
-- Admin-configurable ad eligibility (x_manifest keys — see lib/ads/limits.ts)
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
    ('ad_allow_personal_accounts', 'false', 'Allow personal (non-business) accounts to place ads.'),
    ('ad_require_kyc', 'true', 'Require identity (KYC) verification to place ads.'),
    ('ad_allow_free_accounts', 'false', 'Allow free-plan accounts to place ads (subject to level gate below).'),
    ('ad_min_level_free_accounts', '5', 'Minimum account level for a free-plan account to place ads, when allowed.'),
    ('ad_enforce_min_level_paid_business', 'false', 'Also enforce a minimum level for paid-plan/business advertisers.'),
    ('ad_min_level_paid_business', '1', 'Minimum account level for paid-plan/business advertisers, when enforced.'),
    ('ad_advertiser_grace_days', '14', 'Days an ad keeps running under its original advertiser identity after the underlying business/page stops qualifying.'),
    ('ad_moderation_mode_text', 'manual', 'Moderation mode for text/native ad creatives: manual or ai.'),
    ('ad_moderation_mode_image', 'manual', 'Moderation mode for image ad creatives: manual or ai. Always uses an image-capable model.')
ON CONFLICT (key) DO NOTHING;
