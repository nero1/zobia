-- 0038_polls_quizzes.sql
--
-- Polls & Quizzes: users (and admins) can create custom polls that other
-- people vote on, and custom quizzes that other people take. Both content
-- types can optionally be "rewarded" — the creator funds a Credits pot
-- (treasury) and the first N people who vote/share (polls) or pass/share
-- (quizzes) split it evenly, mirroring the blog post reward-pot mechanic in
-- 0020_blog_post_treasury.sql / 0024_blog_gifts.sql. Baseline XP/Credits for
-- simply creating or voting/taking are separate and always-on (admin
-- configurable via x_manifest, defaults seeded below), same shape as the
-- Answers (forum) reward config.
--
-- Public SEO pages: /poll/<slug> and /quiz/<slug>, alongside the existing
-- /b/<slug> (blogs) and /a/<slug> (answers) convention.

-- ---------------------------------------------------------------------------
-- Polls
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  allow_multiple boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  closes_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  voter_count integer NOT NULL DEFAULT 0,
  share_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS polls_slug_idx ON polls (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS polls_creator_idx ON polls (creator_id);
CREATE INDEX IF NOT EXISTS polls_status_created_idx ON polls (status, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_status_check;
ALTER TABLE polls ADD CONSTRAINT polls_status_check CHECK (status = ANY (ARRAY['active'::text, 'closed'::text, 'disabled'::text]));

CREATE TABLE IF NOT EXISTS poll_options (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  vote_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS poll_options_poll_idx ON poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
-- One row per (poll, option, user) — for single-choice polls the service
-- layer additionally enforces "at most one option per poll per user" before
-- inserting; for allow_multiple polls a user may hold several option rows.
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_poll_option_user_idx ON poll_votes (poll_id, option_id, user_id);
CREATE INDEX IF NOT EXISTS poll_votes_poll_user_idx ON poll_votes (poll_id, user_id);

-- ---------------------------------------------------------------------------
-- Quizzes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  passing_score_percent integer NOT NULL DEFAULT 60,
  max_attempts_per_user integer NOT NULL DEFAULT 1,
  view_count integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  share_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_slug_idx ON quizzes (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS quizzes_creator_idx ON quizzes (creator_id);
CREATE INDEX IF NOT EXISTS quizzes_status_created_idx ON quizzes (status, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS quizzes_status_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_status_check CHECK (status = ANY (ARRAY['active'::text, 'closed'::text, 'disabled'::text]));
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS quizzes_passing_score_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_passing_score_check CHECK (passing_score_percent BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  prompt text NOT NULL,
  type text NOT NULL DEFAULT 'single',
  points integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON quiz_questions (quiz_id, position);
ALTER TABLE quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_type_check;
ALTER TABLE quiz_questions ADD CONSTRAINT quiz_questions_type_check CHECK (type = ANY (ARRAY['single'::text, 'multiple'::text, 'true_false'::text]));

CREATE TABLE IF NOT EXISTS quiz_question_options (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quiz_question_options_question_idx ON quiz_question_options (question_id, position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  score integer NOT NULL DEFAULT 0,
  total_points integer NOT NULL DEFAULT 0,
  score_percent integer NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_user_idx ON quiz_attempts (quiz_id, user_id);
-- The pass/reward pipeline dedupes on the FIRST passing attempt only (see
-- content_treasury_claims / lib/quizzes/service.ts), so attempts themselves
-- are not unique per user — max_attempts_per_user is enforced in the
-- service layer by counting existing rows.

CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected_option_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_correct boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS quiz_attempt_answers_attempt_idx ON quiz_attempt_answers (attempt_id);

-- ---------------------------------------------------------------------------
-- Shared treasury/pot + share tracking (polls + quizzes) — one generic pair
-- of tables rather than duplicating blog_post_treasuries per content type,
-- since the mechanic (creator funds a pot, first N claimants of a given
-- claim_type split it evenly, recomputed at claim time) is identical.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_shares (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_shares_type_content_user_idx ON content_shares (content_type, content_id, user_id);
ALTER TABLE content_shares DROP CONSTRAINT IF EXISTS content_shares_type_check;
ALTER TABLE content_shares ADD CONSTRAINT content_shares_type_check CHECK (content_type = ANY (ARRAY['poll'::text, 'quiz'::text]));

CREATE TABLE IF NOT EXISTS content_treasuries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funded_amount integer NOT NULL DEFAULT 0,
  remaining_amount integer NOT NULL DEFAULT 0,
  max_claimants integer NOT NULL,
  claimant_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_treasuries_type_content_idx ON content_treasuries (content_type, content_id);
ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_type_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_type_check CHECK (content_type = ANY (ARRAY['poll'::text, 'quiz'::text]));
ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_status_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_status_check CHECK (status = ANY (ARRAY['active'::text, 'exhausted'::text, 'closed'::text]));

CREATE TABLE IF NOT EXISTS content_treasury_claims (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  treasury_id uuid NOT NULL REFERENCES content_treasuries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_type text NOT NULL,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_treasury_claims_treasury_user_idx ON content_treasury_claims (treasury_id, user_id);
ALTER TABLE content_treasury_claims DROP CONSTRAINT IF EXISTS content_treasury_claims_type_check;
ALTER TABLE content_treasury_claims ADD CONSTRAINT content_treasury_claims_type_check CHECK (claim_type = ANY (ARRAY['vote'::text, 'share'::text, 'pass'::text]));

-- ---------------------------------------------------------------------------
-- Moderation — plug polls/quizzes into the existing generic report tables
-- (same shape as reported_forum_question_id / reported_forum_answer_id).
-- ---------------------------------------------------------------------------

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_poll_id uuid REFERENCES polls(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_quiz_id uuid REFERENCES quizzes(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_poll_id uuid REFERENCES polls(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_quiz_id uuid REFERENCES quizzes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_poll ON reports (reported_poll_id) WHERE reported_poll_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_quiz ON reports (reported_quiz_id) WHERE reported_quiz_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Manifest defaults (idempotent seed; an admin who already set these keeps
-- their value). Master kill-switches + per-action XP/Credit defaults,
-- mirroring the forum_* config block exactly.
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_polls', 'true', 'Master toggle for the Polls feature. When off, all /api/polls endpoints and /poll/* pages return unavailable.'),
  ('feature_quizzes', 'true', 'Master toggle for the Quizzes feature. When off, all /api/quizzes endpoints and /quiz/* pages return unavailable.'),
  ('poll_monetization_enabled', 'true', 'Master kill-switch for Poll reward pots (treasuries). When off, funding/claiming a pot is disabled but polls still work.'),
  ('quiz_monetization_enabled', 'true', 'Master kill-switch for Quiz reward pots (treasuries). When off, funding/claiming a pot is disabled but quizzes still work.'),
  ('polls_min_level_to_create', '1', 'Minimum account level required to create a poll.'),
  ('polls_reward_xp_creator', '1', 'XP awarded to a user for creating a poll.'),
  ('polls_reward_credits_creator', '0', 'Credits awarded to a user for creating a poll.'),
  ('polls_reward_xp_voter', '1', 'XP awarded to a user for voting on a poll.'),
  ('polls_reward_credits_voter', '0', 'Credits awarded to a user for voting on a poll.'),
  ('polls_daily_reward_cap_credits', '50', 'Ceiling on total poll-sourced credit rewards a user can earn per rolling 24h.'),
  ('polls_max_options', '10', 'Maximum number of options a poll may have.'),
  ('quizzes_min_level_to_create', '1', 'Minimum account level required to create a quiz.'),
  ('quizzes_reward_xp_creator', '1', 'XP awarded to a user for creating a quiz.'),
  ('quizzes_reward_credits_creator', '0', 'Credits awarded to a user for creating a quiz.'),
  ('quizzes_reward_xp_taker', '1', 'XP awarded to a user for completing (taking) a quiz.'),
  ('quizzes_reward_credits_taker', '0', 'Credits awarded to a user for completing (taking) a quiz.'),
  ('quizzes_daily_reward_cap_credits', '50', 'Ceiling on total quiz-sourced credit rewards a user can earn per rolling 24h.'),
  ('quizzes_max_questions', '25', 'Maximum number of questions a quiz may have.'),
  ('quizzes_default_max_attempts', '1', 'Default max attempts per user when a quiz creator does not specify one.')
ON CONFLICT (key) DO NOTHING;
