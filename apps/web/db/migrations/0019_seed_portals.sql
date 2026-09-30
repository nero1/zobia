-- Migration 0019: seed starter Portals
--
-- Seeds a set of official (admin-curated) portals so the /h discovery hub is
-- not empty on day one: Nigerian and diaspora places, universities and a few
-- evergreen topics. Nothing is fabricated as user content: the portals start
-- with no posts and fill as people use the hashtags. Place portals carry a
-- place keyword, so existing rooms and guilds in that city appear on them
-- straight away. School portals use a campus keyword (for example UNILAG,
-- Nsukka) for the same purpose.
--
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING on the hashtag slug and
-- on the portal's hashtag). Admins can edit, unpublish or delete any of these
-- at /gate44/portals; deleting a portal never removes the hashtag or posts.
-- No new tables, so no GRANTs are needed (see 0018).

BEGIN;

CREATE TEMP TABLE seed_portals (
  slug      text PRIMARY KEY,
  title     text NOT NULL,
  tagline   text NOT NULL,
  accent    text NOT NULL,
  city      text
) ON COMMIT DROP;

INSERT INTO seed_portals (slug, title, tagline, accent, city) VALUES
  -- Places
  ('lagos',        'Lagos',         'The Centre of Excellence: food, nightlife, hustle and everything in between.', '#0d9488', 'Lagos'),
  ('abuja',        'Abuja',         'The capital city: events, people and places around FCT.',                      '#2563eb', 'Abuja'),
  ('edo',          'Edo',           'Home of Benin City: culture, food, news and people.',                          '#d97706', 'Benin'),
  ('portharcourt', 'Port Harcourt', 'The Garden City: music, food and the Rivers State community.',                  '#16a34a', 'Port Harcourt'),
  ('ibadan',       'Ibadan',        'The city of brown roofs: Oyo State, campuses and culture.',                     '#b45309', 'Ibadan'),
  ('kano',         'Kano',          'The ancient commercial centre of the north.',                                   '#7c3aed', 'Kano'),
  ('accra',        'Accra',         'Ghana''s capital: music, food and community.',                                  '#dc2626', 'Accra'),
  ('nairobi',      'Nairobi',       'The green city in the sun: tech, music and life in Kenya.',                     '#0891b2', 'Nairobi'),
  ('detroit',      'Detroit',       'Motor City: Naija in Detroit and the wider Michigan community.',                '#475569', 'Detroit'),
  ('london',       'London',        'Naija and Africans in London: events, food and meetups.',                       '#be123c', 'London'),
  -- Schools
  ('uniben',       'University of Benin',           'UNIBEN: campus life, news and the alumni network.',            '#0f766e', 'UNIBEN'),
  ('unilag',       'University of Lagos',           'UNILAG: the University of First Choice. Campus life and alumni.', '#1d4ed8', 'UNILAG'),
  ('oau',          'Obafemi Awolowo University',    'OAU Ife: campus life, culture and alumni.',                    '#15803d', 'Obafemi Awolowo'),
  ('ui',           'University of Ibadan',          'UI: the premier university. Campus life and alumni.',          '#a16207', 'University of Ibadan'),
  ('abu',          'Ahmadu Bello University',       'ABU Zaria: campus life and the alumni community.',             '#7e22ce', 'Ahmadu Bello'),
  ('unn',          'University of Nigeria, Nsukka', 'UNN: campus life, news and alumni.',                           '#c2410c', 'Nsukka'),
  -- Topics
  ('naija',        'Naija',         'All things Nigeria: news, culture, humour and pride.',                          '#059669', NULL),
  ('afrobeats',    'Afrobeats',     'New music, artists, playlists and the culture behind the sound.',               '#db2777', NULL),
  ('football',     'Football',      'Matchday chat, transfers and the beautiful game.',                              '#65a30d', NULL),
  ('food',         'Food',          'Recipes, street food and restaurant finds.',                                    '#ea580c', NULL),
  ('jollof',       'Jollof',        'The great jollof debate and every rice dish you love.',                         '#dc2626', NULL),
  ('tech',         'Tech',          'Builders, startups, gadgets and careers in tech.',                              '#4f46e5', NULL);

INSERT INTO hashtags (slug, display, last_used_at)
SELECT slug, slug, NOW() FROM seed_portals
ON CONFLICT (slug) DO NOTHING;

INSERT INTO portals (slug, hashtag_id, title, tagline, status, accent_color, city, last_activity_at)
SELECT s.slug, h.id, s.title, s.tagline, 'official', s.accent, s.city, NOW()
FROM seed_portals s
JOIN hashtags h ON h.slug = s.slug
-- Skip tags that were merged into another or blocked, and tags that already have a portal.
WHERE h.alias_of IS NULL AND h.is_blocked = false
ON CONFLICT (hashtag_id) DO NOTHING;

COMMIT;
