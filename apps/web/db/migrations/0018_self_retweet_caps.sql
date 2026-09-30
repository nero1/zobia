-- Migration 0018: multiple retweets of your own Tweet (paid plans / level)
--
-- A user may now retweet their OWN Tweet up to a per-user cap (min 1), so a
-- tweet_retweets row is no longer unique per (tweet, user). Each retweet gets
-- a `seq` (1, 2, 3, ...) and uniqueness moves to (tweet_id, user_id, seq).
-- Retweeting someone else's Tweet stays one-per-user (always seq = 1).
--
-- Admin-editable x_manifest keys (Admin > Config > "Tweets"):
--   tweets_self_retweet_level_min   level that unlocks the fixed cap below for non-paid accounts (0 = off)
--   tweets_self_retweet_level_max   fixed cap for qualifying non-paid accounts
--   tweets_self_retweet_plan_caps   JSON map of plan / business_<tier> -> cap (bigger for pricier plans)
--
-- No new table, so no GRANT statements are needed.

BEGIN;

ALTER TABLE tweet_retweets
  ADD COLUMN IF NOT EXISTS seq smallint NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_tweet_retweets_tweet_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tweet_retweets_tweet_user_seq
  ON tweet_retweets USING btree (tweet_id, user_id, seq);

INSERT INTO x_manifest (key, value, description) VALUES
  ('tweets_self_retweet_level_min', '10', 'Account level (main rank number, 1 = Beginner) at which NON-paid accounts may retweet their own Tweet more than once, up to tweets_self_retweet_level_max times per Tweet. 0 disables the level unlock. Everyone else can retweet their own Tweet once.'),
  ('tweets_self_retweet_level_max', '2', 'Fixed max number of times a qualifying non-paid account (level >= tweets_self_retweet_level_min) may retweet their own Tweet.'),
  ('tweets_self_retweet_plan_caps', '{"plus":3,"pro":5,"max":10,"business_starter":5,"business_growth":10,"business_enterprise":20}', 'JSON object mapping a plan slug (plus/pro/max) or business_<tier> (business_starter/growth/enterprise) to the max times that account may retweet its own Tweet. Give pricier plans bigger numbers. A user gets the highest cap that applies to them (plan, business tier, or level unlock); minimum 1.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
