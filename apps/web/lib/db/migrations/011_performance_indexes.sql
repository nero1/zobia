-- Migration 011: Performance Indexes (PERF-01)
--
-- Adds missing indexes identified during forensic review.
-- All indexes are CREATE INDEX IF NOT EXISTS (safe to re-run).

-- xp_ledger: dedup queries filter on (user_id, source, reference_id)
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_source_ref
  ON xp_ledger (user_id, source, reference_id)
  WHERE reference_id IS NOT NULL;

-- xp_ledger: daily login dedup (source + created_at::date)
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_source_date
  ON xp_ledger (user_id, source, (created_at::date));

-- xp_ledger: track-level aggregation for fund scoring and leaderboard updates
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_track_created
  ON xp_ledger (user_id, track, created_at);

-- coin_ledger: reference_id uniqueness (supports ON CONFLICT (reference_id))
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_reference_id_unique
  ON coin_ledger (reference_id)
  WHERE reference_id IS NOT NULL;

-- coin_ledger: user balance queries and comeback bonus lookups
CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_type_created
  ON coin_ledger (user_id, transaction_type, created_at);

-- user_inactivity_events: CRON re-engagement dispatch filter
CREATE INDEX IF NOT EXISTS idx_user_inactivity_events_notified
  ON user_inactivity_events (push_email_notified, created_at)
  WHERE push_email_notified = false;

CREATE INDEX IF NOT EXISTS idx_user_inactivity_events_telegram
  ON user_inactivity_events (telegram_notified, created_at)
  WHERE telegram_notified = false;

-- leaderboard_snapshots: getUserRank count query (scope + track + city)
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope_track_city
  ON leaderboard_snapshots (scope, track, city, xp_value DESC);

-- leaderboard_rank_snapshots: ripple notification lookup
CREATE INDEX IF NOT EXISTS idx_lb_rank_snapshots_scope
  ON leaderboard_rank_snapshots (scope, user_id);

-- nemesis_assignments: bugfix column — ensure query is covered
CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_user_id
  ON nemesis_assignments (user_id);

CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_nemesis_user_id
  ON nemesis_assignments (nemesis_user_id);

-- referrals: streak qualification query
CREATE INDEX IF NOT EXISTS idx_referrals_qualified_tier
  ON referrals (qualified, tier)
  WHERE qualified = false;

-- failed_xp_awards: DLQ retry query
CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_retry
  ON failed_xp_awards (resolved_at, retry_count, last_retried_at)
  WHERE resolved_at IS NULL;

-- user_sticker_packs: ownership check
CREATE INDEX IF NOT EXISTS idx_user_sticker_packs_user_pack
  ON user_sticker_packs (user_id, pack_id);

-- conversation_scores / dm_conversation_scores: threshold scan
CREATE INDEX IF NOT EXISTS idx_dm_conversation_scores_score
  ON dm_conversation_scores (score DESC)
  WHERE score > 0;

-- guild_members: contribution score alerts
CREATE INDEX IF NOT EXISTS idx_guild_members_guild_contribution
  ON guild_members (guild_id, contribution_score)
  WHERE left_at IS NULL;

-- creator_payouts: payout reference lookup
CREATE INDEX IF NOT EXISTS idx_creator_payouts_provider_ref
  ON creator_payouts (provider_reference);

-- payments: webhook reference lookup
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON payments (provider_reference);

-- users: plan-based coin bonus query
CREATE INDEX IF NOT EXISTS idx_users_plan_deleted
  ON users (plan, deleted_at)
  WHERE deleted_at IS NULL;
