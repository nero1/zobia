-- migration: 029_international_womens_month
-- Adds International Women's Month cultural event (March 1–7).
-- Female creators earn a 1.5× XP boost during the first week of March.
-- PRD §25: Cultural Vitality Calendar — platform promotes African and global
-- cultural moments with XP multipliers and creator spotlights.

-- Add gender field to users table for Women's Month creator boost eligibility.
-- Optional self-declared field; NULL means not specified.
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IN ('female', 'male', 'non_binary', 'prefer_not_to_say'));

INSERT INTO platform_events (
  name,
  description,
  event_type,
  xp_multiplier,
  starts_at,
  ends_at,
  metadata
) VALUES
  (
    'International Women''s Month — Creator Boost Week',
    'Celebrating women creators: female creators earn 1.5× XP on all content and room activity during the first week of March.',
    'cultural',
    1.5,
    '2026-03-01 00:00:00+00',
    '2026-03-07 23:59:59+00',
    '{
      "female_creator_only": true,
      "boost_tracks": ["creator", "social"],
      "spotlight_female_creators": true,
      "badge": "womens_month_creator_2026",
      "description_short": "1.5× XP for female creators (1–7 Mar)"
    }'
  ),
  (
    'International Women''s Month — Creator Boost Week',
    'Celebrating women creators: female creators earn 1.5× XP on all content and room activity during the first week of March.',
    'cultural',
    1.5,
    '2027-03-01 00:00:00+00',
    '2027-03-07 23:59:59+00',
    '{
      "female_creator_only": true,
      "boost_tracks": ["creator", "social"],
      "spotlight_female_creators": true,
      "badge": "womens_month_creator_2027",
      "description_short": "1.5× XP for female creators (1–7 Mar)"
    }'
  )
ON CONFLICT DO NOTHING;

-- Ensure the XP award engine checks platform_events for female_creator_only events.
-- The xp/award route already reads active platform_events and applies xp_multiplier.
-- The female_creator_only flag is evaluated in lib/xp/engine.ts at award time:
--   if metadata.female_creator_only is true, only apply multiplier when
--   the awarding user has gender = 'female' AND creator_tier IS NOT NULL.
-- No schema change needed — metadata is JSONB and engine reads it dynamically.
