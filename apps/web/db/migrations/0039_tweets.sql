-- 0039_tweets.sql
--
-- Tweets: a lightweight, Twitter-style social primitive. A tweet is short
-- text with an optional single uploaded image (Credits-only, admin-priced,
-- charged atomically with creation — same pipeline shape as Zobia Moments in
-- lib/moments/service.ts) and/or an optional free video embed (YouTube or
-- TikTok). Tweets also support threaded replies (a reply is just a tweet
-- with parent_tweet_id set) and retweets/quote-retweets.
--
-- Feeds: For You (query-time "hot" ranking, no cron), Friends, Following,
-- Mentions — all cursor-paginated the same way as /api/moments.
--
-- Tweet length: a flat admin-configured default (tweets_default_max_length,
-- default 280 chars) applies to everyone. Users who are role- or
-- level-exempt (tweets_long_min_role / tweets_long_min_level) get free long
-- tweets up to their own configurable tweetMaxLength (users.tweet_max_length,
-- clamped to the admin long-form ceiling, tweets_long_max_length, expressed
-- in WORDS per product decision — see lib/tweets/service.ts for the
-- words->chars conversion). Non-exempt users may still post a long tweet by
-- paying tweets_long_tweet_cost_credits. Regardless of any of that, content
-- can never exceed TWEETS_HARD_CHAR_CAP (7000, a code constant mirrored here
-- as a DB safety net, not admin-configurable).

CREATE TABLE IF NOT EXISTS tweets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_tweet_id uuid REFERENCES tweets(id) ON DELETE CASCADE,
  content text,
  image_url text,
  video_provider text,
  video_url text,
  video_embed_id text,
  is_pinned boolean NOT NULL DEFAULT false,
  likes_count integer NOT NULL DEFAULT 0,
  replies_count integer NOT NULL DEFAULT 0,
  retweets_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);

-- Content is required unless an image or video is attached; when present it
-- is capped at a hard 7000-char safety ceiling — the real, much lower,
-- effective limit (default-vs-long-form-vs-personal) is computed and
-- enforced server-side in lib/tweets/service.ts, since it depends on
-- per-user/per-admin config the DB layer doesn't know about.
ALTER TABLE tweets DROP CONSTRAINT IF EXISTS tweets_content_required;
ALTER TABLE tweets ADD CONSTRAINT tweets_content_required
  CHECK (content IS NOT NULL OR image_url IS NOT NULL OR video_provider IS NOT NULL);
ALTER TABLE tweets DROP CONSTRAINT IF EXISTS tweets_content_length;
ALTER TABLE tweets ADD CONSTRAINT tweets_content_length CHECK (content IS NULL OR char_length(content) <= 7000);
ALTER TABLE tweets DROP CONSTRAINT IF EXISTS tweets_video_provider_check;
ALTER TABLE tweets ADD CONSTRAINT tweets_video_provider_check
  CHECK (video_provider IS NULL OR video_provider = ANY (ARRAY['youtube'::text, 'tiktok'::text]));
-- A video embed always carries both its provider and an extracted embed id.
ALTER TABLE tweets DROP CONSTRAINT IF EXISTS tweets_video_fields_consistent;
ALTER TABLE tweets ADD CONSTRAINT tweets_video_fields_consistent
  CHECK ((video_provider IS NULL) = (video_embed_id IS NULL));

