-- ============================================================
-- Zobia Social — Seed Data for Fresh Deployments
--
-- Run AFTER all migrations.  Creates enough content for the
-- app to feel alive on day one:
--   - Season 1
--   - Platform-managed welcome room
--   - Sample rooms across key categories
--   - Sample guilds (seeded without real captain UUIDs;
--     replace platform_admin_id below before running)
--
-- Usage:
--   psql $DATABASE_URL -f seed.sql
--
-- Note: The seed creates a platform admin user first so that
-- all FK relationships resolve cleanly.  Change the email and
-- credentials before use in any real environment.
-- ============================================================

-- ============================================================
-- 1. Platform admin user
--    password_hash is a bcrypt hash of "changeme_immediately"
--    CHANGE THIS before deploying to production.
-- ============================================================
INSERT INTO users (
  id,
  username,
  display_name,
  email,
  password_hash,
  avatar_emoji,
  is_admin,
  is_email_verified,
  plan,
  onboarding_completed,
  country,
  locale
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'zobia_admin',
  'Zobia',
  'admin@zobia.social',
  '$2b$12$PLACEHOLDER_HASH_CHANGE_BEFORE_DEPLOY',
  '🌍',
  true,
  true,
  'max',
  true,
  'NG',
  'en'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Season 1 — "The Beginning"
--    Starts immediately.  Adjust dates as needed.
-- ============================================================
INSERT INTO seasons (
  id,
  name,
  theme,
  description,
  season_number,
  starts_at,
  ends_at,
  pass_price_coins,
  is_active
) VALUES (
  '00000000-0000-0000-0001-000000000001',
  'The Beginning',
  'Origins',
  'The very first Zobia season. Be here from day one — these badges will never be earned again.',
  1,
  NOW(),
  NOW() + INTERVAL '56 days',  -- 8 weeks
  500,
  true
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Sample Rooms
--    All created by the platform admin user.
-- ============================================================

-- 3a. Welcome to Zobia (open to all new users, pinned discovery)
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public,
  is_featured,
  max_members
) VALUES (
  '00000000-0000-0000-0002-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Welcome to Zobia 🌍',
  'Your first stop. Say hello, ask questions, and meet the community. This room is always open.',
  'free_open',
  'community',
  true,
  true,
  10000
) ON CONFLICT (id) DO NOTHING;

-- 3b. Lagos Vibes — city room
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  city,
  is_public,
  is_featured
) VALUES (
  '00000000-0000-0000-0002-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Lagos Vibes 🦅',
  'The unofficial home of Lagos on Zobia. Gist, argue, vibe — all in one place.',
  'free_open',
  'city',
  'Lagos',
  true,
  true
) ON CONFLICT (id) DO NOTHING;

-- 3c. Study Hall — knowledge room
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Study Hall 📚',
  'Focused conversations about tech, business, and self-improvement. Big brain energy only.',
  'free_open',
  'knowledge',
  true
) ON CONFLICT (id) DO NOTHING;

-- 3d. Music & Culture — entertainment room
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'Music & Culture 🎵',
  'Afrobeats, Amapiano, highlife — all the sounds shaping Africa right now.',
  'free_open',
  'entertainment',
  true
) ON CONFLICT (id) DO NOTHING;

-- 3e. Business Corner — founder/entrepreneur room
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'Business Corner 💼',
  'For founders, side-hustlers, and anyone building something. Share wins, get feedback.',
  'free_open',
  'business',
  true
) ON CONFLICT (id) DO NOTHING;

-- 3f. Sports Arena 🏆
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000006',
  '00000000-0000-0000-0000-000000000001',
  'Sports Arena 🏆',
  'Football, basketball, athletics — live reactions, predictions, and post-match roasts.',
  'free_open',
  'sports',
  true
) ON CONFLICT (id) DO NOTHING;

-- 3g. Tech Talk 🖥️
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000007',
  '00000000-0000-0000-0000-000000000001',
  'Tech Talk 🖥️',
  'Developers, designers, data people. What are you building? What broke today?',
  'free_open',
  'technology',
  true
) ON CONFLICT (id) DO NOTHING;

