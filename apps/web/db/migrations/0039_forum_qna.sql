-- 0039_forum_qna.sql
--
-- Zobia Answers — Mini Forum (Q&A).
--
-- Reddit-style Q&A: questions, threaded answers (self-referencing for
-- nested replies), up/downvotes, and favorites. Moderation reuses the
-- existing reports/moderation_reports pipeline (discrete nullable FK
-- columns, same convention as reported_message_id/reported_room_id) rather
-- than inventing a parallel moderation system.
--
-- All pricing/level/reward config lives in x_manifest (see seed at the
-- bottom) — lib/manifest/index.ts falls back to the same defaults when a
-- row is absent, so this seed only surfaces the keys in /admin/config and
-- /admin/forum/settings.

-- ---------------------------------------------------------------------
-- 1. Core tables
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forum_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'visible', -- visible | removed | needs_review
  vote_score        INTEGER NOT NULL DEFAULT 0,
  answer_count      INTEGER NOT NULL DEFAULT 0,
  favorite_count    INTEGER NOT NULL DEFAULT 0,
  is_locked         BOOLEAN NOT NULL DEFAULT FALSE,
  best_answer_id    UUID, -- FK added below, after forum_answers exists
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS forum_answers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id        UUID NOT NULL REFERENCES forum_questions(id) ON DELETE CASCADE,
  author_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_answer_id   UUID REFERENCES forum_answers(id) ON DELETE CASCADE,
  -- Denormalised nesting depth (parent.depth + 1), hard-capped at 10 by the
  -- application layer. Beyond the cap, new replies still attach but the
  -- client always renders "Continue this thread" instead of inline nesting.
  depth              INTEGER NOT NULL DEFAULT 0,
  body               TEXT NOT NULL,
  vote_score         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'visible', -- visible | removed | needs_review
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

ALTER TABLE forum_questions
  ADD CONSTRAINT forum_questions_best_answer_fk
  FOREIGN KEY (best_answer_id) REFERENCES forum_answers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS forum_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  TEXT NOT NULL CHECK (target_type IN ('question', 'answer')),
  target_id    UUID NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value        SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_type, target_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_favorites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES forum_questions(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, question_id)
);

-- Moderator/admin action audit trail for forum content, mirroring
-- room_moderation_log's shape so mod actions here are auditable the same
-- way room moderation already is.
CREATE TABLE IF NOT EXISTS forum_moderation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id     UUID REFERENCES forum_questions(id) ON DELETE CASCADE,
  answer_id       UUID REFERENCES forum_answers(id) ON DELETE CASCADE,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  reason          TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_forum_questions_popular    ON forum_questions (status, vote_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_questions_trending   ON forum_questions (status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_questions_new        ON forum_questions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_questions_author     ON forum_questions (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_answers_question     ON forum_answers (question_id, parent_answer_id, vote_score DESC);
CREATE INDEX IF NOT EXISTS idx_forum_answers_author       ON forum_answers (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_votes_target         ON forum_votes (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_forum_favorites_user       ON forum_favorites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_moderation_log_q     ON forum_moderation_log (question_id);

-- ---------------------------------------------------------------------
-- 3. Moderation pipeline reuse — extend the existing report tables with
--    discrete nullable FK columns, matching reported_message_id /
--    reported_room_id / reported_guild_id already on both tables.
-- ---------------------------------------------------------------------

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_forum_question_id UUID
  REFERENCES forum_questions(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_forum_answer_id UUID
  REFERENCES forum_answers(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_forum_question_id UUID
  REFERENCES forum_questions(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_forum_answer_id UUID
  REFERENCES forum_answers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_moderation_reports_forum_question ON moderation_reports (reported_forum_question_id) WHERE reported_forum_question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_forum_answer   ON moderation_reports (reported_forum_answer_id) WHERE reported_forum_answer_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. x_manifest seed — admin-configurable via /admin/config and
--    /admin/forum/settings (both write the same rows).
-- ---------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_forum',                        'true', 'Master toggle for Zobia Answers (mini forum / Q&A)'),
  ('forum_min_level_to_post',              '2',    'Minimum account level required to post a question'),
  ('forum_min_level_to_comment',           '1',    'Minimum account level required to answer/comment for free'),
  ('forum_comment_bypass_cost_credits',    '1',    'Credits charged to comment when below the comment level gate'),
  ('forum_reward_xp_per_question',         '10',   'XP awarded for posting a question'),
  ('forum_reward_credits_per_question',    '0',    'Credits awarded for posting a question'),
  ('forum_reward_xp_per_answer',           '5',    'XP awarded for posting an answer'),
  ('forum_reward_credits_per_answer',      '0',    'Credits awarded for posting an answer'),
  ('forum_reward_xp_per_upvote',           '1',    'XP awarded to a content author per upvote received'),
  ('forum_reward_credits_per_upvote',      '0',    'Credits awarded to a content author per upvote received'),
  ('forum_reward_xp_best_answer',          '25',   'XP awarded when an answer is marked best'),
  ('forum_reward_credits_best_answer',     '10',   'Credits awarded when an answer is marked best'),
  ('forum_daily_reward_cap_credits',       '50',   'Max forum-sourced credit rewards a single user can earn per rolling 24h'),
  ('forum_auto_moderation_enabled',        'true', 'Run profanity/duplicate auto-moderation on new questions and answers')
ON CONFLICT (key) DO NOTHING;
