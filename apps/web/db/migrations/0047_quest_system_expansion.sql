-- 0047_quest_system_expansion.sql
--
-- Quest system expansion:
--   1. Feature-gated daily quest templates — quest_templates.feature_key ties
--      a template to a manifest feature flag (games/blogs/wiki/polls/quizzes/
--      forum/…) so quests for a disabled feature are never assigned.
--   2. Admin quest-category "campaign boosts" — quest_feature_boosts lets an
--      admin promote a feature's quests ("more blog/wiki quests this week")
--      for a date range; the deck engine reads active rows and weights
--      selection accordingly.
--   3. Sponsored Quests billing + lifecycle expansion — reuses the existing
--      ad_wallet_ledger (lib/db/schema.ts adCampaigns section) for funding
--      and the existing sponsored_quests table for identity/moderation, and
--      adds duration+budget billing fields, pause/flag lifecycle metadata,
--      and owner_user_id (admin-assigned quest "creator"/manager).
--   4. sponsored_quest_events — append-only impression cost ledger, mirrors
--      ad_events so spend pacing/stats reuse the same idiom.
--   5. quest_templates.sponsored_quest_id — when a sponsored quest opts into
--      daily-deck distribution (is_daily_quest_eligible), a shadow
--      quest_templates row is upserted so the existing deck/progress/
--      completion plumbing (user_quest_decks, user_quest_progress,
--      questEngine.ts) handles it identically to a regular quest, instead of
--      building a parallel tracking system.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1 & 5. quest_templates additions
-- ---------------------------------------------------------------------------

ALTER TABLE quest_templates ADD COLUMN IF NOT EXISTS feature_key text;
ALTER TABLE quest_templates ADD COLUMN IF NOT EXISTS sponsored_quest_id uuid;