-- 3h. Crypto & Finance 💰
INSERT INTO rooms (
  id,
  creator_id,
  name,
  description,
  room_type,
  category,
  is_public
) VALUES (
  '00000000-0000-0000-0002-000000000008',
  '00000000-0000-0000-0000-000000000001',
  'Crypto & Finance 💰',
  'Markets, crypto, investment strategies. DYOR. This is not financial advice.',
  'free_open',
  'finance',
  true
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. Add platform admin as creator/member of all seed rooms
-- ============================================================
INSERT INTO room_members (room_id, user_id, role) VALUES
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0000-000000000001', 'creator'),
  ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0000-000000000001', 'creator')
ON CONFLICT (room_id, user_id) DO NOTHING;

-- ============================================================
-- 5. Sample guilds
--    Named after Nigerian cities for local identity seeding.
-- ============================================================
INSERT INTO guilds (
  id,
  name,
  crest_emoji,
  description,
  city,
  country,
  captain_id,
  tier,
  recruitment_type
) VALUES
  (
    '00000000-0000-0000-0003-000000000001',
    'Lagos Lions',
    '🦁',
    'The pride of Lagos. We build, we compete, we win.',
    'Lagos',
    'NG',
    '00000000-0000-0000-0000-000000000001',
    'bronze_1',
    'open'
  ),
  (
    '00000000-0000-0000-0003-000000000002',
    'Abuja Eagles',
    '🦅',
    'Capital city energy. Sharp minds, sharper moves.',
    'Abuja',
    'NG',
    '00000000-0000-0000-0000-000000000001',
    'bronze_1',
    'open'
  ),
  (
    '00000000-0000-0000-0003-000000000003',
    'PH Wolves',
    '🐺',
    'Port Harcourt hustle. We grind in silence and let results speak.',
    'Port Harcourt',
    'NG',
    '00000000-0000-0000-0000-000000000001',
    'bronze_1',
    'open'
  ),
  (
    '00000000-0000-0000-0003-000000000004',
    'Kano Falcons',
    '🏔️',
    'North power. Loyal to the core, dangerous in war.',
    'Kano',
    'NG',
    '00000000-0000-0000-0000-000000000001',
    'bronze_1',
    'open'
  ),
  (
    '00000000-0000-0000-0003-000000000005',
    'Ibadan Giants',
    '🏛️',
    'Ancient city, modern hustle. History runs through us.',
    'Ibadan',
    'NG',
    '00000000-0000-0000-0000-000000000001',
    'bronze_1',
    'open'
  )
ON CONFLICT (id) DO NOTHING;

-- Add admin as captain-member of each seed guild
INSERT INTO guild_members (guild_id, user_id, role) VALUES
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', 'captain'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'captain'),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0000-000000000001', 'captain'),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0000-000000000001', 'captain'),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0000-000000000001', 'captain')
ON CONFLICT (guild_id, user_id) DO NOTHING;