-- Feed queries: newest-first (For You/Friends/Following/Mentions all order
-- by created_at within their join), and a per-author lookup for profiles.
CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets (user_id, created_at DESC) WHERE deleted_at IS NULL;
-- Reply thread lookup: "every reply to tweet X", chronological.
CREATE INDEX IF NOT EXISTS idx_tweets_parent_id ON tweets (parent_tweet_id, created_at ASC) WHERE deleted_at IS NULL;
-- At most one pinned tweet per user (enforced in the service layer inside a
-- transaction too, but a partial unique index makes it airtight under races).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweets_one_pinned_per_user ON tweets (user_id) WHERE is_pinned = true AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tweet_likes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweet_likes_tweet_user ON tweet_likes (tweet_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tweet_likes_user ON tweet_likes (user_id);

CREATE TABLE IF NOT EXISTS tweet_mentions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweet_mentions_tweet_user ON tweet_mentions (tweet_id, mentioned_user_id);
-- Mentions tab: "every tweet I'm mentioned in" (top-level tweets AND
-- replies both insert here identically), newest first.
CREATE INDEX IF NOT EXISTS idx_tweet_mentions_user_created ON tweet_mentions (mentioned_user_id, created_at DESC);

-- Retweets (plain) and quote-retweets (quote_content set) — one row per
-- (original tweet, retweeter), so re-retweeting is a toggle like a like, and
-- a quote can be added/changed only by un-retweeting and retweeting again.
CREATE TABLE IF NOT EXISTS tweet_retweets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_content text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE tweet_retweets DROP CONSTRAINT IF EXISTS tweet_retweets_quote_length;
ALTER TABLE tweet_retweets ADD CONSTRAINT tweet_retweets_quote_length CHECK (quote_content IS NULL OR char_length(quote_content) <= 7000);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweet_retweets_tweet_user ON tweet_retweets (tweet_id, user_id);
-- Profile "my retweets" + feed attribution ("X retweeted"), newest first.
CREATE INDEX IF NOT EXISTS idx_tweet_retweets_user_created ON tweet_retweets (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Per-user personal tweet-length preference (PATCH /api/users/me/settings).
-- NULL = "use the admin default" (tweets_default_max_length).
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS tweet_max_length integer;

-- ---------------------------------------------------------------------------
-- Moderation — plug Tweets into the existing generic report tables (same
-- shape as reported_poll_id/reported_quiz_id in 0038_polls_quizzes.sql).
-- ---------------------------------------------------------------------------

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_tweet_id uuid REFERENCES tweets(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_tweet_id uuid REFERENCES tweets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_tweet ON reports (reported_tweet_id) WHERE reported_tweet_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Manifest defaults (idempotent seed; an admin who already set these keeps
-- their value).
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_tweets', 'true', 'Master toggle for the Tweets feature. When off, all /api/tweets endpoints and the /tweets pages return unavailable.'),
  ('tweets_min_level', '2', 'Minimum account level (main rank number, 1 = Beginner) required to post a Tweet.'),
  ('tweets_image_cost_credits', '5', 'Credits charged to attach an image to a Tweet. Set to 0 to make image uploads free. Video embeds (YouTube/TikTok) are always free regardless of this setting.'),
  ('tweets_default_max_length', '280', 'Standard Tweet length limit in characters, applied to all eligible users unless they are long-form exempt.'),
  ('tweets_long_min_level', '10', 'Minimum account level that unlocks free long-form Tweets (above tweets_default_max_length) up to the user''s personal max length. Combined with tweets_long_min_role by OR — either qualifies.'),
  ('tweets_long_min_role', '["role_admin","role_moderator","pro","max"]', 'JSON array of role/plan eligibility entries (same vocabulary as lib/plans/eligibility.ts: plan slugs, prestige_N, business_N, role_admin, role_moderator) that unlock free long-form Tweets. Combined with tweets_long_min_level by OR.'),
  ('tweets_long_max_length', '1000', 'Long-form Tweet ceiling in WORDS (not characters) — the maximum a user''s personal tweetMaxLength setting can be raised to. Converted to an approximate character ceiling server-side.'),
  ('tweets_long_tweet_cost_credits', '10', 'Credits charged for a single Tweet whose content exceeds tweets_default_max_length, for users who are NOT long-form exempt. Exempt users post long Tweets (up to their personal max length) for free.')
ON CONFLICT (key) DO NOTHING;
