-- ---------------------------------------------------------------------------
-- Identity KYC (Tiers 1-3) — general identity/business verification, distinct
-- from the pre-existing creator_kyc table (which is scoped to bank-payout
-- BVN checks only). Adds:
--   - users.kyc_tier                — highest APPROVED tier (0-3)
--   - kyc_submissions                — one row per submission attempt (history)
--   - kyc_documents                  — uploaded docs (private object storage keys)
--   - x_manifest keys                — admin-configurable cost, review mode, thresholds
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_tier integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS kyc_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier integer NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    account_type text NOT NULL DEFAULT 'individual',
    citizenship_country text,

    review_mode text NOT NULL DEFAULT 'manual',

    bvn_last4 text,
    paystack_customer_code text,
    paystack_verification_status text,
    bvn_matched_name_encrypted text,

    id_type text,
    id_number_encrypted text,
    submitted_full_name text,

    ai_name_match_score numeric(4,3),
    ai_document_confidence numeric(4,3),
    ai_provider text,
    ai_notes text,
    ai_escalated boolean NOT NULL DEFAULT false,

    video_url text,
    liveness_status text,
    liveness_score numeric(4,3),
    liveness_notes text,

    reuse_previous_address boolean,
    updated_address jsonb,
    physical_verification_scheduled_at timestamp with time zone,
    physical_verification_notes text,

    credits_charged integer NOT NULL DEFAULT 0,
    credit_ledger_reference_id text,

    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamp with time zone,
    rejection_reason text,

    submitted_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT kyc_submissions_tier_check CHECK (tier IN (1, 2, 3)),
    CONSTRAINT kyc_submissions_account_type_check CHECK (account_type IN ('individual', 'business')),
    CONSTRAINT kyc_submissions_status_check CHECK (status IN ('pending', 'ai_review', 'manual_review', 'approved', 'rejected', 'cancelled')),
    CONSTRAINT kyc_submissions_review_mode_check CHECK (review_mode IN ('ai', 'manual'))
);

CREATE INDEX IF NOT EXISTS kyc_submissions_user_idx ON kyc_submissions (user_id, tier);
CREATE INDEX IF NOT EXISTS kyc_submissions_status_idx ON kyc_submissions (status) WHERE status IN ('pending', 'ai_review', 'manual_review');
CREATE INDEX IF NOT EXISTS kyc_submissions_submitted_idx ON kyc_submissions (submitted_at DESC);

-- Only one in-flight submission per user+tier at a time (resubmission after
-- rejection/cancellation is allowed — those rows fall outside this partial index).
CREATE UNIQUE INDEX IF NOT EXISTS kyc_submissions_one_active_per_tier_idx
  ON kyc_submissions (user_id, tier)
  WHERE status IN ('pending', 'ai_review', 'manual_review');

CREATE TABLE IF NOT EXISTS kyc_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable: uploaded before the submission exists, attached afterwards.
    submission_id uuid REFERENCES kyc_submissions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type text NOT NULL,
    storage_key text NOT NULL,
    content_type text,
    size_bytes integer,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT kyc_documents_doc_type_check CHECK (doc_type IN (
      'govt_id_front', 'govt_id_back', 'proof_of_address', 'selfie', 'nin_slip', 'liveness_selfie'
    ))
);

CREATE INDEX IF NOT EXISTS kyc_documents_submission_idx ON kyc_documents (submission_id);

-- ---------------------------------------------------------------------------
-- x_manifest defaults — admin-configurable KYC settings
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_kyc', 'true', 'Master toggle for the identity KYC (Tier 1-3) feature'),
  ('kyc_cost_credits', '100', 'Credits charged per KYC verification attempt (Tier 1 submission)'),
  ('kyc_tier1_review_mode', 'ai', 'Tier 1 review mode: "ai" (AI pre-screens, escalates low-confidence cases to manual) or "manual" (always human-reviewed)'),
  ('kyc_ai_auto_approve_threshold', '0.85', 'Combined AI confidence (0-1) at or above which a Tier 1 AI-mode submission is auto-approved'),
  ('kyc_ai_escalate_below_threshold', '0.55', 'Combined AI confidence (0-1) below which a Tier 1 AI-mode submission is escalated to manual review instead of auto-rejected'),
  ('kyc_badge_min_tier', '1', 'Minimum approved KYC tier required to show the blue verified checkmark badge'),

  -- Individual creators — product price / revenue thresholds (kobo = smallest NGN unit; USD in cents)
  ('kyc_individual_tier2_threshold_kobo', '10000000', 'Individual: product price or revenue (kobo) above which Tier 2 KYC is required (default NGN 100,000)'),
  ('kyc_individual_tier2_threshold_usd_cents', '100000', 'Individual: product price or revenue (USD cents) above which Tier 2 KYC is required (default $1,000)'),
  ('kyc_individual_tier3_threshold_kobo', '100000000', 'Individual: product price or revenue (kobo) at/above which Tier 3 KYC is required (default NGN 1,000,000)'),
  ('kyc_individual_tier3_threshold_usd_cents', '500000', 'Individual: product price or revenue (USD cents) at/above which Tier 3 KYC is required (default $5,000)'),

  -- Business accounts — product price / revenue thresholds
  ('kyc_business_tier2_threshold_kobo', '50000000', 'Business: product price or revenue (kobo) above which Tier 2 KYC is required (default NGN 500,000)'),
  ('kyc_business_tier2_threshold_usd_cents', '500000', 'Business: product price or revenue (USD cents) above which Tier 2 KYC is required (default $5,000)'),
  ('kyc_business_tier3_threshold_kobo', '1000000000', 'Business: product price or revenue (kobo) at/above which Tier 3 KYC is required (default NGN 10,000,000)'),
  ('kyc_business_tier3_threshold_usd_cents', '500000', 'Business: product price or revenue (USD cents) at/above which Tier 3 KYC is required (default $5,000)')
ON CONFLICT (key) DO NOTHING;