-- ============================================================
-- 6. Welcome announcement modal
--    Shown to every new user on first login.
-- ============================================================
INSERT INTO announcement_modals (
  title,
  content,
  content_type,
  is_active,
  starts_at,
  target_plans,
  display_order
) VALUES (
  'Welcome to Zobia 🌍',
  '<h2>You just joined something different.</h2>
<p>Zobia is the platform where your social life earns real rewards. Every message, every gift, every login — it all builds your rank, feeds your guild, and puts Coins in your pocket.</p>
<p>Here''s what to do first:</p>
<ul>
  <li>✅ Complete your <strong>New Member Quest</strong> for 1,000 Coins + 2,000 XP</li>
  <li>🏠 Join a <strong>Room</strong> near you and say hello</li>
  <li>🛡️ Find your <strong>Guild</strong> — your crew awaits</li>
</ul>
<p>The Season has just started. Your legacy begins now.</p>',
  'html',
  true,
  NOW(),
  ARRAY['free', 'plus', 'pro', 'max'],
  0
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. Welcome banner
-- ============================================================
INSERT INTO announcement_banners (
  content,
  content_type,
  is_active,
  starts_at,
  ends_at,
  target_plans,
  display_order
) VALUES (
  '🎉 <strong>Season 1 is live!</strong> Complete your New Member Quest for 1,000 Coins + 2,000 XP. <a href="/quests">Start now →</a>',
  'html',
  true,
  NOW(),
  NOW() + INTERVAL '7 days',
  ARRAY['free', 'plus', 'pro', 'max'],
  0
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 8. Default Reaction Sets
--    Three purchasable packs available to all users on launch.
-- ============================================================

-- 8a. Zobia Fire Pack (100 coins)
INSERT INTO reaction_sets (id, name, description, coin_price, preview_emoji, is_active)
VALUES (
  '00000000-0000-0000-0004-000000000001',
  'Zobia Fire Pack',
  'Hot reactions for the hottest takes. The entry-level pack.',
  100,
  '🔥',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO reaction_set_items (set_id, emoji, name, sort_order) VALUES
  ('00000000-0000-0000-0004-000000000001', '🔥', 'Fire',     0),
  ('00000000-0000-0000-0004-000000000001', '💥', 'Explode',  1),
  ('00000000-0000-0000-0004-000000000001', '⚡', 'Electric', 2)
ON CONFLICT DO NOTHING;

-- 8b. Golden Pack (200 coins)
INSERT INTO reaction_sets (id, name, description, coin_price, preview_emoji, is_active)
VALUES (
  '00000000-0000-0000-0004-000000000002',
  'Golden Pack',
  'Prestige reactions for the elite. Gold standard only.',
  200,
  '👑',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO reaction_set_items (set_id, emoji, name, sort_order) VALUES
  ('00000000-0000-0000-0004-000000000002', '👑', 'Crown',   0),
  ('00000000-0000-0000-0004-000000000002', '💎', 'Diamond', 1),
  ('00000000-0000-0000-0004-000000000002', '🏆', 'Trophy',  2)
ON CONFLICT DO NOTHING;

-- 8c. Boss Pack (500 coins)
INSERT INTO reaction_sets (id, name, description, coin_price, preview_emoji, is_active)
VALUES (
  '00000000-0000-0000-0004-000000000003',
  'Boss Pack',
  'For those who run the room. Top-tier reactions, boss energy only.',
  500,
  '🦁',
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO reaction_set_items (set_id, emoji, name, sort_order) VALUES
  ('00000000-0000-0000-0004-000000000003', '🦁', 'Lion',   0),
  ('00000000-0000-0000-0004-000000000003', '💰', 'Money',  1),
  ('00000000-0000-0000-0004-000000000003', '🎯', 'Target', 2)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 9. Cultural Vitality Calendar — Recurring Platform Events
--
-- These events seed the platform_events table with Africa-focused
-- cultural celebrations, awareness days, and platform XP events.
-- Dates use 2025 as the baseline year; the events CRON can clone
-- them annually.
-- ============================================================

-- Flash XP events tied to African public holidays / cultural days
INSERT INTO platform_events (
  id, title, description, type, starts_at, ends_at,
  xp_multiplier, is_active, created_by
) VALUES

-- New Year (global)
(
  '00000000-0000-0000-0005-000000000001',
  'New Year Flash XP',
  'Double XP to kick off the new year. Go harder.',
  'flash_xp',
  '2025-01-01T00:00:00Z',
  '2025-01-01T23:59:59Z',
  2,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Africa Day (25 May)
(
  '00000000-0000-0000-0005-000000000002',
  'Africa Day 2025',
  'Celebrating the unity of the African continent. XP tripled all day.',
  'cultural',
  '2025-05-25T00:00:00Z',
  '2025-05-25T23:59:59Z',
  3,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Nigerian Independence Day (1 Oct)
(
  '00000000-0000-0000-0005-000000000003',
  'Nigeria @ 65 — Independence Flash',
  'Nigeria is 65! XP doubled for all Nigerian users.',
  'cultural',
  '2025-10-01T00:00:00Z',
  '2025-10-01T23:59:59Z',
  2,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Eid al-Fitr Flash (approximate — adjust to lunar calendar)
(
  '00000000-0000-0000-0005-000000000004',
  'Eid Mubarak Flash XP',
  'Eid Mubarak! Gift drops doubled and XP boosted for 24 hours.',
  'cultural',
  '2025-03-30T06:00:00Z',
  '2025-03-31T06:00:00Z',
  2,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Christmas (25 Dec)
(
  '00000000-0000-0000-0005-000000000005',
  'Christmas Flash XP',
  'Season''s greetings! XP doubled and free gift drop for all users.',
  'flash_xp',
  '2025-12-25T00:00:00Z',
  '2025-12-25T23:59:59Z',
  2,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Pan-African Women's Day (31 July)
(
  '00000000-0000-0000-0005-000000000006',
  'African Women''s Day',
  'Celebrating the women of Africa. Social Track XP tripled today.',
  'cultural',
  '2025-07-31T00:00:00Z',
  '2025-07-31T23:59:59Z',
  3,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Mandela Day (18 July)
(
  '00000000-0000-0000-0005-000000000007',
  'Mandela Day Flash',
  '18 minutes of action, 18x inspiration. Give 18 minutes to someone today.',
  'cultural',
  '2025-07-18T00:00:00Z',
  '2025-07-18T23:59:59Z',
  2,
  true,
  '00000000-0000-0000-0000-000000000001'
),

-- Season Finale Mystery Drop (last day of each season — symbolic entry)
(
  '00000000-0000-0000-0005-000000000008',
  'Season 1 Grand Finale',
  'Last day of Season 1. Mystery XP drops every hour. Don''t miss out.',
  'mystery_drop',
  '2025-04-06T00:00:00Z',
  '2025-04-06T23:59:59Z',
  1,
  true,
  '00000000-0000-0000-0000-000000000001'
)

ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Done.  Seed complete.
-- ============================================================
