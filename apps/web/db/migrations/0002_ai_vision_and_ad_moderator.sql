-- 0002_ai_vision_and_ad_moderator.sql
--
-- AI image classification pipeline (DeepSeek primary → Gemini fallback →
-- human review) + the "Ad Moderator" staff role that reviews images which
-- neither model could confidently classify.
--
--   1. ai_call_log gains token-usage + structured metadata columns so the
--      centralized Admin AI Monitoring panel can show per-call cost
--      estimates and pipeline details.
--   2. users gains is_ad_moderator — a new staff role, alongside the
--      existing is_admin/is_moderator/is_support booleans.
--   3. ad_campaigns gains ai_escalated — set when an ad image could not be
--      confidently auto-approved or auto-rejected by either AI provider.
--   4. ad_ai_escalations — the ad-moderator review queue: one row per
--      creative that needs a human look, with both providers' raw results
--      attached for context.

BEGIN;

ALTER TABLE ai_call_log
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_ad_moderator boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_ad_moderator ON users (is_ad_moderator) WHERE is_ad_moderator = true;

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS ai_escalated boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ai_escalated ON ad_campaigns (ai_escalated) WHERE ai_escalated = true;

CREATE TABLE IF NOT EXISTS ad_ai_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    creative_id uuid,
    image_url text NOT NULL,
    deepseek_result jsonb,
    gemini_result jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_ai_escalations_pkey PRIMARY KEY (id),
    CONSTRAINT ad_ai_escalations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT ad_ai_escalations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    CONSTRAINT ad_ai_escalations_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,
    CONSTRAINT ad_ai_escalations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_ai_escalations_status ON ad_ai_escalations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_ai_escalations_campaign_id ON ad_ai_escalations (campaign_id);

-- Manifest defaults for the vision pipeline. Empty string means "use the
-- built-in default" (see lib/ai/config.ts / lib/ai/client.ts) — admins can
-- override from Admin > AI Settings without a deploy.
INSERT INTO x_manifest (key, value, description) VALUES
  ('ai_vision_provider_order', 'deepseek,gemini', 'Image-classification provider fallback/escalation order (vision-capable providers only).'),
  ('ai_vision_escalate_below_threshold', '0.6', 'If the active vision provider''s confidence is below this, escalate to the next provider (or human review).'),
  ('ai_deepseek_vision_model', '', 'Admin override for the DeepSeek vision model. Empty = use the built-in default (deepseek-flash).'),
  ('ai_gemini_vision_model', '', 'Admin override for the Gemini vision model. Empty = use the built-in default (gemini-3.6-flash).')
ON CONFLICT (key) DO NOTHING;

COMMIT;
