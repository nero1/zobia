-- migration: 021_plan_features
-- Adds required_plan column to season_pass_milestones for Pro/Max extended rewards (PRD §3).

ALTER TABLE season_pass_milestones
  ADD COLUMN IF NOT EXISTS required_plan TEXT DEFAULT NULL
  CHECK (required_plan IN ('pro', 'max'));

COMMENT ON COLUMN season_pass_milestones.required_plan IS
  'NULL = available to all paid pass holders; pro = requires Pro plan; max = requires Max plan. These are the extended season pass rewards for Pro/Max plan subscribers (PRD §3).';
