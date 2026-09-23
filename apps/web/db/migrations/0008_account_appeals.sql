-- 0008_account_appeals.sql
--
-- Account Appeals pipeline (suspension/ban appeals).
--
-- A user who is blocked at login by a suspension or ban can file an appeal
-- from a short-lived, identity-verified appeal link issued at the moment of
-- the blocked login attempt (see app/api/auth/google/callback,
-- app/api/auth/telegram/callback and lib/auth/appealToken.ts). Appeals are
-- reviewed by admins/moderators at /gate44/moderation/appeals, optionally
-- preceded by an AI triage pass (x_manifest appeals_triage_mode).

CREATE TABLE IF NOT EXISTS account_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appeal_type text NOT NULL CHECK (appeal_type IN ('suspension', 'ban')),
  reason text NOT NULL,
  contact_email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'denied')),
  refusal_count integer NOT NULL DEFAULT 0,
  ai_triage_result jsonb,
  admin_notes text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_appeals_user_id ON account_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_account_appeals_status ON account_appeals(status);
CREATE INDEX IF NOT EXISTS idx_account_appeals_created_at ON account_appeals(created_at DESC);

-- Admin-configurable defaults (lib/manifest — appeals.maxRefusals / appeals.triageMode)
INSERT INTO x_manifest (key, value, description, updated_at)
VALUES ('appeals_max_refusals', '3', 'Max times an account appeal may be denied before further appeals for that suspension/ban are blocked.', NOW())
ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at)
VALUES ('appeals_triage_mode', 'manual', 'How suspension/ban appeals are reviewed: "manual" (default, always human) or "ai_then_manual" (AI triage first, human decides).', NOW())
ON CONFLICT DO NOTHING;
