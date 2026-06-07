-- Migration 031: Referral one-time bonus configuration
-- Adds admin-configurable values for referral system (PRD §15)

-- Seed referral config into x_manifest for admin to override
INSERT INTO x_manifest (key, value) VALUES
  ('referral_tier1_coin_bonus', '100'),
  ('referral_tier1_xp_bonus', '500'),
  ('referral_tier2_coin_bonus', '50'),
  ('referral_tier2_xp_bonus', '250'),
  ('referral_qualifying_action', 'coin_purchase')
ON CONFLICT (key) DO NOTHING;
