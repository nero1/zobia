-- Zobia optional starter content — run AFTER the full migration and admin setup.
-- Supabase: SQL Editor > New query > paste this COMPLETE file > edit owner_email > Run.
-- Replace only REPLACE_WITH_YOUR_ADMIN_EMAIL below with your real administrator email.
-- No users, passwords, paid entitlements, wallet credits, purchases, fake votes or
-- completed activity are created. Draft financial features need operator review.
-- Fixed IDs + conflict-safe inserts preserve existing rows and dates on reruns.
-- One transaction: any error rolls back the complete seed. Never edit the baseline.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL app.is_system = 'true';
DO $starter$
DECLARE
  owner_email text := COALESCE(NULLIF(current_setting('zobia.seed_owner_email',true),''),'REPLACE_WITH_YOUR_ADMIN_EMAIL');
  seed_owner uuid;
  inserted_id uuid;
  board_id uuid;
  business_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('zobia:starter-content:v1',0));
  IF position('@' IN owner_email)<2 THEN
    RAISE EXCEPTION 'Edit owner_email at the top of seed.sql to your existing administrator email, then run the complete file again.';
  END IF;
  IF to_regclass('public.transactional_tasks') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='users' AND column_name='session_valid_after'
  ) THEN RAISE EXCEPTION 'Database upgrade required. Complete SETUP.md section 7 before seeding.'; END IF;
  BEGIN
  SELECT u.id INTO STRICT seed_owner FROM public.users u
  WHERE lower(u.email)=lower(trim(owner_email)) AND u.is_admin=true
    AND u.is_email_verified=true AND u.deleted_at IS NULL
    AND NOT u.is_banned AND NOT u.is_suspended
  FOR UPDATE;
  EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'Exactly one active verified administrator must match owner_email. Finish SETUP.md section 8 first. The seed does not create or promote accounts.';
  END;

  -- 1. Feed posts, replies and text Moments (expire naturally after 24 hours).
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('b2e30527-df07-55e7-b38b-75ccfd841d37', seed_owner, 'Welcome to Zobia! Start with one interest, join a room, and introduce yourself. This is an administrator-authored starter post. #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='b2e30527-df07-55e7-b38b-75ccfd841d37' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('ebc9b9e2-8514-519d-8520-97ef7c348886', seed_owner, 'What useful skill would you like to practise this week? Share one small, achievable goal. #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='ebc9b9e2-8514-519d-8520-97ef7c348886' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('76e44fb6-aa3e-5afb-9225-486e958e8a22', seed_owner, 'Good communities grow through useful questions, thoughtful replies, and respect. What makes you feel welcome online? #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='76e44fb6-aa3e-5afb-9225-486e958e8a22' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('7bc720e8-ca6d-5f8b-b1e1-e6e178feab12', seed_owner, 'Creative challenge: describe your city in three words. Keep it kind and make it yours. #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='7bc720e8-ca6d-5f8b-b1e1-e6e178feab12' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('74fa1d3e-f0a8-5fb2-b7b4-bde92d9a3498', seed_owner, 'Never share passwords, login codes, seed phrases, or payment verification codes in a chat. Use the report button if someone asks. #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='74fa1d3e-f0a8-5fb2-b7b4-bde92d9a3498' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "content")
  VALUES ('9d016320-b6e9-54bb-ae0c-61f12e98bcf6', seed_owner, 'Weekend thread: share a book, song, recipe, or local place you enjoyed. Explain what you liked without sharing private contact details. #zobiastarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tweets WHERE id='9d016320-b6e9-54bb-ae0c-61f12e98bcf6' AND user_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tweets conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tweets ("id", "user_id", "parent_tweet_id", "content")
  VALUES ('f97d8609-e85d-5d1b-9157-e5dccc7ba862', seed_owner, 'b2e30527-df07-55e7-b38b-75ccfd841d37', 'Starter tip: your profile and notification settings help you control what you share.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.tweets SET replies_count=replies_count+1 WHERE id='b2e30527-df07-55e7-b38b-75ccfd841d37'; END IF;
  INSERT INTO public.moments ("id", "user_id", "content", "content_type", "caption", "expires_at")
  VALUES ('dc45745d-60bc-5ad0-ba6f-653103ef05c1', seed_owner, 'Welcome! Choose one topic you care about and say hello.', 'text', 'Starter Moment', now()+interval '24 hours')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.moments ("id", "user_id", "content", "content_type", "caption", "expires_at")
  VALUES ('d217a570-ca87-5945-85be-7736fceebc0a', seed_owner, 'Today’s prompt: learn one small thing and share what helped.', 'text', 'Starter Moment', now()+interval '24 hours')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.moments ("id", "user_id", "content", "content_type", "caption", "expires_at")
  VALUES ('ce1b5c72-46a8-5444-8bad-fa0b0386f4b5', seed_owner, 'Community reminder: ask before sharing someone else’s photo or story.', 'text', 'Starter Moment', now()+interval '24 hours')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 2. Public rooms and a free classroom. Counts represent actual seeded rows.
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('df33d98b-6eb6-5d99-9ca8-32e62fa7b72c', seed_owner, 'Welcome to Zobia', 'starter-welcome', 'Introduce yourself and ask how things work.', 'free_open', 'community', true, true, 10000, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='df33d98b-6eb6-5d99-9ca8-32e62fa7b72c' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('0a9dc4c0-30db-57bc-b1f5-bf6cf7275b75', 'df33d98b-6eb6-5d99-9ca8-32e62fa7b72c', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='df33d98b-6eb6-5d99-9ca8-32e62fa7b72c'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('a653daba-f158-5b7c-9520-778faf22de60', 'df33d98b-6eb6-5d99-9ca8-32e62fa7b72c', seed_owner, 'text', 'Welcome! Introduce yourself and ask how things work.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='df33d98b-6eb6-5d99-9ca8-32e62fa7b72c'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('92f3eba0-d685-5f76-be5b-da6ac40ea3db', seed_owner, 'Lagos Vibes', 'starter-lagos', 'Local conversation and community recommendations.', 'free_open', 'city', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='92f3eba0-d685-5f76-be5b-da6ac40ea3db' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('c50d719c-d062-5a4e-9ed9-7f4bb7169428', '92f3eba0-d685-5f76-be5b-da6ac40ea3db', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='92f3eba0-d685-5f76-be5b-da6ac40ea3db'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('297cf549-8d13-54ff-aeae-49fbe8447ae7', '92f3eba0-d685-5f76-be5b-da6ac40ea3db', seed_owner, 'text', 'Welcome! Local conversation and community recommendations.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='92f3eba0-d685-5f76-be5b-da6ac40ea3db'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('19117f0a-6744-57b5-afea-025edd81bfd2', seed_owner, 'Study Hall', 'starter-study', 'Share study methods and practise a useful skill.', 'free_open', 'knowledge', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='19117f0a-6744-57b5-afea-025edd81bfd2' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('b47338e4-723a-5c55-a012-b95b13ea2d53', '19117f0a-6744-57b5-afea-025edd81bfd2', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='19117f0a-6744-57b5-afea-025edd81bfd2'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('54d72154-c0c3-5851-b478-fa0b7bf046e3', '19117f0a-6744-57b5-afea-025edd81bfd2', seed_owner, 'text', 'Welcome! Share study methods and practise a useful skill.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='19117f0a-6744-57b5-afea-025edd81bfd2'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('f3d9c05a-d89d-56b3-a077-52ce7c31ff63', seed_owner, 'Music and Culture', 'starter-music', 'Discuss music, books, film and cultural traditions.', 'free_open', 'entertainment', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='f3d9c05a-d89d-56b3-a077-52ce7c31ff63' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('1fab0c43-dcff-5abe-abaa-e47e6ce27b2b', 'f3d9c05a-d89d-56b3-a077-52ce7c31ff63', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='f3d9c05a-d89d-56b3-a077-52ce7c31ff63'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('90e50e6c-4a6d-56f9-b30b-b9c9f17c0585', 'f3d9c05a-d89d-56b3-a077-52ce7c31ff63', seed_owner, 'text', 'Welcome! Discuss music, books, film and cultural traditions.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='f3d9c05a-d89d-56b3-a077-52ce7c31ff63'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('5ea99ef8-454d-5e83-b9e5-e6ae22478d70', seed_owner, 'Business Corner', 'starter-business', 'Discuss ideas and practical small-business lessons.', 'free_open', 'business', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='5ea99ef8-454d-5e83-b9e5-e6ae22478d70' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('712f6893-fe83-51bf-b50a-061fca29e2e1', '5ea99ef8-454d-5e83-b9e5-e6ae22478d70', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='5ea99ef8-454d-5e83-b9e5-e6ae22478d70'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('9699617e-e6ac-5f65-816f-439a1911572c', '5ea99ef8-454d-5e83-b9e5-e6ae22478d70', seed_owner, 'text', 'Welcome! Discuss ideas and practical small-business lessons.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='5ea99ef8-454d-5e83-b9e5-e6ae22478d70'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('3c65c207-8fd1-54d6-8d27-3d60e7a1ae74', seed_owner, 'Sports Arena', 'starter-sports', 'Friendly sports discussion and match analysis.', 'free_open', 'sports', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='3c65c207-8fd1-54d6-8d27-3d60e7a1ae74' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('1a5ac9a1-defd-5b46-ad0c-995e7a5a5fd8', '3c65c207-8fd1-54d6-8d27-3d60e7a1ae74', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='3c65c207-8fd1-54d6-8d27-3d60e7a1ae74'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('d7fbec4b-7fcc-5c6f-8a14-9420062d1fe7', '3c65c207-8fd1-54d6-8d27-3d60e7a1ae74', seed_owner, 'text', 'Welcome! Friendly sports discussion and match analysis.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='3c65c207-8fd1-54d6-8d27-3d60e7a1ae74'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('ca7f68b4-cf59-5384-9eb8-e41eea97b2bb', seed_owner, 'Tech Talk', 'starter-tech', 'Ask technical questions and share what you build.', 'free_open', 'technology', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='ca7f68b4-cf59-5384-9eb8-e41eea97b2bb' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('34fdbe26-c266-59d5-b300-e1018481ec5c', 'ca7f68b4-cf59-5384-9eb8-e41eea97b2bb', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='ca7f68b4-cf59-5384-9eb8-e41eea97b2bb'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('96809cd8-f3c9-58f7-ae6d-794aca98d33b', 'ca7f68b4-cf59-5384-9eb8-e41eea97b2bb', seed_owner, 'text', 'Welcome! Ask technical questions and share what you build.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='ca7f68b4-cf59-5384-9eb8-e41eea97b2bb'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at")
  VALUES ('ab471100-5892-5c1d-970b-ef6e488c1f08', seed_owner, 'Money Basics', 'starter-finance', 'Discuss budgeting and financial literacy. No investment promises.', 'free_open', 'finance', true, false, NULL, 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='ab471100-5892-5c1d-970b-ef6e488c1f08' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('ab02d2e0-5827-57f0-85ac-a713213bde62', 'ab471100-5892-5c1d-970b-ef6e488c1f08', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='ab471100-5892-5c1d-970b-ef6e488c1f08'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('47f82aa5-4a6e-5fe9-b29c-183b25dec0eb', 'ab471100-5892-5c1d-970b-ef6e488c1f08', seed_owner, 'text', 'Welcome! Discuss budgeting and financial literacy. No investment promises.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='ab471100-5892-5c1d-970b-ef6e488c1f08'; END IF;
  INSERT INTO public.rooms ("id", "creator_id", "name", "slug", "description", "type", "category", "is_public", "is_featured", "max_members", "member_count", "published_at", "enrolment_fee_ngn", "curriculum")
  VALUES ('904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Digital Safety Classroom', 'starter-classroom', 'A free introductory classroom about staying safe online.', 'classroom', 'knowledge', true, false, NULL, 0, now(), 0, '{"modules": [{"id": "6dcd797a-5ad5-5dce-9035-0bdda44b6ded", "title": "Protect your account", "content": "Use a unique password. Keep login codes private.", "unlockLevel": 1}, {"id": "4ed78928-d71c-57ab-b9d6-810b19cc72f7", "title": "Check a link", "content": "Open the original service directly rather than trusting an unexpected sign-in link.", "unlockLevel": 1}, {"id": "0a1a9322-0518-59a1-9b18-f5c218f4f0ab", "title": "Respect privacy", "content": "Ask permission before sharing personal information.", "unlockLevel": 1}]}'::jsonb)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id='904d69db-4d09-57a9-af80-87dd0d38384d' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter rooms conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.room_members ("id", "room_id", "user_id", "role")
  VALUES ('167bb053-d552-5070-8840-f360f400e1df', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'creator')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET member_count=member_count+1 WHERE id='904d69db-4d09-57a9-af80-87dd0d38384d'; END IF;
  INSERT INTO public.room_messages ("id", "room_id", "sender_id", "message_type", "content")
  VALUES ('a19abfde-b2dc-5269-ad76-3d0c09aa7aec', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'text', 'Welcome! A free introductory classroom about staying safe online.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.rooms SET total_messages=total_messages+1 WHERE id='904d69db-4d09-57a9-af80-87dd0d38384d'; END IF;
  INSERT INTO public.classroom_enrolments ("id", "room_id", "user_id", "paid", "fee_kobo")
  VALUES ('419ac772-b12f-53d0-927d-9cc928f92692', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, false, 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_posts ("id", "room_id", "author_id", "title", "body", "category", "is_pinned")
  VALUES ('bfe47bfd-12c9-522b-b37d-7c4d090d9820', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Protect your account', 'Use a unique password and enable two-factor authentication. Never give another person your login code.', 'Lessons', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_posts ("id", "room_id", "author_id", "title", "body", "category", "is_pinned")
  VALUES ('53e1ea6c-42b8-5635-93f8-8c23bdbf17e9', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Recognise suspicious links', 'Check the full domain before signing in. Open the service directly when an unexpected message asks you to log in.', 'Lessons', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_posts ("id", "room_id", "author_id", "title", "body", "category", "is_pinned")
  VALUES ('f7daa582-def1-5242-839b-8bd679f25fa0', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Respect privacy', 'Ask permission before reposting personal information. Report suspicious accounts rather than arguing with them.', 'Lessons', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_post_comments ("id", "post_id", "room_id", "author_id", "body")
  VALUES ('7f5479c0-46cd-5410-b4e5-3768da7b4bee', 'bfe47bfd-12c9-522b-b37d-7c4d090d9820', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Practice tip: review your account security settings after reading this lesson.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.classroom_posts SET comment_count=comment_count+1 WHERE id='bfe47bfd-12c9-522b-b37d-7c4d090d9820'; END IF;
  INSERT INTO public.classroom_quizzes ("id", "room_id", "creator_id", "title", "description", "xp_reward", "pass_score")
  VALUES ('dee741b1-9762-5c7b-9a30-55637d77e497', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner, 'Digital safety check', 'A short practice check. This starter quiz has no XP reward.', 0, 60)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_quiz_questions ("id", "quiz_id", "question", "option_a", "option_b", "option_c", "option_d", "correct_option", "position")
  VALUES ('4fd029cb-133a-55ad-aa47-250de0fed5d7', 'dee741b1-9762-5c7b-9a30-55637d77e497', 'What should you do with a one-time login code?', 'Keep it private', 'Post it publicly', 'Send it to an unknown helper', 'Reuse it as a password', 'a', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.classroom_events ("id", "room_id", "title", "description", "starts_at", "ends_at", "created_by")
  VALUES ('0868ed27-1e96-5676-a919-ea022a3388c1', '904d69db-4d09-57a9-af80-87dd0d38384d', 'Sample self-paced study reminder', 'Example calendar reminder. Edit or remove this date; no live meeting is promised.', now()+interval '7 days', now()+interval '7 days 1 hour', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 3. A private starter group. Only the real owner is added.
  INSERT INTO public.group_chats ("id", "name", "creator_id", "tag", "member_count")
  VALUES ('21d101e6-325b-5530-b36c-c08f2bdda339', 'Starter Study Group', seed_owner, 'Study Group', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.group_chats WHERE id='21d101e6-325b-5530-b36c-c08f2bdda339' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter group_chats conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.group_chat_members ("id", "group_chat_id", "user_id", "role", "can_invite")
  VALUES ('6dcc6fbd-e710-58be-b4fc-f816e93d7bc8', '21d101e6-325b-5530-b36c-c08f2bdda339', seed_owner, 'admin', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.group_chats SET member_count=member_count+1 WHERE id='21d101e6-325b-5530-b36c-c08f2bdda339'; END IF;
  INSERT INTO public.room_messages ("id", "group_chat_id", "sender_id", "content")
  VALUES ('a7f1fe77-4ffa-5ee2-a7b2-f22de51f887f', '21d101e6-325b-5530-b36c-c08f2bdda339', seed_owner, 'This is your private starter group. Invite people only with their consent.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 4. Community guild, only when the owner has no active guild. No treasury credit.
  IF NOT EXISTS (SELECT 1 FROM public.guild_members WHERE user_id=seed_owner AND left_at IS NULL) AND (SELECT guild_id IS NULL FROM public.users WHERE id=seed_owner) THEN
  INSERT INTO public.guilds ("id", "name", "captain_id", "description", "member_count", "treasury_balance")
  VALUES ('f5faaa85-eba3-510b-8c68-8818b1f05a1d', 'Zobia Starter Community', seed_owner, 'A starter guild for new members. Organise genuine activities together.', 0, 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.guilds WHERE id='f5faaa85-eba3-510b-8c68-8818b1f05a1d' AND captain_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter guilds conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.guild_members ("id", "guild_id", "user_id", "role")
  VALUES ('bdd11831-5909-573a-bdef-5eed34e0097e', 'f5faaa85-eba3-510b-8c68-8818b1f05a1d', seed_owner, 'captain')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.guilds SET member_count=member_count+1 WHERE id='f5faaa85-eba3-510b-8c68-8818b1f05a1d'; END IF;
  UPDATE public.users SET guild_id='f5faaa85-eba3-510b-8c68-8818b1f05a1d' WHERE id=seed_owner AND guild_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.guilds WHERE id='f5faaa85-eba3-510b-8c68-8818b1f05a1d' AND captain_id=seed_owner) THEN
  INSERT INTO public.guild_messages ("id", "guild_id", "sender_id", "content")
  VALUES ('04dedb71-778f-5a32-9b70-df057ccdeac7', 'f5faaa85-eba3-510b-8c68-8818b1f05a1d', seed_owner, 'Welcome to the starter guild. Introduce yourself and suggest a shared goal.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.guild_quests ("id", "guild_id", "title", "description", "target_count", "reward_guild_xp", "reward_coins", "week_start", "week_end", "is_active")
  VALUES ('a5c4d7ca-ba1a-5620-9775-35930ee4e2a6', 'f5faaa85-eba3-510b-8c68-8818b1f05a1d', 'Community check-in', 'Draft collective contribution quest. Review targets, dates and rewards before enabling.', 25, 0, 0, date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', (date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '7 days', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.guild_quests ("id", "guild_id", "title", "description", "target_count", "reward_guild_xp", "reward_coins", "week_start", "week_end", "is_active")
  VALUES ('a4a129d5-2e96-57b3-99ab-de843fb373e0', 'f5faaa85-eba3-510b-8c68-8818b1f05a1d', 'Knowledge exchange', 'Draft collective contribution quest. Review targets, dates and rewards before enabling.', 50, 0, 0, date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', (date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '7 days', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.guild_quests ("id", "guild_id", "title", "description", "target_count", "reward_guild_xp", "reward_coins", "week_start", "week_end", "is_active")
  VALUES ('7bfe7a44-5c5b-591a-a202-86e00d1c0699', 'f5faaa85-eba3-510b-8c68-8818b1f05a1d', 'Creative collaboration', 'Draft collective contribution quest. Review targets, dates and rewards before enabling.', 75, 0, 0, date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', (date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '7 days', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  END IF;

  -- 5. Blog articles, informational pages and a comment. No paywalls or subscriptions.
  INSERT INTO public.blogs ("id", "owner_id", "slug", "title", "tagline", "description")
  VALUES ('67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, 'starter-journal', 'The Starter Journal', 'Community, learning and practical ideas', 'Administrator-authored starter content. Edit or remove these examples before launch.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.blogs WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b' AND blogs.owner_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter blogs conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.blog_categories ("id", "blog_id", "name", "slug")
  VALUES ('11b9eb1a-01b3-57f3-95a4-6129621ee55b', '67f8c810-a719-5ec4-92a4-936832b1766b', 'Getting started', 'getting-started')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "category_id", "title", "slug", "excerpt", "body_markdown", "body_html", "status", "published_at", "word_count")
  VALUES ('7264030b-9b7e-5344-b038-5d0edf02244f', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, '11b9eb1a-01b3-57f3-95a4-6129621ee55b', 'A small start is still a start', 'starter-welcome', 'Pick one useful action today: ask a thoughtful question, share a practical tip, or join a discussion. A healthy community grows through consistent contributions', 'Pick one useful action today: ask a thoughtful question, share a practical tip, or join a discussion. A healthy community grows through consistent contributions, not inflated numbers.', '<p>Pick one useful action today: ask a thoughtful question, share a practical tip, or join a discussion. A healthy community grows through consistent contributions, not inflated numbers.</p>', 'published', now(), 27)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "category_id", "title", "slug", "excerpt", "body_markdown", "body_html", "status", "published_at", "word_count")
  VALUES ('084bafe2-5e2d-5bc5-9a83-481bb3578722', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, '11b9eb1a-01b3-57f3-95a4-6129621ee55b', 'Build a privacy habit', 'starter-privacy', 'Decide what belongs in public and what belongs in a private conversation. Keep login codes and financial credentials private, and ask permission before sharing ', 'Decide what belongs in public and what belongs in a private conversation. Keep login codes and financial credentials private, and ask permission before sharing another person’s details.', '<p>Decide what belongs in public and what belongs in a private conversation. Keep login codes and financial credentials private, and ask permission before sharing another person’s details.</p>', 'published', now(), 27)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "category_id", "title", "slug", "excerpt", "body_markdown", "body_html", "status", "published_at", "word_count")
  VALUES ('2deaf686-84c9-5852-ae32-bef3fcc1eea4', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, '11b9eb1a-01b3-57f3-95a4-6129621ee55b', 'Learn in small steps', 'starter-learning', 'Choose a skill, practise for fifteen minutes, and write down one thing you learned. Ask for feedback with a specific question and keep a record of the resources', 'Choose a skill, practise for fifteen minutes, and write down one thing you learned. Ask for feedback with a specific question and keep a record of the resources that helped.', '<p>Choose a skill, practise for fifteen minutes, and write down one thing you learned. Ask for feedback with a specific question and keep a record of the resources that helped.</p>', 'published', now(), 30)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "title", "slug", "type", "page_key", "body_markdown", "body_html", "word_count", "status", "published_at")
  VALUES ('08b48a16-35f0-54db-a84b-a1667fb7569e', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, 'About', 'about', 'page', 'about', 'This is the administrator’s starter journal. Replace this introduction with your own editorial purpose.', '<p>This is the administrator’s starter journal. Replace this introduction with your own editorial purpose.</p>', 14, 'published', now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "title", "slug", "type", "page_key", "body_markdown", "body_html", "word_count", "status", "published_at")
  VALUES ('c23d5817-0bfd-5212-894b-0b3fe2cddf66', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, 'Privacy', 'privacy', 'page', 'privacy', 'Draft privacy page: describe your actual data practices and contact details before publishing.', '<p>Draft privacy page: describe your actual data practices and contact details before publishing.</p>', 13, 'draft', NULL)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_posts ("id", "blog_id", "author_id", "title", "slug", "type", "page_key", "body_markdown", "body_html", "word_count", "status", "published_at")
  VALUES ('b87d04cc-e78a-5d91-99fb-7551d30f8f4e', '67f8c810-a719-5ec4-92a4-936832b1766b', seed_owner, 'Contact', 'contact', 'page', 'contact', 'Draft contact page: add your real contact channel before publishing.', '<p>Draft contact page: add your real contact channel before publishing.</p>', 10, 'draft', NULL)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blogs SET post_count=post_count+1 WHERE id='67f8c810-a719-5ec4-92a4-936832b1766b'; END IF;
  INSERT INTO public.blog_post_comments ("id", "post_id", "author_id", "body")
  VALUES ('7c9333c3-2852-5e25-920c-45387693f1bb', '7264030b-9b7e-5344-b038-5d0edf02244f', seed_owner, 'Starter discussion: what small contribution will you make today?')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.blog_posts SET comment_count=comment_count+1 WHERE id='7264030b-9b7e-5344-b038-5d0edf02244f'; END IF;

  -- 6. Wiki, pages and matching initial revisions.
  INSERT INTO public.wikis ("id", "owner_id", "slug", "name", "description")
  VALUES ('dfdda271-b5bd-5492-8a69-97d32ab1161d', seed_owner, 'starter-handbook', 'Community Handbook', 'Practical starter pages to improve together.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.wikis WHERE id='dfdda271-b5bd-5492-8a69-97d32ab1161d' AND wikis.owner_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter wikis conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.wiki_collaborators ("id", "wiki_id", "user_id", "role")
  VALUES ('8433eb01-f060-5cb3-a38b-9fcb23d6f263', 'dfdda271-b5bd-5492-8a69-97d32ab1161d', seed_owner, 'owner')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.wikis SET contributor_count=contributor_count+1 WHERE id='dfdda271-b5bd-5492-8a69-97d32ab1161d'; END IF;
  INSERT INTO public.wiki_pages ("id", "wiki_id", "slug", "title", "content_markdown", "content_html", "created_by", "last_edited_by")
  VALUES ('46d2a946-56d8-5105-9e15-899ded2689be', 'dfdda271-b5bd-5492-8a69-97d32ab1161d', 'welcome', 'Welcome guide', 'Introduce yourself, read the room description, and keep personal information private.', '<p>Introduce yourself, read the room description, and keep personal information private.</p>', seed_owner, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.wikis SET page_count=page_count+1,edit_count=edit_count+1 WHERE id='dfdda271-b5bd-5492-8a69-97d32ab1161d'; UPDATE public.wiki_collaborators SET page_edit_count=page_edit_count+1 WHERE id='8433eb01-f060-5cb3-a38b-9fcb23d6f263'; END IF;
  INSERT INTO public.wiki_page_revisions ("id", "page_id", "revision_number", "title", "content_markdown", "edited_by", "edit_summary")
  VALUES ('27f252cd-1c06-563f-803c-aead471c7d3d', '46d2a946-56d8-5105-9e15-899ded2689be', 1, 'Welcome guide', 'Introduce yourself, read the room description, and keep personal information private.', seed_owner, 'Initial starter page')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.wiki_pages ("id", "wiki_id", "slug", "title", "content_markdown", "content_html", "created_by", "last_edited_by")
  VALUES ('8c566645-54f1-54be-9b93-ca65472a70ab', 'dfdda271-b5bd-5492-8a69-97d32ab1161d', 'sources', 'Checking a source', 'Read beyond the headline, check the original source, and distinguish evidence from opinion.', '<p>Read beyond the headline, check the original source, and distinguish evidence from opinion.</p>', seed_owner, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.wikis SET page_count=page_count+1,edit_count=edit_count+1 WHERE id='dfdda271-b5bd-5492-8a69-97d32ab1161d'; UPDATE public.wiki_collaborators SET page_edit_count=page_edit_count+1 WHERE id='8433eb01-f060-5cb3-a38b-9fcb23d6f263'; END IF;
  INSERT INTO public.wiki_page_revisions ("id", "page_id", "revision_number", "title", "content_markdown", "edited_by", "edit_summary")
  VALUES ('a0d299ea-82e2-558f-8041-920343ce60d7', '8c566645-54f1-54be-9b93-ca65472a70ab', 1, 'Checking a source', 'Read beyond the headline, check the original source, and distinguish evidence from opinion.', seed_owner, 'Initial starter page')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.wiki_pages ("id", "wiki_id", "slug", "title", "content_markdown", "content_html", "created_by", "last_edited_by")
  VALUES ('c7315e20-60d6-599c-bc60-6b9c8fb54859', 'dfdda271-b5bd-5492-8a69-97d32ab1161d', 'collaboration', 'Good collaboration', 'Explain your changes clearly. Give constructive feedback and acknowledge useful contributions.', '<p>Explain your changes clearly. Give constructive feedback and acknowledge useful contributions.</p>', seed_owner, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.wikis SET page_count=page_count+1,edit_count=edit_count+1 WHERE id='dfdda271-b5bd-5492-8a69-97d32ab1161d'; UPDATE public.wiki_collaborators SET page_edit_count=page_edit_count+1 WHERE id='8433eb01-f060-5cb3-a38b-9fcb23d6f263'; END IF;
  INSERT INTO public.wiki_page_revisions ("id", "page_id", "revision_number", "title", "content_markdown", "edited_by", "edit_summary")
  VALUES ('925bcbe2-8c03-556d-abe8-0518ffcdc4fe', 'c7315e20-60d6-599c-bc60-6b9c8fb54859', 1, 'Good collaboration', 'Explain your changes clearly. Give constructive feedback and acknowledge useful contributions.', seed_owner, 'Initial starter page')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 7. Free fictional Tale with three chapters and an editorial comment.
  INSERT INTO public.tales ("id", "author_id", "slug", "title", "synopsis", "status", "moderation", "default_price", "published_at")
  VALUES ('f349b082-6f48-5518-bdbc-8dbc103f2c0a', seed_owner, 'starter-the-lantern', 'The Lantern at the Junction', 'An original starter story about a small neighbourhood project.', 'published', 'approved', 0, now())
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.tales WHERE id='f349b082-6f48-5518-bdbc-8dbc103f2c0a' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter tales conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.tale_chapters ("id", "tale_id", "ordinal", "title", "body", "price", "status", "moderation")
  VALUES ('fd1f9f76-9677-517e-ab05-936656c6cf62', 'f349b082-6f48-5518-bdbc-8dbc103f2c0a', 1, 'A light goes out', 'At the junction, the old lantern had stopped working. Ada noticed how everyone hurried past the dark corner. She brought a notebook to the next community meeting and asked a simple question: what could they fix together?', 0, 'published', 'approved')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.tale_chapters ("id", "tale_id", "ordinal", "title", "body", "price", "status", "moderation")
  VALUES ('5acbbcda-b912-5ee1-8dc6-0fab880c91e8', 'f349b082-6f48-5518-bdbc-8dbc103f2c0a', 2, 'The plan', 'The neighbours listed what they had: time, tools, and a few useful skills. Rather than promise a grand transformation, they chose one small job. They would repair the lantern and leave clear notes for whoever maintained it next.', 0, 'published', 'approved')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.tale_chapters ("id", "tale_id", "ordinal", "title", "body", "price", "status", "moderation")
  VALUES ('81f86a51-f6a9-59ff-82af-01fcaf806ab6', 'f349b082-6f48-5518-bdbc-8dbc103f2c0a', 3, 'A brighter corner', 'On Saturday, the lantern shone again. Children stopped to admire it while the volunteers packed away their tools. Ada wrote the final line in her notebook: a community begins when someone asks, and grows when people answer.', 0, 'published', 'approved')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.tale_comments ("id", "user_id", "tale_id", "body")
  VALUES ('ab8a3c3b-72e6-5308-8ef4-75444419675a', seed_owner, 'f349b082-6f48-5518-bdbc-8dbc103f2c0a', 'Author’s discussion prompt: what small project would improve your own community?')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 8. Eight Q&A questions with honest zero vote totals and six editorial answers.
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('23d4ce3e-831e-585a-927a-615401f713d2', seed_owner, '00000000-0000-0000-0006-000000000001', 'What helps you feel welcome in a new community?', 'starter-welcome-question', 'Share one practical suggestion for welcoming new members.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='23d4ce3e-831e-585a-927a-615401f713d2' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('908f919d-a3cc-50ee-af3e-1ee7fa2175eb', '23d4ce3e-831e-585a-927a-615401f713d2', seed_owner, 'Read the room description, introduce yourself briefly, and ask an open question.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='23d4ce3e-831e-585a-927a-615401f713d2'; END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('4135b884-2543-5e7c-8e2f-3768a07a8eb1', seed_owner, '00000000-0000-0000-0006-000000000002', 'What makes a friendship feel balanced?', 'starter-friendship-question', 'What respectful habits help people maintain a friendship?')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='4135b884-2543-5e7c-8e2f-3768a07a8eb1' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('893b9d0e-8248-5714-8dd4-4bedd042c1e4', '4135b884-2543-5e7c-8e2f-3768a07a8eb1', seed_owner, 'Communicate expectations and respect each other’s boundaries and available time.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='4135b884-2543-5e7c-8e2f-3768a07a8eb1'; END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('41ac13dc-7253-5741-8490-a8f8efab2128', seed_owner, '00000000-0000-0000-0006-000000000003', 'How can you test a small business idea cheaply?', 'starter-business-question', 'Suggest a small experiment before committing a large budget.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='41ac13dc-7253-5741-8490-a8f8efab2128' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('df717306-77a2-5820-b0ea-2c389f358773', '41ac13dc-7253-5741-8490-a8f8efab2128', seed_owner, 'Talk to potential customers, test a small batch, and record your actual costs.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='41ac13dc-7253-5741-8490-a8f8efab2128'; END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('de662308-0a89-5c07-b95c-fc58a2e80589', seed_owner, '00000000-0000-0000-0006-000000000004', 'How do you choose a reliable budget phone?', 'starter-technology-question', 'Discuss practical features and repair support rather than advertising.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='de662308-0a89-5c07-b95c-fc58a2e80589' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('37a65098-13b2-50ad-a064-06fb41320c4d', 'de662308-0a89-5c07-b95c-fc58a2e80589', seed_owner, 'Compare update support, battery life, repair availability, and independent reviews.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='de662308-0a89-5c07-b95c-fc58a2e80589'; END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('4b495b02-1013-5e04-9121-5c228cbd7b22', seed_owner, '00000000-0000-0000-0006-000000000005', 'What makes a study routine easier to keep?', 'starter-study-question', 'Share a realistic study method you can sustain.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='4b495b02-1013-5e04-9121-5c228cbd7b22' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('a62eea6a-d7ec-589e-8fd6-bda8d82481ee', '4b495b02-1013-5e04-9121-5c228cbd7b22', seed_owner, 'Choose short, consistent sessions and review what you learned after each one.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='4b495b02-1013-5e04-9121-5c228cbd7b22'; END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('8b039e67-424a-550a-8769-b7c837a08748', seed_owner, '00000000-0000-0000-0006-000000000006', 'What music would you recommend for a community playlist?', 'starter-music-question', 'Name a track and explain why you like it.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='8b039e67-424a-550a-8769-b7c837a08748' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('b6ac9fe4-45ff-5ee0-ae0d-e474aba5fb12', seed_owner, '00000000-0000-0000-0006-000000000007', 'What makes a sporting team work well together?', 'starter-sports-question', 'Discuss teamwork and preparation without betting recommendations.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='b6ac9fe4-45ff-5ee0-ae0d-e474aba5fb12' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_questions ("id", "author_id", "category_id", "title", "slug", "body")
  VALUES ('d8ed4604-24fe-543e-b06b-8e23793a6522', seed_owner, '00000000-0000-0000-0006-000000000008', 'What small habit helps you unwind?', 'starter-wellbeing-question', 'Share a general wellbeing habit. This discussion is not medical advice.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.forum_questions WHERE id='d8ed4604-24fe-543e-b06b-8e23793a6522' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter forum_questions conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.forum_answers ("id", "question_id", "author_id", "body")
  VALUES ('e355115d-8c03-5e99-b99e-faa719693b89', 'd8ed4604-24fe-543e-b06b-8e23793a6522', seed_owner, 'A short walk, a regular bedtime, or a few quiet minutes can be a useful starting point.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.forum_questions SET answer_count=answer_count+1 WHERE id='d8ed4604-24fe-543e-b06b-8e23793a6522'; END IF;

  -- 9. Bulletin-board discussions and original posts; counters reflect inserted posts.
  SELECT id INTO board_id FROM public.bb_boards ORDER BY sort_order,id LIMIT 1;
  IF board_id IS NULL THEN RAISE EXCEPTION 'Run the full baseline first: forum boards are missing'; END IF;
  INSERT INTO public.bb_threads ("id", "board_id", "author_id", "title", "slug", "content_format")
  VALUES ('287e7135-85e3-5de6-911b-fa9b5b39ba9c', board_id, seed_owner, 'Introduce yourself', 'starter-introductions', 'plaintext')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET thread_count=thread_count+1 WHERE id=board_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bb_threads WHERE id='287e7135-85e3-5de6-911b-fa9b5b39ba9c' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter bb_threads conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.bb_posts ("id", "thread_id", "author_id", "body", "is_op")
  VALUES ('7b770c04-446e-56f4-b841-6c03c4505c05', '287e7135-85e3-5de6-911b-fa9b5b39ba9c', seed_owner, 'Tell the community what you enjoy learning. Keep private contact information out of public replies.', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET post_count=post_count+1 WHERE id=board_id; END IF;
  INSERT INTO public.bb_threads ("id", "board_id", "author_id", "title", "slug", "content_format")
  VALUES ('1298d6ae-a975-5f4a-a80b-63d5368447e7', board_id, seed_owner, 'What are you working on?', 'starter-projects', 'plaintext')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET thread_count=thread_count+1 WHERE id=board_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bb_threads WHERE id='1298d6ae-a975-5f4a-a80b-63d5368447e7' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter bb_threads conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.bb_posts ("id", "thread_id", "author_id", "body", "is_op")
  VALUES ('fbef8a92-eff1-595f-a1f2-f3e9e5600f6f', '1298d6ae-a975-5f4a-a80b-63d5368447e7', seed_owner, 'Share a small project and one question you would like help answering.', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET post_count=post_count+1 WHERE id=board_id; END IF;
  INSERT INTO public.bb_threads ("id", "board_id", "author_id", "title", "slug", "content_format")
  VALUES ('4dbc1389-f020-5982-8528-becc01ae0349', board_id, seed_owner, 'Useful resources', 'starter-recommendations', 'plaintext')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET thread_count=thread_count+1 WHERE id=board_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bb_threads WHERE id='4dbc1389-f020-5982-8528-becc01ae0349' AND author_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter bb_threads conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.bb_posts ("id", "thread_id", "author_id", "body", "is_op")
  VALUES ('618dfd17-f78a-53f1-be1b-051afe2fbc00', '4dbc1389-f020-5982-8528-becc01ae0349', seed_owner, 'Recommend a useful resource and explain who it is suitable for.', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_boards SET post_count=post_count+1 WHERE id=board_id; END IF;
  INSERT INTO public.bb_posts ("id", "thread_id", "author_id", "body")
  VALUES ('5659ab07-a950-5499-ab78-c4ab515c0a74', '287e7135-85e3-5de6-911b-fa9b5b39ba9c', seed_owner, 'Starter tip: respond to another person’s interests with a thoughtful question.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.bb_threads SET reply_count=reply_count+1 WHERE id='287e7135-85e3-5de6-911b-fa9b5b39ba9c'; UPDATE public.bb_boards SET post_count=post_count+1 WHERE id=board_id; END IF;

  -- 10. Four polls and three runnable quizzes. No invented votes or attempts.
  INSERT INTO public.polls ("id", "creator_id", "slug", "title", "description")
  VALUES ('0e88a4d2-9323-54b8-b3a1-c47958477a1d', seed_owner, 'starter-topics-poll', 'Which topic would you like to explore first?', 'Starter poll: choose the option that fits you.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.polls WHERE id='0e88a4d2-9323-54b8-b3a1-c47958477a1d' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter polls conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('16af342f-e533-597f-99e1-3229ca9fa266', '0e88a4d2-9323-54b8-b3a1-c47958477a1d', 'Learning', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('fa2507e3-ac90-59dc-a754-2e8a04e137f2', '0e88a4d2-9323-54b8-b3a1-c47958477a1d', 'Technology', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('095d1b0b-9115-5165-a8ee-a14daa685d0b', '0e88a4d2-9323-54b8-b3a1-c47958477a1d', 'Culture', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('d3b72ebf-efc0-5b11-8c3e-782b8a5cdd64', '0e88a4d2-9323-54b8-b3a1-c47958477a1d', 'Community', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.polls ("id", "creator_id", "slug", "title", "description")
  VALUES ('2e77a3ac-b691-56d5-b6cf-900b61d22a28', seed_owner, 'starter-learning-poll', 'How do you prefer to learn?', 'Starter poll: choose the option that fits you.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.polls WHERE id='2e77a3ac-b691-56d5-b6cf-900b61d22a28' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter polls conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('2e0b36e4-a27f-5cb1-aa51-db2191d50487', '2e77a3ac-b691-56d5-b6cf-900b61d22a28', 'Reading', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('ae935159-2574-5b9e-a07d-cc42aaa64299', '2e77a3ac-b691-56d5-b6cf-900b61d22a28', 'Practising', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('b1c9a713-dfff-5ad7-acde-1c36d7c4eed3', '2e77a3ac-b691-56d5-b6cf-900b61d22a28', 'Watching', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('79f86a00-d292-58b6-8e1a-d740d2ddb7db', '2e77a3ac-b691-56d5-b6cf-900b61d22a28', 'Discussing', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.polls ("id", "creator_id", "slug", "title", "description")
  VALUES ('376353e9-eb7c-584e-8ce6-1dcfea5d93ad', seed_owner, 'starter-community-poll', 'What makes a good community?', 'Starter poll: choose the option that fits you.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.polls WHERE id='376353e9-eb7c-584e-8ce6-1dcfea5d93ad' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter polls conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('c3c973e7-d24e-58a8-b353-a0708d9aec28', '376353e9-eb7c-584e-8ce6-1dcfea5d93ad', 'Helpful answers', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('91083481-9a3c-59e9-bd7f-99e5aa66d548', '376353e9-eb7c-584e-8ce6-1dcfea5d93ad', 'Respect', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('3c6d4c45-e954-5660-ab46-498650ad6596', '376353e9-eb7c-584e-8ce6-1dcfea5d93ad', 'Shared projects', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('97d37c73-991f-56bf-9eb5-176b6345467c', '376353e9-eb7c-584e-8ce6-1dcfea5d93ad', 'All of these', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.polls ("id", "creator_id", "slug", "title", "description")
  VALUES ('2dfc3968-c009-563b-b0ca-b361608feca0', seed_owner, 'starter-creative-poll', 'Which creative prompt would you try?', 'Starter poll: choose the option that fits you.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.polls WHERE id='2dfc3968-c009-563b-b0ca-b361608feca0' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter polls conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('22825660-eb8b-5220-a2a4-470594004168', '2dfc3968-c009-563b-b0ca-b361608feca0', 'Short story', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('a4de8452-7b6d-5bc3-91dc-01a49ddd7786', '2dfc3968-c009-563b-b0ca-b361608feca0', 'Photo walk', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('7634c3fc-b768-5b1d-a809-bd0db7e5010a', '2dfc3968-c009-563b-b0ca-b361608feca0', 'Poem', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.poll_options ("id", "poll_id", "label", "position")
  VALUES ('6aa75b46-3e45-52cf-acb0-931278983efd', '2dfc3968-c009-563b-b0ca-b361608feca0', 'Drawing', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quizzes ("id", "creator_id", "slug", "title", "description", "max_attempts_per_user")
  VALUES ('4b7d85d2-194e-544b-a66f-dce152406e1b', seed_owner, 'starter-safety-quiz', 'Digital safety basics', 'A short starter quiz with three questions.', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE id='4b7d85d2-194e-544b-a66f-dce152406e1b' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter quizzes conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('0451bb25-2b54-598b-afa1-b8bb785e4d09', '4b7d85d2-194e-544b-a66f-dce152406e1b', 0, 'Which information should stay private?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('4dd26541-001c-5794-8fe9-b3b6dce243ea', '0451bb25-2b54-598b-afa1-b8bb785e4d09', 'A one-time login code', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('49d0a210-93b5-5e46-a03f-adec829fcd36', '0451bb25-2b54-598b-afa1-b8bb785e4d09', 'A public book title', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('4d8f88be-51c9-5e9a-89ee-282bda3331c2', '0451bb25-2b54-598b-afa1-b8bb785e4d09', 'A weather forecast', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('caa386ae-ba5c-5459-be9e-4c73560277af', '0451bb25-2b54-598b-afa1-b8bb785e4d09', 'A published article', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('a40d5643-f747-5bee-bb96-0304b6846b4e', '4b7d85d2-194e-544b-a66f-dce152406e1b', 1, 'What is a good password habit?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('7ebe5b61-58f4-5cf1-b0ae-9cac6abcaf75', 'a40d5643-f747-5bee-bb96-0304b6846b4e', 'Reuse one everywhere', 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('e1c10099-e8b5-58d0-bc6d-813b28b83c9e', 'a40d5643-f747-5bee-bb96-0304b6846b4e', 'Use unique passwords', 1, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('e5696fd4-7a29-5da7-9ee7-0c12a05dd1fc', 'a40d5643-f747-5bee-bb96-0304b6846b4e', 'Share it with helpers', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('1a0d16cb-e5c3-5dfa-b283-ef268b958dc1', 'a40d5643-f747-5bee-bb96-0304b6846b4e', 'Put it in your bio', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('ea688bd0-46c2-5509-bc97-c0b975b3c4d5', '4b7d85d2-194e-544b-a66f-dce152406e1b', 2, 'Before following a suspicious sign-in link, what should you do?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('d09b2dae-31c2-5634-b5b7-7a1b4d69c389', 'ea688bd0-46c2-5509-bc97-c0b975b3c4d5', 'Open the service directly', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('a215124a-00da-5d12-bf30-7c16659fb441', 'ea688bd0-46c2-5509-bc97-c0b975b3c4d5', 'Share your code', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('e3ce0ded-b9d6-545c-9553-df1eaac7723e', 'ea688bd0-46c2-5509-bc97-c0b975b3c4d5', 'Disable protection', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('c0d55d76-86a3-5139-bf60-a824c7ba325d', 'ea688bd0-46c2-5509-bc97-c0b975b3c4d5', 'Reply with your password', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quizzes ("id", "creator_id", "slug", "title", "description", "max_attempts_per_user")
  VALUES ('f48ae854-e612-5648-a4a4-9ab5c049b51b', seed_owner, 'starter-community-quiz', 'Community basics', 'A short starter quiz with three questions.', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE id='f48ae854-e612-5648-a4a4-9ab5c049b51b' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter quizzes conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('c33d4792-9610-5177-95c5-ea85882be7a9', 'f48ae854-e612-5648-a4a4-9ab5c049b51b', 0, 'What makes feedback useful?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('c5e8a9e6-fa95-53cf-addc-a0a0badc76ce', 'c33d4792-9610-5177-95c5-ea85882be7a9', 'Personal insults', 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('e31f6fa5-4409-54e7-835d-86c993d7f9b0', 'c33d4792-9610-5177-95c5-ea85882be7a9', 'Specific and respectful suggestions', 1, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('56f5c87b-e33f-52cf-b5b2-3f2dabd6da74', 'c33d4792-9610-5177-95c5-ea85882be7a9', 'Posting private messages', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('261ac1d3-d7fc-5808-8a28-a172cdb56d3c', 'c33d4792-9610-5177-95c5-ea85882be7a9', 'Guessing someone’s motives', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('f6eab10c-6735-5c70-ac49-1cfe22935bc0', 'f48ae854-e612-5648-a4a4-9ab5c049b51b', 1, 'Before sharing another person’s private photo, you should:', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('3d92125d-829b-5608-9200-f2e460ad763e', 'f6eab10c-6735-5c70-ac49-1cfe22935bc0', 'Ask permission', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('b34b19c9-63da-57c9-b3e8-ede40ec01ffb', 'f6eab10c-6735-5c70-ac49-1cfe22935bc0', 'Post it quickly', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('bec6a9be-d02b-5391-a189-d3fd9b15e557', 'f6eab10c-6735-5c70-ac49-1cfe22935bc0', 'Tag strangers', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('4730db06-407e-56b6-89e1-496c523f4fd9', 'f6eab10c-6735-5c70-ac49-1cfe22935bc0', 'Remove the context', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('7d2ce10c-d398-54bd-b6c7-97e32e3497be', 'f48ae854-e612-5648-a4a4-9ab5c049b51b', 2, 'When you see suspected spam, you should:', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('662f270f-d76b-5796-89ca-f7e05c7e1b3a', '7d2ce10c-d398-54bd-b6c7-97e32e3497be', 'Report it', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('785c285e-8f98-5177-9e66-931bca170378', '7d2ce10c-d398-54bd-b6c7-97e32e3497be', 'Share your password', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('2b155480-4547-5321-9cdd-79b808586d6b', '7d2ce10c-d398-54bd-b6c7-97e32e3497be', 'Send money', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('3622958a-b030-5087-b721-bb6ca740f89b', '7d2ce10c-d398-54bd-b6c7-97e32e3497be', 'Copy it everywhere', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quizzes ("id", "creator_id", "slug", "title", "description", "max_attempts_per_user")
  VALUES ('be079ea1-f385-5b04-b7c8-8b369d68ea7f', seed_owner, 'starter-learning-quiz', 'Learning skills', 'A short starter quiz with three questions.', 3)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE id='be079ea1-f385-5b04-b7c8-8b369d68ea7f' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter quizzes conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('9e1ee63f-a502-5fd6-8cc2-7d54e6f00eb7', 'be079ea1-f385-5b04-b7c8-8b369d68ea7f', 0, 'Which goal is most practical?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('868d7814-9611-5439-8a9e-e210d740fb2c', '9e1ee63f-a502-5fd6-8cc2-7d54e6f00eb7', 'Learn everything today', 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('c1a78286-b7f8-5758-a99e-c7a3f62e9649', '9e1ee63f-a502-5fd6-8cc2-7d54e6f00eb7', 'Practise one skill for fifteen minutes', 1, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('1851e116-170c-5c67-aec9-ff520118d41e', '9e1ee63f-a502-5fd6-8cc2-7d54e6f00eb7', 'Never ask questions', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('56989984-3683-50f6-9aa8-75823a1f6ca8', '9e1ee63f-a502-5fd6-8cc2-7d54e6f00eb7', 'Skip all feedback', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('9375989a-66ad-55e2-a041-c2b0aeaaacde', 'be079ea1-f385-5b04-b7c8-8b369d68ea7f', 1, 'How can you test understanding?', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('8db2cc9b-d1a1-5fd4-806d-d887d0547fc5', '9375989a-66ad-55e2-a041-c2b0aeaaacde', 'Explain it in your own words', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('53860a0b-4c97-5014-ab60-2c2a92ca23c3', '9375989a-66ad-55e2-a041-c2b0aeaaacde', 'Only reread the title', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('c1b54d85-48d9-5b38-90c1-c7285df1dd1d', '9375989a-66ad-55e2-a041-c2b0aeaaacde', 'Avoid practising', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('15083b11-78dc-5ec8-9e5f-d0b2e2cbdf1c', '9375989a-66ad-55e2-a041-c2b0aeaaacde', 'Memorise an unknown phrase', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_questions ("id", "quiz_id", "position", "prompt", "points")
  VALUES ('d59148c3-5e7c-5608-92a1-926856ef8b90', 'be079ea1-f385-5b04-b7c8-8b369d68ea7f', 2, 'When comparing sources, look for:', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('c3fcb7c5-759a-5d89-a06d-8dca67745d52', 'd59148c3-5e7c-5608-92a1-926856ef8b90', 'Evidence and original context', 0, true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('22e5a101-1bb0-5137-a7bd-562b2aea325a', 'd59148c3-5e7c-5608-92a1-926856ef8b90', 'Only a dramatic headline', 1, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('778cfc10-8d68-5bb0-8aa3-7d574fb5523c', 'd59148c3-5e7c-5608-92a1-926856ef8b90', 'The loudest comment', 2, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quiz_question_options ("id", "question_id", "label", "position", "is_correct")
  VALUES ('609ff5c9-05b9-5506-86b0-a64e3315e496', 'd59148c3-5e7c-5608-92a1-926856ef8b90', 'The most emojis', 3, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 11. A portal joining starter content by a real hashtag. No fake engagement.
  INSERT INTO public.hashtags ("id", "slug", "display")
  VALUES ('053d81c1-f746-511c-8323-f2dd503c3faa', 'zobiastarters', 'ZobiaStarters')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.hashtags WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa' AND slug='zobiastarters') THEN
    RAISE EXCEPTION 'Starter hashtags conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.portals ("id", "slug", "hashtag_id", "title", "tagline", "status", "created_by", "accent_color", "sections")
  VALUES ('1bd03d3c-bc8a-5d9a-9141-932c0ec66087', 'zobiastarters', '053d81c1-f746-511c-8323-f2dd503c3faa', 'Zobia Starters', 'A starting point for community and learning', 'official', seed_owner, '#2563eb', '[{"key":"feed","enabled":true},{"key":"rooms","enabled":true},{"key":"guilds","enabled":true},{"key":"people","enabled":true},{"key":"forum","enabled":true},{"key":"questions","enabled":true},{"key":"wiki","enabled":true},{"key":"blogs","enabled":true},{"key":"polls","enabled":true}]'::jsonb)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.portals WHERE id='1bd03d3c-bc8a-5d9a-9141-932c0ec66087' AND created_by=seed_owner) THEN
    RAISE EXCEPTION 'Starter portals conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('1d37671c-c53e-5999-ab0f-355c10ad5e1c', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', 'b2e30527-df07-55e7-b38b-75ccfd841d37', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('0aa1b74a-7a57-540e-9989-b54063b2c2f0', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', 'ebc9b9e2-8514-519d-8520-97ef7c348886', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('362ec77d-9268-5ad7-b33e-e7ef2e732b20', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', '76e44fb6-aa3e-5afb-9225-486e958e8a22', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('a0f6b04f-30fc-55af-8e31-afebe9fe8bd6', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', '7bc720e8-ca6d-5f8b-b1e1-e6e178feab12', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('8e6511ed-4b41-5d25-9387-c55b726daa74', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', '74fa1d3e-f0a8-5fb2-b7b4-bde92d9a3498', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('9a3b535c-8087-5ed1-bff4-f31c54bba2b7', '053d81c1-f746-511c-8323-f2dd503c3faa', 'tweet', '9d016320-b6e9-54bb-ae0c-61f12e98bcf6', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('ce4e6029-7be1-53f3-9b29-a43775f7f877', '053d81c1-f746-511c-8323-f2dd503c3faa', 'room', 'df33d98b-6eb6-5d99-9ca8-32e62fa7b72c', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('46f29cc8-1dc3-500b-a230-1c74a9efeadc', '053d81c1-f746-511c-8323-f2dd503c3faa', 'classroom', '904d69db-4d09-57a9-af80-87dd0d38384d', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('d4793576-b98d-5fdb-8620-a907d221a5cd', '053d81c1-f746-511c-8323-f2dd503c3faa', 'blog_post', '7264030b-9b7e-5344-b038-5d0edf02244f', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('a2fb2e23-cb2b-568a-b8a0-416d69aa080e', '053d81c1-f746-511c-8323-f2dd503c3faa', 'forum_thread', '287e7135-85e3-5de6-911b-fa9b5b39ba9c', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('bb2b74dd-1d78-5ee9-9c65-025db04f7ba0', '053d81c1-f746-511c-8323-f2dd503c3faa', 'forum_question', '23d4ce3e-831e-585a-927a-615401f713d2', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('38e89426-9878-531c-9b79-f416b9eefd1d', '053d81c1-f746-511c-8323-f2dd503c3faa', 'wiki_page', '46d2a946-56d8-5105-9e15-899ded2689be', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('a70cfe99-da61-55e3-b027-a1964175bc0b', '053d81c1-f746-511c-8323-f2dd503c3faa', 'poll', '0e88a4d2-9323-54b8-b3a1-c47958477a1d', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;
  INSERT INTO public.content_hashtags ("id", "hashtag_id", "content_type", "content_id", "author_id")
  VALUES ('0ce72199-3eff-5170-ba88-89c85d7f308c', '053d81c1-f746-511c-8323-f2dd503c3faa', 'quiz', '4b7d85d2-194e-544b-a66f-dce152406e1b', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN UPDATE public.hashtags SET use_count=use_count+1,last_used_at=now() WHERE id='053d81c1-f746-511c-8323-f2dd503c3faa'; END IF;

  -- 12. Optional business-page drafts only for an already-owned active business account.
  SELECT id INTO business_id FROM public.business_accounts WHERE user_id=seed_owner AND status='active' FOR UPDATE;
  IF business_id IS NOT NULL THEN
  INSERT INTO public.business_pages ("id", "business_account_id", "slug", "name", "bio", "status")
  VALUES ('e4c6a5a8-6bb8-5a8d-9c9c-cf8bd5fcec9e', business_id, 'starter-business-page', 'Starter Business Page', 'Draft starter page. Replace with your real business information.', 'deactivated')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.business_pages WHERE id='e4c6a5a8-6bb8-5a8d-9c9c-cf8bd5fcec9e' AND business_account_id=business_id) THEN
    RAISE EXCEPTION 'Starter business_pages conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.business_page_posts ("id", "page_id", "title", "body", "status")
  VALUES ('204be28e-c51e-53ea-9893-9fb1e4eccd36', 'e4c6a5a8-6bb8-5a8d-9c9c-cf8bd5fcec9e', 'Meet the team', 'Draft example: replace this text with accurate business information before publishing.', 'draft')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.business_page_posts ("id", "page_id", "title", "body", "status")
  VALUES ('a47207c9-83b6-567a-909b-8f6b0ac70480', 'e4c6a5a8-6bb8-5a8d-9c9c-cf8bd5fcec9e', 'What we offer', 'Draft example: replace this text with accurate business information before publishing.', 'draft')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.business_page_posts ("id", "page_id", "title", "body", "status")
  VALUES ('993d1b86-d51d-540c-b2b2-b15fa2cf74c1', 'e4c6a5a8-6bb8-5a8d-9c9c-cf8bd5fcec9e', 'How to reach us', 'Draft example: replace this text with accurate business information before publishing.', 'draft')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  ELSE RAISE NOTICE 'Business-page examples skipped: the owner has no active business account. No paid entitlement was created.'; END IF;

  -- 13. Merch drafts: no live stock, download promises, orders or payment records.
  IF NOT EXISTS (SELECT 1 FROM public.merch_stores WHERE creator_id=seed_owner AND id<>'1afea2b9-9a10-5c43-ae97-8a36f4dea6d0') THEN
  INSERT INTO public.merch_stores ("id", "creator_id", "name", "description", "is_active", "physical_goods_enabled")
  VALUES ('1afea2b9-9a10-5c43-ae97-8a36f4dea6d0', seed_owner, 'Starter Store Draft', 'Review products, fulfilment and pricing before enabling.', false, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.merch_stores WHERE id='1afea2b9-9a10-5c43-ae97-8a36f4dea6d0' AND creator_id=seed_owner) THEN
    RAISE EXCEPTION 'Starter merch_stores conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.merch_products ("id", "store_id", "name", "description", "product_type", "price_kobo", "is_active", "stock")
  VALUES ('fb4ec82e-33f5-5151-9717-2eab43935349', '1afea2b9-9a10-5c43-ae97-8a36f4dea6d0', 'Digital resource draft', 'Example listing only. Supply the actual item, image, price and delivery process before activation.', 'digital', 0, false, 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.merch_products ("id", "store_id", "name", "description", "product_type", "price_kobo", "is_active", "stock")
  VALUES ('44e52a6f-363a-5ca8-ae92-2906c46eb945', '1afea2b9-9a10-5c43-ae97-8a36f4dea6d0', 'Community notebook draft', 'Example listing only. Supply the actual item, image, price and delivery process before activation.', 'physical', 0, false, 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.merch_products ("id", "store_id", "name", "description", "product_type", "price_kobo", "is_active", "stock")
  VALUES ('af214810-f1be-5168-ae89-79cac395e16d', '1afea2b9-9a10-5c43-ae97-8a36f4dea6d0', 'Course workbook draft', 'Example listing only. Supply the actual item, image, price and delivery process before activation.', 'course_material', 0, false, 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  ELSE RAISE NOTICE 'Merch examples skipped: the owner already has a store; it was left unchanged.'; END IF;

  -- 14. Reaction packs. Fixed child IDs prevent duplicates on reruns.
  INSERT INTO public.reaction_sets ("id", "name", "description", "preview_emoji", "coin_price")
  VALUES ('a010cc43-1670-5fe7-90c4-29f57278a55e', 'Starter Encouragement', 'Optional starter reaction pack.', '🌟', 100)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('e24250a9-d242-59e1-a9da-7a0fb070e58c', 'a010cc43-1670-5fe7-90c4-29f57278a55e', '🌟', 'Great start', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('e1e9bf4d-974a-57f4-82d9-5775e3ffee6a', 'a010cc43-1670-5fe7-90c4-29f57278a55e', '👏', 'Well done', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('0902d782-99ba-5ebf-90cc-f744dea6a961', 'a010cc43-1670-5fe7-90c4-29f57278a55e', '💡', 'Useful idea', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_sets ("id", "name", "description", "preview_emoji", "coin_price")
  VALUES ('d3105d89-2752-588d-b3f9-b0f16ec4e6cc', 'Starter Celebration', 'Optional starter reaction pack.', '🎉', 200)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('72c96635-4742-5268-b40f-5f8aa7bcaebe', 'd3105d89-2752-588d-b3f9-b0f16ec4e6cc', '🎉', 'Celebrate', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('4991ae7b-e50f-589c-add5-917ff18f5111', 'd3105d89-2752-588d-b3f9-b0f16ec4e6cc', '🙌', 'Team effort', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('6fe388eb-32f5-5581-a6c0-092130504fc0', 'd3105d89-2752-588d-b3f9-b0f16ec4e6cc', '✨', 'Bright idea', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_sets ("id", "name", "description", "preview_emoji", "coin_price")
  VALUES ('05e544a2-a96e-5b24-beed-91afc1bb0e21', 'Starter Focus', 'Optional starter reaction pack.', '📚', 300)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('97002e3a-1785-519c-9b25-18d5a9d000f4', '05e544a2-a96e-5b24-beed-91afc1bb0e21', '📚', 'Learning', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('c5b8a5a2-df58-5562-ab7e-bab2176c85ad', '05e544a2-a96e-5b24-beed-91afc1bb0e21', '🎯', 'On target', 1)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.reaction_set_items ("id", "set_id", "emoji", "name", "sort_order")
  VALUES ('34315299-22d9-55eb-a60d-2cea143c97ef', '05e544a2-a96e-5b24-beed-91afc1bb0e21', '🛠️', 'Building', 2)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 15. Welcome banner, draft modal, notices and council idea. No fabricated rewards.
  INSERT INTO public.announcement_banners ("id", "title", "content", "content_type", "is_active", "starts_at", "ends_at", "link_url", "created_by")
  VALUES ('0c31aaa4-1d9b-5095-9c9f-5ebadb64701f', 'Welcome to Zobia', 'Explore a room, answer a question, or try a starter quiz.', 'text', true, now(), now()+interval '7 days', '/rooms', seed_owner::text)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.announcement_modals ("id", "title", "content", "content_type", "is_active", "created_by")
  VALUES ('6271cced-68a5-5a5f-aadd-3551d0396958', 'Welcome guide — draft', 'Welcome! Choose a topic, read the community guidelines, and explore at your own pace.', 'text', false, seed_owner::text)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.notices ("id", "title", "body", "cta_label", "cta_url", "created_by")
  VALUES ('f1369553-f8e0-5ca7-ba39-23dc2d6662d6', 'Find your first room', 'Explore a topic and introduce yourself.', 'Explore', '/rooms', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.notices ("id", "title", "body", "cta_label", "cta_url", "created_by")
  VALUES ('27aa66ba-6487-505d-8e85-65e3ba1dbee9', 'Ask a useful question', 'Specific questions make it easier for others to help.', 'Explore', '/answers', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.platform_council_ideas ("id", "author_id", "title", "description")
  VALUES ('bbf24592-ff8e-52da-8e54-bc743fb0b07c', seed_owner, 'Help newcomers find useful discussions', 'Starter proposal: collect feedback on which introductions and guides help new members most. No votes have been prefilled.')
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 16. Season and event drafts, anchored to the installation date and inactive.
  INSERT INTO public.seasons ("id", "name", "theme", "description", "season_number", "starts_at", "ends_at", "is_active", "status", "created_by")
  VALUES ('c950ea57-4e3e-50e7-a8a5-b741c7f6e6e0', 'Starter Season Draft', 'Community beginnings', 'Review dates, price, rewards and rules before activation.', (SELECT COALESCE(MAX(season_number),0)+1 FROM public.seasons), now()+interval '7 days', now()+interval '63 days', false, 'draft', seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id='c950ea57-4e3e-50e7-a8a5-b741c7f6e6e0' AND created_by=seed_owner) THEN
    RAISE EXCEPTION 'Starter seasons conflicts with existing content. No seed changes were committed; keep the existing content and resolve the reserved name/ID first.';
  END IF;
  INSERT INTO public.platform_events ("id", "name", "description", "event_type", "starts_at", "ends_at", "xp_multiplier", "is_active", "created_by")
  VALUES ('95528046-a0e3-5ff3-a13e-22bed6e392fd', 'Starter Draft — Africa Day', 'Draft calendar example. Review the date and content before enabling.', 'cultural', (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,5,25)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,5,25)::timestamp AT TIME ZONE 'UTC'), (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,5,25)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,5,25)::timestamp AT TIME ZONE 'UTC')+interval '1 day', 1, false, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.platform_events ("id", "name", "description", "event_type", "starts_at", "ends_at", "xp_multiplier", "is_active", "created_by")
  VALUES ('2ef0a0e3-36bb-54b3-9038-e586f565ef44', 'Starter Draft — Nigeria Independence Day', 'Draft calendar example. Review the date and content before enabling.', 'cultural', (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,10,1)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,10,1)::timestamp AT TIME ZONE 'UTC'), (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,10,1)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,10,1)::timestamp AT TIME ZONE 'UTC')+interval '1 day', 1, false, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.platform_events ("id", "name", "description", "event_type", "starts_at", "ends_at", "xp_multiplier", "is_active", "created_by")
  VALUES ('04edd60f-821e-549d-9fea-bc8366d401d7', 'Starter Draft — Community Year-End Reflection', 'Draft calendar example. Review the date and content before enabling.', 'cultural', (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,12,31)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,12,31)::timestamp AT TIME ZONE 'UTC'), (make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int+CASE WHEN make_date(EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int,12,31)<(now() AT TIME ZONE 'UTC')::date THEN 1 ELSE 0 END,12,31)::timestamp AT TIME ZONE 'UTC')+interval '1 day', 1, false, seed_owner)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.flash_xp_events ("id", "name", "description", "multiplier", "fires_at", "ends_at", "is_active")
  VALUES ('1d391490-7c5d-5653-8909-cb940876d692', 'Starter Flash Event Draft', 'Draft only: review scheduling and multiplier before activation.', 1, now()+interval '7 days', now()+interval '7 days 1 hour', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 17. Advertising and sponsored-quest drafts: unfunded, inactive, unapproved.
  INSERT INTO public.ad_campaigns ("id", "owner_type", "created_by", "advertiser_type", "advertiser_user_id", "name", "status", "moderation_status", "total_budget_credits")
  VALUES ('054a686c-717b-5ebf-9f5c-726eea56f803', 'admin', seed_owner, 'personal', seed_owner, 'Starter Awareness Draft', 'draft', 'pending', 0)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.ad_creatives ("id", "campaign_id", "placement_key", "format", "size", "title", "body", "click_url", "is_active")
  VALUES ('1c52f425-4638-5f97-80dc-5467f2378ccf', '054a686c-717b-5ebf-9f5c-726eea56f803', (SELECT key FROM public.ad_placements ORDER BY key LIMIT 1), 'text', 'native', 'Explore the community', 'Draft creative. Review copy, placement and destination before use.', '/rooms', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.sponsored_quests ("id", "brand_name", "title", "description", "target_action", "target_value", "reward_coins", "creator_payout_kobo", "platform_fee_kobo", "is_active", "moderation_status", "owner_user_id", "submitted_by", "total_budget_credits", "is_daily_quest_eligible")
  VALUES ('19d1b7eb-f500-54e2-b913-783c803a6dbd', 'Draft — Your Brand', 'Starter community campaign', 'Unfunded example. Configure a real sponsor, budget, reward and moderation approval before activation.', 'room_join', 1, 0, 0, 0, false, 'pending', seed_owner, seed_owner, 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.sponsored_quests ("id", "brand_name", "title", "description", "target_action", "target_value", "reward_coins", "creator_payout_kobo", "platform_fee_kobo", "is_active", "moderation_status", "owner_user_id", "submitted_by", "total_budget_credits", "is_daily_quest_eligible")
  VALUES ('864f9861-a7ca-5d70-851d-c8ffb0532822', 'Draft — Your Brand', 'Starter quiz campaign', 'Unfunded example. Configure a real sponsor, budget, reward and moderation approval before activation.', 'quiz_complete', 1, 0, 0, 0, false, 'pending', seed_owner, seed_owner, 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.sponsored_quests ("id", "brand_name", "title", "description", "target_action", "target_value", "reward_coins", "creator_payout_kobo", "platform_fee_kobo", "is_active", "moderation_status", "owner_user_id", "submitted_by", "total_budget_credits", "is_daily_quest_eligible")
  VALUES ('ef8519c3-b270-5bca-9389-76821276c8b3', 'Draft — Your Brand', 'Starter writing campaign', 'Unfunded example. Configure a real sponsor, budget, reward and moderation approval before activation.', 'blog_publish', 1, 0, 0, 0, false, 'pending', seed_owner, seed_owner, 0, false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  -- 18. Eighty daily quest templates: four targets per existing wired action.
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('b11bb546-549f-53bc-b9b3-565212c89bc6', 'Starter: Conversation 1', 'Send 1 message today. Only successful server-recorded actions count.', 'messages', 1, 25, 0, 'social', 'social', NULL, '💬', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('e6b4bbf3-4b21-5708-a089-742fc34949f3', 'Starter: Conversation 2', 'Send 3 messages today. Only successful server-recorded actions count.', 'messages', 3, 35, 0, 'social', 'social', NULL, '💬', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('f00630e7-ab30-54be-8761-3270a3d17591', 'Starter: Conversation 3', 'Send 5 messages today. Only successful server-recorded actions count.', 'messages', 5, 50, 0, 'social', 'social', NULL, '💬', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('69c7d552-15b8-5850-8f6e-bfaa642dd81e', 'Starter: Conversation 4', 'Send 10 messages today. Only successful server-recorded actions count.', 'messages', 10, 75, 0, 'social', 'social', NULL, '💬', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('f0c467c1-cb5d-5164-aff5-d19d0d0fad25', 'Starter: Room discovery 1', 'Join 1 room today. Only successful server-recorded actions count.', 'room_join', 1, 25, 0, 'explorer', 'explorer', 'rooms', '🚪', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('226b7333-7f56-5633-8bb3-d843041284bf', 'Starter: Room discovery 2', 'Join 2 rooms today. Only successful server-recorded actions count.', 'room_join', 2, 35, 0, 'explorer', 'explorer', 'rooms', '🚪', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('b0d2557d-49f0-5670-9054-ed0538c860ce', 'Starter: Room discovery 3', 'Join 3 rooms today. Only successful server-recorded actions count.', 'room_join', 3, 50, 0, 'explorer', 'explorer', 'rooms', '🚪', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('9740fbcc-8039-507d-83f8-d718614c0752', 'Starter: Room discovery 4', 'Join 4 rooms today. Only successful server-recorded actions count.', 'room_join', 4, 75, 0, 'explorer', 'explorer', 'rooms', '🚪', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('a38417a9-754e-57d1-b74c-f7f9b27b4253', 'Starter: Thoughtful gifting 1', 'Send 1 gift today. Only successful server-recorded actions count.', 'gift', 1, 25, 0, 'generosity', 'generosity', 'gifts', '🎁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5b2078e1-4a38-5a84-bded-85beb3f1ceb2', 'Starter: Thoughtful gifting 2', 'Send 2 gifts today. Only successful server-recorded actions count.', 'gift', 2, 35, 0, 'generosity', 'generosity', 'gifts', '🎁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('645fa139-3a0b-5d77-9c13-de86589d051f', 'Starter: Thoughtful gifting 3', 'Send 3 gifts today. Only successful server-recorded actions count.', 'gift', 3, 50, 0, 'generosity', 'generosity', 'gifts', '🎁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('665959f6-c44e-532c-ab96-e2fb6d777417', 'Starter: Thoughtful gifting 4', 'Send 4 gifts today. Only successful server-recorded actions count.', 'gift', 4, 75, 0, 'generosity', 'generosity', 'gifts', '🎁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('ec156b80-8cda-5ced-9376-b2cd05d31ad2', 'Starter: Daily return 1', 'Reach a 1-day login streak today. Only successful server-recorded actions count.', 'login_streak', 1, 25, 0, 'explorer', 'explorer', NULL, '📅', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('e100e4e3-4064-5bd7-b9b2-d1de133a1145', 'Starter: Daily return 2', 'Reach a 1-day login streak today. Only successful server-recorded actions count.', 'login_streak', 1, 25, 0, 'explorer', 'explorer', NULL, '📅', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('16be57dc-174a-5e88-8b5c-38c1974e58f1', 'Starter: Daily return 3', 'Reach a 1-day login streak today. Only successful server-recorded actions count.', 'login_streak', 1, 25, 0, 'explorer', 'explorer', NULL, '📅', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('4d82787e-bd9f-552f-a042-7cfc52e7c6ca', 'Starter: Daily return 4', 'Reach a 1-day login streak today. Only successful server-recorded actions count.', 'login_streak', 1, 25, 0, 'explorer', 'explorer', NULL, '📅', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('464894b6-988b-583e-9fca-1e071e80655d', 'Starter: Guild contribution 1', 'Make 1 guild quest contributions today. Only successful server-recorded actions count.', 'guild_quest', 1, 25, 0, 'social', 'social', NULL, '🛡️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('d9274326-9d26-5511-8277-fece4481aa56', 'Starter: Guild contribution 2', 'Make 3 guild quest contributions today. Only successful server-recorded actions count.', 'guild_quest', 3, 35, 0, 'social', 'social', NULL, '🛡️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5a81d495-e991-5d8b-af6c-bc67b526afc1', 'Starter: Guild contribution 3', 'Make 5 guild quest contributions today. Only successful server-recorded actions count.', 'guild_quest', 5, 50, 0, 'social', 'social', NULL, '🛡️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('51a6e558-bbd1-567c-8a13-29952ce06edc', 'Starter: Guild contribution 4', 'Make 10 guild quest contributions today. Only successful server-recorded actions count.', 'guild_quest', 10, 75, 0, 'social', 'social', NULL, '🛡️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('89c273b8-a88f-565f-b7e3-f40eb81610fa', 'Starter: Experience milestone 1', 'Earn 50 XP today. Only successful server-recorded actions count.', 'xp_meta', 50, 0, 0, 'main', 'main', NULL, '✨', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('fa02729d-f654-503e-b3b1-7f989d1607f7', 'Starter: Experience milestone 2', 'Earn 100 XP today. Only successful server-recorded actions count.', 'xp_meta', 100, 0, 0, 'main', 'main', NULL, '✨', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('a3b50c6f-8b0b-5ef3-bc5c-3835d32ca2d0', 'Starter: Experience milestone 3', 'Earn 200 XP today. Only successful server-recorded actions count.', 'xp_meta', 200, 0, 0, 'main', 'main', NULL, '✨', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('c8e3e860-ae3a-55a2-b1d3-cea978c4b14a', 'Starter: Experience milestone 4', 'Earn 500 XP today. Only successful server-recorded actions count.', 'xp_meta', 500, 0, 0, 'main', 'main', NULL, '✨', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bfabc175-94ad-5d6e-a0f5-a13e390dd544', 'Starter: Verified game play 1', 'Finish 1 server-verified game rounds today. Only successful server-recorded actions count.', 'game_play', 1, 25, 0, 'gaming', 'gaming', 'games', '🎮', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('61033bfb-0175-5ee2-a5c0-b7f07af0f5f8', 'Starter: Verified game play 2', 'Finish 2 server-verified game rounds today. Only successful server-recorded actions count.', 'game_play', 2, 35, 0, 'gaming', 'gaming', 'games', '🎮', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('9cc3a799-121d-51e0-b761-f10076f89db4', 'Starter: Verified game play 3', 'Finish 3 server-verified game rounds today. Only successful server-recorded actions count.', 'game_play', 3, 50, 0, 'gaming', 'gaming', 'games', '🎮', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('59c1fa7a-4a3e-5375-8d72-090a204ba37b', 'Starter: Verified game play 4', 'Finish 5 server-verified game rounds today. Only successful server-recorded actions count.', 'game_play', 5, 75, 0, 'gaming', 'gaming', 'games', '🎮', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('88746544-c278-5907-95ee-76ccbb0ae69e', 'Starter: Friendly challenge 1', 'Send 1 challenge today. Only successful server-recorded actions count.', 'challenge_send', 1, 25, 0, 'competitor', 'competitor', 'games', '🏁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('829b4a25-14d8-57ea-a095-1f8c7248c5ae', 'Starter: Friendly challenge 2', 'Send 2 challenges today. Only successful server-recorded actions count.', 'challenge_send', 2, 35, 0, 'competitor', 'competitor', 'games', '🏁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('9bffb1f0-a7d9-528e-bd44-8717bf727502', 'Starter: Friendly challenge 3', 'Send 3 challenges today. Only successful server-recorded actions count.', 'challenge_send', 3, 50, 0, 'competitor', 'competitor', 'games', '🏁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5c876215-bcb7-564f-900c-2d1c623921b0', 'Starter: Friendly challenge 4', 'Send 4 challenges today. Only successful server-recorded actions count.', 'challenge_send', 4, 75, 0, 'competitor', 'competitor', 'games', '🏁', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('35181842-6253-5e20-99d9-91ad8f7de2e8', 'Starter: Accept a challenge 1', 'Accept 1 challenge today. Only successful server-recorded actions count.', 'challenge_accept', 1, 25, 0, 'competitor', 'competitor', 'games', '🤝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('a2722cf5-dae7-5285-973c-d1f4b204fd9f', 'Starter: Accept a challenge 2', 'Accept 2 challenges today. Only successful server-recorded actions count.', 'challenge_accept', 2, 35, 0, 'competitor', 'competitor', 'games', '🤝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('4871e45c-bcae-596d-b840-9a6782f4a310', 'Starter: Accept a challenge 3', 'Accept 3 challenges today. Only successful server-recorded actions count.', 'challenge_accept', 3, 50, 0, 'competitor', 'competitor', 'games', '🤝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('2eaffe63-c160-59ed-afe9-db04e8c50e89', 'Starter: Accept a challenge 4', 'Accept 4 challenges today. Only successful server-recorded actions count.', 'challenge_accept', 4, 75, 0, 'competitor', 'competitor', 'games', '🤝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('59a29ef1-c888-5f09-92c7-8525a50e0768', 'Starter: Verified challenge win 1', 'Win 1 server-verified challenges today. Only successful server-recorded actions count.', 'challenge_win', 1, 25, 0, 'competitor', 'competitor', 'games', '🏆', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bf6385f7-754e-5eb0-a89b-1e88c5d2f2bf', 'Starter: Verified challenge win 2', 'Win 2 server-verified challenges today. Only successful server-recorded actions count.', 'challenge_win', 2, 35, 0, 'competitor', 'competitor', 'games', '🏆', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('c2114fe7-bc19-5f25-8013-c9a1de4eab92', 'Starter: Verified challenge win 3', 'Win 3 server-verified challenges today. Only successful server-recorded actions count.', 'challenge_win', 3, 50, 0, 'competitor', 'competitor', 'games', '🏆', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('3df3358a-e5e7-5c6e-b630-7c8818beec9f', 'Starter: Verified challenge win 4', 'Win 4 server-verified challenges today. Only successful server-recorded actions count.', 'challenge_win', 4, 75, 0, 'competitor', 'competitor', 'games', '🏆', false)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('79dff36a-14b3-5ec7-be59-69af9be9555e', 'Starter: Publish an article 1', 'Publish 1 blog articles today. Only successful server-recorded actions count.', 'blog_publish', 1, 25, 0, 'creator', 'creator', 'blogs', '✍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('24358e66-6b50-571c-bd94-80f2cf9f5d10', 'Starter: Publish an article 2', 'Publish 2 blog articles today. Only successful server-recorded actions count.', 'blog_publish', 2, 35, 0, 'creator', 'creator', 'blogs', '✍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('4f40d16b-b43a-50bb-b0dd-f5c874e3255f', 'Starter: Publish an article 3', 'Publish 3 blog articles today. Only successful server-recorded actions count.', 'blog_publish', 3, 50, 0, 'creator', 'creator', 'blogs', '✍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('39a8c12e-f72a-58a8-b70a-2f2eaafc0879', 'Starter: Publish an article 4', 'Publish 4 blog articles today. Only successful server-recorded actions count.', 'blog_publish', 4, 75, 0, 'creator', 'creator', 'blogs', '✍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('968fcfd1-aa96-5d92-b494-6764a1be7857', 'Starter: Blog discussion 1', 'Write 1 blog comments today. Only successful server-recorded actions count.', 'blog_comment', 1, 25, 0, 'social', 'social', 'blogs', '📝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('294ea6c6-2e43-5457-90af-4cf402eecb37', 'Starter: Blog discussion 2', 'Write 2 blog comments today. Only successful server-recorded actions count.', 'blog_comment', 2, 35, 0, 'social', 'social', 'blogs', '📝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('9a4783f6-fa6b-5d9f-b7f7-de2bd4279828', 'Starter: Blog discussion 3', 'Write 3 blog comments today. Only successful server-recorded actions count.', 'blog_comment', 3, 50, 0, 'social', 'social', 'blogs', '📝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5a292b37-84e0-56dc-bcee-70635264d7d4', 'Starter: Blog discussion 4', 'Write 5 blog comments today. Only successful server-recorded actions count.', 'blog_comment', 5, 75, 0, 'social', 'social', 'blogs', '📝', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5f1fe32f-7c9e-5e7d-8752-8919313c8b73', 'Starter: Improve a wiki 1', 'Create or edit 1 wiki pages today. Only successful server-recorded actions count.', 'wiki_edit', 1, 25, 0, 'knowledge', 'knowledge', 'wiki', '📖', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('884ae764-e8df-5788-8241-9167e959b858', 'Starter: Improve a wiki 2', 'Create or edit 2 wiki pages today. Only successful server-recorded actions count.', 'wiki_edit', 2, 35, 0, 'knowledge', 'knowledge', 'wiki', '📖', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('92d77872-489f-5edf-8b91-9839520071c5', 'Starter: Improve a wiki 3', 'Create or edit 3 wiki pages today. Only successful server-recorded actions count.', 'wiki_edit', 3, 50, 0, 'knowledge', 'knowledge', 'wiki', '📖', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('29791d60-d61e-501a-9181-ee55435d8dcf', 'Starter: Improve a wiki 4', 'Create or edit 5 wiki pages today. Only successful server-recorded actions count.', 'wiki_edit', 5, 75, 0, 'knowledge', 'knowledge', 'wiki', '📖', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bc09dc90-31e1-5c15-a263-b063b5c7fe7e', 'Starter: Share your opinion 1', 'Vote in 1 poll today. Only successful server-recorded actions count.', 'poll_vote', 1, 25, 0, 'social', 'social', 'polls', '📊', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('247150d5-1aba-51fe-8c26-563c3af4532f', 'Starter: Share your opinion 2', 'Vote in 2 polls today. Only successful server-recorded actions count.', 'poll_vote', 2, 35, 0, 'social', 'social', 'polls', '📊', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('6a3dcccd-ba6e-5f29-afde-f4219edc040f', 'Starter: Share your opinion 3', 'Vote in 3 polls today. Only successful server-recorded actions count.', 'poll_vote', 3, 50, 0, 'social', 'social', 'polls', '📊', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('c0a289c7-803a-5c27-883d-5c6a017b088c', 'Starter: Share your opinion 4', 'Vote in 4 polls today. Only successful server-recorded actions count.', 'poll_vote', 4, 75, 0, 'social', 'social', 'polls', '📊', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bd9816a6-56ab-56d3-a99c-ba15124fb305', 'Starter: Ask the community 1', 'Create 1 poll today. Only successful server-recorded actions count.', 'poll_create', 1, 25, 0, 'creator', 'creator', 'polls', '📣', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('b0f23581-0e7f-54ee-a64f-3c867d1eb469', 'Starter: Ask the community 2', 'Create 2 polls today. Only successful server-recorded actions count.', 'poll_create', 2, 35, 0, 'creator', 'creator', 'polls', '📣', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('32fafee8-e7c2-5d01-a14b-a8ff31153c19', 'Starter: Ask the community 3', 'Create 3 polls today. Only successful server-recorded actions count.', 'poll_create', 3, 50, 0, 'creator', 'creator', 'polls', '📣', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('e7dba55e-8c0a-5743-86a9-a3a242c66ebc', 'Starter: Ask the community 4', 'Create 4 polls today. Only successful server-recorded actions count.', 'poll_create', 4, 75, 0, 'creator', 'creator', 'polls', '📣', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('9bddd138-79d9-542f-b279-15ef05fb4669', 'Starter: Complete a quiz 1', 'Complete 1 quiz today. Only successful server-recorded actions count.', 'quiz_complete', 1, 25, 0, 'knowledge', 'knowledge', 'quizzes', '🧠', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('5a16b676-4669-54da-8d16-d9352da79e7d', 'Starter: Complete a quiz 2', 'Complete 2 quizzes today. Only successful server-recorded actions count.', 'quiz_complete', 2, 35, 0, 'knowledge', 'knowledge', 'quizzes', '🧠', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bcd81319-7d28-5f41-9127-f5c67af2289f', 'Starter: Complete a quiz 3', 'Complete 3 quizzes today. Only successful server-recorded actions count.', 'quiz_complete', 3, 50, 0, 'knowledge', 'knowledge', 'quizzes', '🧠', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('17aae54f-fe05-5761-968e-ac4e7484670b', 'Starter: Complete a quiz 4', 'Complete 5 quizzes today. Only successful server-recorded actions count.', 'quiz_complete', 5, 75, 0, 'knowledge', 'knowledge', 'quizzes', '🧠', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('3ab36919-0d62-57d1-9db2-3fdd05283aa6', 'Starter: Perfect quiz 1', 'Get perfect scores in 1 quiz today. Only successful server-recorded actions count.', 'quiz_perfect', 1, 25, 0, 'knowledge', 'knowledge', 'quizzes', '💯', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('cc3c9159-9f53-5dc1-afd0-12a139f6e65b', 'Starter: Perfect quiz 2', 'Get perfect scores in 2 quizzes today. Only successful server-recorded actions count.', 'quiz_perfect', 2, 35, 0, 'knowledge', 'knowledge', 'quizzes', '💯', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('e0ffbe92-6960-5862-abae-db60c4c22b27', 'Starter: Perfect quiz 3', 'Get perfect scores in 3 quizzes today. Only successful server-recorded actions count.', 'quiz_perfect', 3, 50, 0, 'knowledge', 'knowledge', 'quizzes', '💯', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('2d8c4451-9ddd-5482-a90a-1dfed1020e9d', 'Starter: Perfect quiz 4', 'Get perfect scores in 4 quizzes today. Only successful server-recorded actions count.', 'quiz_perfect', 4, 75, 0, 'knowledge', 'knowledge', 'quizzes', '💯', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('bd44c9c6-6da3-51a7-9a3d-be3a211e68ea', 'Starter: Forum conversation 1', 'Reply to forum threads 1 time today. Only successful server-recorded actions count.', 'forum_reply', 1, 25, 0, 'social', 'social', 'bbforum', '💭', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('3e4afa60-419d-5a04-946d-58a00864f8fb', 'Starter: Forum conversation 2', 'Reply to forum threads 2 times today. Only successful server-recorded actions count.', 'forum_reply', 2, 35, 0, 'social', 'social', 'bbforum', '💭', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('dc05642f-a0d2-5922-9413-a7c595fe6cb7', 'Starter: Forum conversation 3', 'Reply to forum threads 3 times today. Only successful server-recorded actions count.', 'forum_reply', 3, 50, 0, 'social', 'social', 'bbforum', '💭', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('f3d3db93-2993-5416-8b71-dd36eee8bb85', 'Starter: Forum conversation 4', 'Reply to forum threads 5 times today. Only successful server-recorded actions count.', 'forum_reply', 5, 75, 0, 'social', 'social', 'bbforum', '💭', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('68de43a6-8b5e-5d3a-8c4d-67165c86582c', 'Starter: Start a discussion 1', 'Create 1 forum threads today. Only successful server-recorded actions count.', 'forum_create_thread', 1, 25, 0, 'creator', 'creator', 'bbforum', '🧵', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('850d8fbd-2c05-59ac-bd55-7535a0ffdc19', 'Starter: Start a discussion 2', 'Create 2 forum threads today. Only successful server-recorded actions count.', 'forum_create_thread', 2, 35, 0, 'creator', 'creator', 'bbforum', '🧵', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('1a87fc0c-27ac-538d-a896-606bad2ca93b', 'Starter: Start a discussion 3', 'Create 3 forum threads today. Only successful server-recorded actions count.', 'forum_create_thread', 3, 50, 0, 'creator', 'creator', 'bbforum', '🧵', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('11958535-c028-5179-bc90-ec3964d076d6', 'Starter: Start a discussion 4', 'Create 4 forum threads today. Only successful server-recorded actions count.', 'forum_create_thread', 4, 75, 0, 'creator', 'creator', 'bbforum', '🧵', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('f991c350-9bee-551a-8285-e08ae0ea0115', 'Starter: Explore the market 1', 'Make 1 supported cosmetic or booster purchases today. Only successful server-recorded actions count.', 'market_purchase', 1, 25, 0, 'explorer', 'explorer', NULL, '🛍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('be2f408a-ac97-5b7e-9aa3-36744c079dd2', 'Starter: Explore the market 2', 'Make 2 supported cosmetic or booster purchases today. Only successful server-recorded actions count.', 'market_purchase', 2, 35, 0, 'explorer', 'explorer', NULL, '🛍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('0f097936-ab66-5d76-82ee-b3dbec8c8462', 'Starter: Explore the market 3', 'Make 3 supported cosmetic or booster purchases today. Only successful server-recorded actions count.', 'market_purchase', 3, 50, 0, 'explorer', 'explorer', NULL, '🛍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
  INSERT INTO public.quest_templates ("id", "title", "description", "action_type", "target_count", "xp_reward", "coin_reward", "track", "category", "feature_key", "icon", "is_active")
  VALUES ('223ab1e8-ce06-5f9f-a019-49b6ee2f04ce', 'Starter: Explore the market 4', 'Make 4 supported cosmetic or booster purchases today. Only successful server-recorded actions count.', 'market_purchase', 4, 75, 0, 'explorer', 'explorer', NULL, '🛍️', true)
  ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;

  RAISE NOTICE 'Starter content installed. Existing rows were preserved; business/store prerequisites may skip those examples. Review drafts before activating paid, sponsored or XP features.';
END
$starter$;
COMMIT;
