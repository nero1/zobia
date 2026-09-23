-- 0005_boost_polls_quizzes.sql
--
-- Widens ad_campaigns.boosted_content_type to accept 'poll'/'quiz', and adds
-- both to the Home Feed's content-type coverage (lib/feed/types.ts
-- FeedContentType, lib/ads/repo.ts BoostableContentType). Polls and quizzes
-- were previously invisible in every feed tab and could not be boosted
-- through the generalized content-boost system (PRD §39.6) — this migration
-- only touches the DB-level CHECK constraint; the feed queries themselves
-- read straight from the existing `polls`/`quizzes` tables, no new columns
-- needed.
--
-- Postgres has no ALTER CONSTRAINT ... ADD VALUE for a CHECK list, so the
-- constraint is dropped and recreated with the same name and the two new
-- values appended.

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_boosted_content_type_check;

ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_boosted_content_type_check
  CHECK (((boosted_content_type IS NULL) OR (boosted_content_type = ANY (ARRAY[
    'moment'::text, 'tweet'::text, 'blog_post'::text, 'forum_thread'::text,
    'forum_question'::text, 'room'::text, 'wiki_page'::text, 'game'::text,
    'classroom'::text, 'business_page_post'::text, 'poll'::text, 'quiz'::text
  ]))));