CREATE INDEX IF NOT EXISTS idx_quest_templates_feature_key ON quest_templates (feature_key) WHERE feature_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_templates_sponsored_quest_id ON quest_templates (sponsored_quest_id) WHERE sponsored_quest_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. quest_feature_boosts — admin campaign promotion
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quest_feature_boosts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key text NOT NULL,
    weight_multiplier numeric(6,2) NOT NULL DEFAULT 2.0,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    note text,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT quest_feature_boosts_weight_check CHECK (weight_multiplier > 0),
    CONSTRAINT quest_feature_boosts_range_check CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_quest_feature_boosts_active ON quest_feature_boosts (feature_key, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- 3. sponsored_quests — billing + lifecycle expansion
-- ---------------------------------------------------------------------------

ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS paused_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS paused_at timestamp with time zone;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS auto_paused boolean NOT NULL DEFAULT false;

ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS flag_status text NOT NULL DEFAULT 'none';
ALTER TABLE sponsored_quests DROP CONSTRAINT IF EXISTS sponsored_quests_flag_status_check;
ALTER TABLE sponsored_quests ADD CONSTRAINT sponsored_quests_flag_status_check
    CHECK (flag_status IN ('none', 'flagged'));
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS flag_category text;
ALTER TABLE sponsored_quests DROP CONSTRAINT IF EXISTS sponsored_quests_flag_category_check;
ALTER TABLE sponsored_quests ADD CONSTRAINT sponsored_quests_flag_category_check
    CHECK (flag_category IS NULL OR flag_category IN ('spam', 'scam', 'other'));
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS flag_reason text;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS flagged_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS flagged_at timestamp with time zone;

ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'duration';
ALTER TABLE sponsored_quests DROP CONSTRAINT IF EXISTS sponsored_quests_pricing_model_check;
ALTER TABLE sponsored_quests ADD CONSTRAINT sponsored_quests_pricing_model_check
    CHECK (pricing_model IN ('duration', 'impression', 'hybrid'));

ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS total_budget_credits numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS spent_credits numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS daily_budget_credits numeric(14,2);
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS cpm_credits numeric(12,2) NOT NULL DEFAULT 500;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS estimated_reach integer;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS impressions_count bigint NOT NULL DEFAULT 0;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS completions_count bigint NOT NULL DEFAULT 0;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS funded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sponsored_quests ADD COLUMN IF NOT EXISTS is_daily_quest_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE sponsored_quests DROP CONSTRAINT IF EXISTS sponsored_quests_budget_check;
ALTER TABLE sponsored_quests ADD CONSTRAINT sponsored_quests_budget_check
    CHECK (total_budget_credits >= 0 AND spent_credits >= 0);

CREATE INDEX IF NOT EXISTS idx_sponsored_quests_owner ON sponsored_quests (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sponsored_quests_daily_eligible
    ON sponsored_quests (is_active, moderation_status, is_daily_quest_eligible)
    WHERE deleted_at IS NULL AND is_daily_quest_eligible = true;
CREATE INDEX IF NOT EXISTS idx_sponsored_quests_flag_status ON sponsored_quests (flag_status) WHERE flag_status = 'flagged';

-- ---------------------------------------------------------------------------
-- 4. sponsored_quest_events — impression cost ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sponsored_quest_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quest_id uuid NOT NULL REFERENCES sponsored_quests(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    cost_credits numeric(12,4) NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT sponsored_quest_events_type_check CHECK (event_type IN ('impression', 'completion'))
);

CREATE INDEX IF NOT EXISTS idx_sponsored_quest_events_quest ON sponsored_quest_events (quest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sponsored_quest_events_daily_spend ON sponsored_quest_events (quest_id, event_type, created_at);
-- One impression per user per quest per day — deck generation is already
-- locked per user+date (questEngine.ts generateDailyDeck), so this is a
-- defensive backstop against a retried insert double-billing the budget.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsored_quest_events_impression_dedupe
    ON sponsored_quest_events (quest_id, user_id, (created_at::date))
    WHERE event_type = 'impression' AND user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- x_manifest — quest system config (typed accessors in lib/manifest/index.ts)
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
    ('sponsored_quest_daily_injection_enabled', 'true', 'Allow eligible Sponsored Quests to appear in regular users'' daily quest decks (in addition to the creator-application marketplace).'),
    ('sponsored_quest_daily_slot_chance', '0.35', 'Probability (0-1) that a user''s daily deck swaps in an eligible Sponsored Quest for one regular quest slot.'),
    ('sponsored_quest_default_cpm_credits', '500', 'Default Credits charged per 1,000 daily-quest-deck impressions when a Sponsored Quest has no custom CPM.'),
    ('sponsored_quest_max_daily_slots', '1', 'Max Sponsored Quest slots per user per day in the daily quest deck.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- New feature-gated daily quest templates (PRD "Daily Quest System") — only
-- assigned when the matching feature is enabled (feature_key), giving every
-- enabled feature a pool of quests to draw from. Existing core templates
-- (messages/room_join/gift/etc., feature_key IS NULL) are unaffected.
-- ---------------------------------------------------------------------------

INSERT INTO quest_templates (title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, feature_key, is_active) VALUES
  ('Game On', 'Play any game today', 'game_play', 1, 120, 15, 'gaming', 'free', 'games', '🎮', 'games', true),
  ('Game Marathon', 'Play 3 game rounds today', 'game_play', 3, 150, 20, 'gaming', 'plus', 'games', '🕹️', 'games', true),

  ('Storyteller', 'Publish a Blog post', 'blog_publish', 1, 250, 30, 'knowledge', 'free', 'blogs', '✍️', 'blogs', true),
  ('Blog Engager', 'Comment on 2 Blog posts', 'blog_comment', 2, 100, 15, 'knowledge', 'free', 'blogs', '💬', 'blogs', true),

  ('Wiki Contributor', 'Edit or create a Wiki article', 'wiki_edit', 1, 220, 25, 'knowledge', 'free', 'wiki', '📝', 'wiki', true),

  ('Make Your Voice Heard', 'Vote in a Poll today', 'poll_vote', 1, 60, 5, 'social', 'free', 'polls', '🗳️', 'polls', true),
  ('Poll Creator', 'Create a Poll', 'poll_create', 1, 150, 15, 'social', 'free', 'polls', '📊', 'polls', true),

  ('Quiz Whiz', 'Complete a Quiz today', 'quiz_complete', 1, 100, 15, 'knowledge', 'free', 'quizzes', '🧠', 'quizzes', true),
  ('Perfect Score', 'Get a perfect score on any Quiz', 'quiz_perfect', 1, 220, 25, 'knowledge', 'free', 'quizzes', '💯', 'quizzes', true),

  ('Join the Discussion', 'Reply to a Forum thread', 'forum_reply', 1, 90, 10, 'social', 'free', 'forum', '🗨️', 'bbforum', true),
  ('Start a Thread', 'Create a new Forum thread', 'forum_create_thread', 1, 180, 20, 'social', 'free', 'forum', '📌', 'bbforum', true),

  ('Spread the Love', 'Send a Gift to 2 different users today', 'gift', 2, 110, 15, 'generosity', 'free', 'gifts', '💝', 'gifts', true)
ON CONFLICT (title) DO NOTHING;
