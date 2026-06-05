-- Migration 022: Early access support for feature flags
-- Adds columns to feature_flags table for early access scheduling,
-- and adds is_council_member flag to users for Platform Council members.

-- Add early access support to feature flags
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS early_access_plans TEXT[] DEFAULT NULL;
COMMENT ON COLUMN feature_flags.available_from IS 'When this feature becomes available to all users. NULL = always available.';
COMMENT ON COLUMN feature_flags.early_access_plans IS 'Array of plan names that get early access (before available_from). E.g. {max} or {pro,max}. NULL = no early access period.';

-- Add early access flag for council members
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_council_member BOOLEAN NOT NULL DEFAULT FALSE;
