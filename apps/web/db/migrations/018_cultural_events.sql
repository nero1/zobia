-- migration: 018_cultural_events
-- Extends the platform_events cultural calendar to the full 12-event slate.
-- PRD §25 specifies cultural vitality events; only 3 were seeded in 003_missing_tables.
-- This migration adds the remaining 9 annual events (2026 editions).

INSERT INTO platform_events (name, description, event_type, xp_multiplier, starts_at, ends_at, metadata)
VALUES
  -- Easter Weekend (double gifting XP)
  ('Easter Celebration Weekend', 'Double gift XP across the platform', 'cultural', 1.0,
   '2026-04-03 00:00:00+00', '2026-04-05 23:59:59+00', '{"gift_xp_multiplier": 2}'),

  -- African Liberation / Freedom Day — May 25
  ('Africa Freedom Day', 'Pan-African double XP on May 25th', 'cultural', 2.0,
   '2026-05-25 00:00:00+00', '2026-05-25 23:59:59+00', '{"city_filter": null}'),

  -- Labour Day — May 1
  ('Labour Day Boost', 'Full-platform 1.5× XP on International Workers Day', 'cultural', 1.5,
   '2026-05-01 00:00:00+00', '2026-05-01 23:59:59+00', '{"city_filter": null}'),

  -- African Union Day — July 11 (AU founding anniversary)
  ('African Union Day', 'Cross-continent guild alliance bonus weekend', 'cultural', 1.5,
   '2026-07-10 00:00:00+00', '2026-07-12 23:59:59+00', '{"alliance_bonus": true}'),

  -- Eid al-Adha (approximate — adjust annually via admin)
  ('Eid al-Adha Celebration', 'Double gifting XP during the feast', 'cultural', 1.0,
   '2026-06-06 00:00:00+00', '2026-06-08 23:59:59+00', '{"gift_xp_multiplier": 2}'),

  -- Eid al-Fitr (end of Ramadan — approximate)
  ('Eid al-Fitr Celebration', 'Community gifting bonus at end of Ramadan', 'cultural', 1.0,
   '2026-03-30 00:00:00+00', '2026-03-31 23:59:59+00', '{"gift_xp_multiplier": 2}'),

  -- Black History Month — full February
  ('Black History Month', 'All-February 1.25× XP — celebrate African achievements', 'cultural', 1.25,
   '2026-02-01 00:00:00+00', '2026-02-28 23:59:59+00', '{"city_filter": null}'),

  -- Kwanzaa — Dec 26 – Jan 1
  ('Kwanzaa Week', 'Community and culture XP boost Dec 26 – Jan 1', 'cultural', 1.5,
   '2026-12-26 00:00:00+00', '2027-01-01 23:59:59+00', '{"city_filter": null}'),

  -- New Year Countdown — Dec 31 midnight
  ('New Year Countdown', 'Triple XP in the final hour of the year', 'cultural', 3.0,
   '2026-12-31 23:00:00+00', '2027-01-01 00:59:59+00', '{"city_filter": null}')

ON CONFLICT DO NOTHING;
