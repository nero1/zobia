-- Migration 0019: self-retweet caps by level TIERS, new business defaults
--
-- Replaces the single level unlock from 0018 (tweets_self_retweet_level_min /
-- tweets_self_retweet_level_max) with one admin-editable map:
--   tweets_self_retweet_level_caps  JSON { "<min level>": cap } for NON-paid
--                                   accounts; the highest tier reached applies.
--   default: level 1+ -> 2, level 5+ -> 5
-- and raises the default business caps to 10 / 15 / 30 (only where the admin
-- has not already changed the value).

BEGIN;

DELETE FROM x_manifest WHERE key IN ('tweets_self_retweet_level_min', 'tweets_self_retweet_level_max');

INSERT INTO x_manifest (key, value, description) VALUES
  ('tweets_self_retweet_level_caps', '{"1":2,"5":5}', 'JSON object mapping a minimum account level (main rank number, 1 = Beginner) to how many times an account at or above that level may retweet its own Tweet. The highest tier reached applies; paid plans use tweets_self_retweet_plan_caps instead when that gives more. Empty object = no level tiers.')
ON CONFLICT (key) DO NOTHING;

UPDATE x_manifest
   SET value = '{"plus":3,"pro":5,"max":10,"business_starter":10,"business_growth":15,"business_enterprise":30}'
 WHERE key = 'tweets_self_retweet_plan_caps'
   AND value = '{"plus":3,"pro":5,"max":10,"business_starter":5,"business_growth":10,"business_enterprise":20}';

COMMIT;
