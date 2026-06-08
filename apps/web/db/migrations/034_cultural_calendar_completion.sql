-- migration: 034_cultural_calendar_completion
-- Completes the PRD §25 Cultural Vitality Calendar with the remaining events:
--   - New Year Hustle Season (January)
--   - Valentine's Gift Weekend (Feb 14)
--   - AFCON Season (Jan–Feb, Africa Cup of Nations cycle)
--   - Valentine's Day 2027 (pre-seeded)
--
-- Existing events covered by prior migrations:
--   003: Nigerian Independence Day (Oct 1), Detty December
--   018: Easter, Africa Freedom Day, Labour Day, African Union Day,
--        Eid al-Adha, Eid al-Fitr, Black History Month, Kwanzaa, New Year Countdown
--   029: International Women's Month (Mar 1–7)

INSERT INTO platform_events (name, description, event_type, xp_multiplier, starts_at, ends_at, metadata)
VALUES
  -- New Year Hustle Season — Jan 1–7 (post-countdown energy burst)
  (
    'New Year Hustle Season',
    'Kick off the new year with bonus XP for every action. The platform''s biggest new-start energy.',
    'cultural',
    1.5,
    '2026-01-01 01:00:00+00',
    '2026-01-07 23:59:59+00',
    '{
      "city_filter": null,
      "badge": "new_year_hustle_2026",
      "description_short": "1.5× XP for the first week of the year"
    }'
  ),

  -- Valentine''s Gift Weekend — Feb 13–15
  (
    'Valentine''s Gift Weekend',
    'Double the gift XP across the platform. The most gifted weekend of the year.',
    'cultural',
    1.0,
    '2026-02-13 00:00:00+00',
    '2026-02-15 23:59:59+00',
    '{
      "gift_xp_multiplier": 2,
      "city_filter": null,
      "badge": "valentines_gifter_2026",
      "description_short": "2× gift XP Feb 13–15"
    }'
  ),

  -- AFCON Season — Jan–Feb (Africa Cup of Nations; exact dates rotate annually)
  -- Seeded as approximate window; admin can adjust via the platform_events admin panel
  (
    'AFCON Season',
    'Africa Cup of Nations — football fever across the continent. Guild war bonuses and 1.5× competitor XP.',
    'cultural',
    1.5,
    '2026-01-10 00:00:00+00',
    '2026-02-28 23:59:59+00',
    '{
      "tracks": ["competitor"],
      "guild_war_points_multiplier": 1.5,
      "city_filter": null,
      "badge": "afcon_fan_2026",
      "description_short": "1.5× competitor XP + guild war bonus during AFCON"
    }'
  ),

  -- Valentine''s Gift Weekend 2027 (pre-seeded for recurring annual visibility)
  (
    'Valentine''s Gift Weekend',
    'Double the gift XP across the platform. The most gifted weekend of the year.',
    'cultural',
    1.0,
    '2027-02-12 00:00:00+00',
    '2027-02-14 23:59:59+00',
    '{
      "gift_xp_multiplier": 2,
      "city_filter": null,
      "badge": "valentines_gifter_2027",
      "description_short": "2× gift XP Feb 12–14 2027"
    }'
  ),

  -- New Year Hustle Season 2027
  (
    'New Year Hustle Season',
    'Kick off the new year with bonus XP for every action.',
    'cultural',
    1.5,
    '2027-01-01 01:00:00+00',
    '2027-01-07 23:59:59+00',
    '{
      "city_filter": null,
      "badge": "new_year_hustle_2027",
      "description_short": "1.5× XP for the first week of 2027"
    }'
  )

ON CONFLICT DO NOTHING;
