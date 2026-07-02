-- =====================================================================
-- Zobia Social — Complete Database Schema (consolidated)
--
-- This is the entire database schema in one file: every table, index,
-- constraint, foreign key and Row Level Security policy the app needs,
-- plus the reference/config seed data the app depends on to function
-- (feature flags, game catalog, gift/store catalog, quest templates,
-- sticker packs, Answers categories, cultural events calendar).
--
-- It replaces the previous 0001-0042 sequence of incremental migration
-- files, which have been merged into this single file with all
-- inconsistencies resolved (later fixes/backfills already applied,
-- dropped columns removed, superseded values updated to their final
-- state). Run this one file on a fresh database instead of 42 separate
-- ones — see docs/SETUP.md → "Database setup".
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / DROP
-- + re-CREATE / ON CONFLICT DO NOTHING), matching the idempotency
-- pattern used throughout this repo's migration history.
--
-- Demo/sample data (sample users, rooms, moments, etc. for local dev)
-- lives separately in db/seed.sql and is NOT part of this file — run
-- `npm run migrate -- --seed` to also apply it.
-- =====================================================================

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- admin_actions
CREATE TABLE IF NOT EXISTS admin_actions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    duration_hours integer,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- admin_audit_log
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    resource text,
    resource_id text,
    before_val jsonb,
    after_val jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now(),
    target_type text,
    target_id text,
    metadata jsonb
);

-- admin_message_receipts
CREATE TABLE IF NOT EXISTS admin_message_receipts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    admin_message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_delivered boolean DEFAULT false,
    is_read boolean DEFAULT false,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone
);

-- admin_messages
CREATE TABLE IF NOT EXISTS admin_messages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sender_admin_id uuid NOT NULL,
    subject text,
    body text NOT NULL,
    broadcast_type text DEFAULT 'direct'::text NOT NULL,
    target_plans text[],
    target_roles text[],
    target_user_ids uuid[],
    recipient_count integer DEFAULT 0,
    delivered_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admin_messages_broadcast_type_check CHECK ((broadcast_type = ANY (ARRAY['direct'::text, 'all'::text, 'by_plan'::text, 'by_role'::text])))
);

-- admin_roles
CREATE TABLE IF NOT EXISTS admin_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- alliance_wars
CREATE TABLE IF NOT EXISTS alliance_wars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alliance_1_id uuid NOT NULL,
    alliance_2_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    winner_alliance_id uuid,
    alliance_1_xp bigint DEFAULT 0 NOT NULL,
    alliance_2_xp bigint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT alliance_wars_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text])))
);

-- announcement_banners
CREATE TABLE IF NOT EXISTS announcement_banners (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'html'::text NOT NULL,
    is_active boolean DEFAULT false,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    target_plans text[] DEFAULT ARRAY['free'::text, 'plus'::text, 'pro'::text, 'max'::text],
    target_roles text[] DEFAULT ARRAY[]::text[],
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    title text,
    link_url text,
    deleted_at timestamp with time zone,
    created_by text,
    CONSTRAINT announcement_banners_content_type_check CHECK ((content_type = ANY (ARRAY['html'::text, 'text'::text])))
);

-- announcement_modals
CREATE TABLE IF NOT EXISTS announcement_modals (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'html'::text NOT NULL,
    is_active boolean DEFAULT false,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    target_plans text[] DEFAULT ARRAY['free'::text, 'plus'::text, 'pro'::text, 'max'::text],
    target_roles text[] DEFAULT ARRAY[]::text[],
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by text,
    CONSTRAINT announcement_modals_content_type_check CHECK ((content_type = ANY (ARRAY['html'::text, 'text'::text])))
);

-- app_settings
CREATE TABLE IF NOT EXISTS app_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

-- audit_discrepancies
CREATE TABLE IF NOT EXISTS audit_discrepancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    asset_type text NOT NULL,
    ledger_sum bigint NOT NULL,
    wallet_balance bigint NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    notes text,
    CONSTRAINT audit_discrepancies_asset_type_check CHECK ((asset_type = ANY (ARRAY['coins'::text, 'stars'::text, 'xp'::text])))
);

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    target_type text,
    target_id text,
    metadata jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- automated_actions_log
CREATE TABLE IF NOT EXISTS automated_actions_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_type text NOT NULL,
    target_type text,
    target_id text,
    target_user_id uuid,
    user_id uuid,
    description text,
    metadata jsonb,
    reverse_note text,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

-- branded_rooms
CREATE TABLE IF NOT EXISTS branded_rooms (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid,
    brand_name text NOT NULL,
    brand_logo_url text,
    sponsor_budget_coins bigint DEFAULT 0 NOT NULL,
    join_bonus_coins integer DEFAULT 5 NOT NULL,
    is_active boolean DEFAULT true,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);

-- business_accounts
CREATE TABLE IF NOT EXISTS business_accounts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    business_name text NOT NULL,
    business_type text,
    tier text DEFAULT 'starter'::text NOT NULL,
    pending_tier text,
    pending_payment_ref text,
    tier_updated_at timestamp with time zone,
    verified boolean DEFAULT false,
    status text DEFAULT 'active'::text NOT NULL,
    subscription_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    verification_status text DEFAULT 'unverified'::text NOT NULL,
    verification_requested_at timestamp with time zone,
    verification_reviewed_at timestamp with time zone,
    verification_reject_reason text,
    grace_period_ends_at timestamp with time zone,
    CONSTRAINT business_accounts_pending_tier_check CHECK ((pending_tier = ANY (ARRAY['starter'::text, 'growth'::text, 'enterprise'::text]))),
    CONSTRAINT business_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'cancelled'::text]))),
    CONSTRAINT business_accounts_tier_check CHECK ((tier = ANY (ARRAY['starter'::text, 'growth'::text, 'enterprise'::text]))),
    CONSTRAINT business_accounts_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])))
);

-- classroom_enrolments
CREATE TABLE IF NOT EXISTS classroom_enrolments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    fee_kobo bigint DEFAULT 0 NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    certificate_issued boolean DEFAULT false,
    certificate_issued_at timestamp with time zone
);

-- classroom_quiz_attempts
CREATE TABLE IF NOT EXISTS classroom_quiz_attempts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quiz_id uuid NOT NULL,
    user_id uuid NOT NULL,
    score integer NOT NULL,
    passed boolean NOT NULL,
    answers jsonb NOT NULL,
    xp_awarded integer DEFAULT 0,
    completed_at timestamp with time zone DEFAULT now()
);

-- classroom_quiz_questions
CREATE TABLE IF NOT EXISTS classroom_quiz_questions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quiz_id uuid NOT NULL,
    question text NOT NULL,
    option_a text NOT NULL,
    option_b text NOT NULL,
    option_c text NOT NULL,
    option_d text NOT NULL,
    correct_option text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT classroom_quiz_questions_correct_option_check CHECK ((correct_option = ANY (ARRAY['a'::text, 'b'::text, 'c'::text, 'd'::text])))
);

-- classroom_quizzes
CREATE TABLE IF NOT EXISTS classroom_quizzes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    xp_reward integer DEFAULT 50 NOT NULL,
    pass_score integer DEFAULT 70 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- coin_ledger
CREATE TABLE IF NOT EXISTS coin_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    reference_id text,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- coin_ledger_archive
CREATE TABLE IF NOT EXISTS coin_ledger_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    reference_id text,
    description text,
    metadata jsonb,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='100');

-- community_note_votes
CREATE TABLE IF NOT EXISTS community_note_votes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    helpful boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- community_notes
CREATE TABLE IF NOT EXISTS community_notes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    helpful_votes integer DEFAULT 0 NOT NULL,
    unhelpful_votes integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'needs_review'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    admin_comment text,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT community_notes_status_check CHECK ((status = ANY (ARRAY['needs_review'::text, 'shown'::text, 'hidden'::text]))),
    CONSTRAINT community_notes_target_type_check CHECK ((target_type = ANY (ARRAY['message'::text, 'room'::text, 'user'::text, 'guild'::text])))
);

-- conversation_scores
CREATE TABLE IF NOT EXISTS conversation_scores (
    user_id_1 uuid NOT NULL,
    user_id_2 uuid NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    streak_days integer DEFAULT 0 NOT NULL,
    last_message_date date,
    has_connection_badge boolean DEFAULT false NOT NULL,
    badge_unlocked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cs_ordered_pair CHECK ((user_id_1 < user_id_2))
);

-- council_invitations
CREATE TABLE IF NOT EXISTS council_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    legacy_score bigint DEFAULT 0 NOT NULL
);

-- creator_bank_accounts
CREATE TABLE IF NOT EXISTS creator_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    bank_name text NOT NULL,
    bank_code text NOT NULL,
    account_number text NOT NULL,
    account_name text NOT NULL,
    account_number_last4 text NOT NULL,
    recipient_code text,
    xp_awarded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_encrypted boolean DEFAULT false NOT NULL
);

-- creator_broadcasts
CREATE TABLE IF NOT EXISTS creator_broadcasts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid,
    subject text,
    content text NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    cost_coins integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    sender_id uuid,
    recipient_id uuid,
    message_type text,
    reference_id text
);

-- creator_earnings
CREATE TABLE IF NOT EXISTS creator_earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    source_type text NOT NULL,
    gross_amount_kobo bigint DEFAULT 0 NOT NULL,
    platform_fee_kobo bigint DEFAULT 0 NOT NULL,
    net_amount_kobo bigint DEFAULT 0 NOT NULL,
    reference_id text,
    paid_out boolean DEFAULT false,
    payout_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_earnings_source_type_check CHECK ((source_type = ANY (ARRAY['gift'::text, 'subscription'::text, 'drop_entry'::text, 'classroom_enrolment'::text, 'sponsored_quest'::text, 'merch'::text, 'creator_fund'::text, 'broadcast'::text])))
);

-- creator_kyc
CREATE TABLE IF NOT EXISTS creator_kyc (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    full_name text,
    bvn_last4 text,
    bank_account_number text,
    bank_code text,
    bank_name text,
    kyc_status text DEFAULT 'unverified'::text NOT NULL,
    is_encrypted boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT creator_kyc_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])))
);

ALTER TABLE creator_kyc FORCE ROW LEVEL SECURITY;

-- creator_payouts
CREATE TABLE IF NOT EXISTS creator_payouts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    amount_kobo bigint NOT NULL,
    gross_kobo bigint,
    net_kobo bigint,
    platform_fee_kobo bigint,
    provider text NOT NULL,
    bank_account_reference text,
    bank_account_last4 text,
    bank_account_snapshot jsonb,
    wallet_address_snapshot text,
    payout_method text DEFAULT 'bank_transfer'::text,
    region text DEFAULT 'nigeria'::text,
    status text DEFAULT 'pending'::text NOT NULL,
    requires_manual_approval boolean DEFAULT false,
    approved_by_admin_id uuid,
    idempotency_key text,
    provider_reference text,
    provider_status text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retry_at timestamp with time zone,
    next_retry_at timestamp with time zone,
    appeal_reason text,
    appeal_status text,
    appeal_submitted_at timestamp with time zone,
    appeal_resolved_at timestamp with time zone,
    appeal_resolved_by uuid,
    earnings_restored boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    rejection_reason text,
    CONSTRAINT creator_payouts_appeal_status_check CHECK ((appeal_status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT creator_payouts_payout_method_check CHECK ((payout_method = ANY (ARRAY['bank_transfer'::text, 'coins'::text, 'crypto'::text]))),
    CONSTRAINT creator_payouts_region_check CHECK ((region = ANY (ARRAY['nigeria'::text, 'global'::text]))),
    CONSTRAINT creator_payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_approval'::text, 'approved'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'rejected'::text, 'reversed'::text, 'cancelled'::text])))
);

ALTER TABLE creator_payouts FORCE ROW LEVEL SECURITY;

-- creator_spotlights
CREATE TABLE IF NOT EXISTS creator_spotlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    month_year text NOT NULL,
    blurb text,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);

-- creator_wallet_addresses
CREATE TABLE IF NOT EXISTS creator_wallet_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    network text DEFAULT 'tron'::text NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- cron_state
CREATE TABLE IF NOT EXISTS cron_state (
    key text NOT NULL,
    value_text text,
    value_ts timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- data_export_requests
CREATE TABLE IF NOT EXISTS data_export_requests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    download_url text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);

-- dm_conversation_score_milestones
CREATE TABLE IF NOT EXISTS dm_conversation_score_milestones (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id_a uuid NOT NULL,
    user_id_b uuid NOT NULL,
    milestone_score integer NOT NULL,
    awarded_at timestamp with time zone DEFAULT now()
);

-- dm_conversation_unlocks
CREATE TABLE IF NOT EXISTS dm_conversation_unlocks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    conversation_key text NOT NULL,
    initiator_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    unlocked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- dm_conversations
CREATE TABLE IF NOT EXISTS dm_conversations (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id_1 uuid NOT NULL,
    user_id_2 uuid NOT NULL,
    conversation_score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_dm_conversations_user_order CHECK ((user_id_1 < user_id_2)),
    CONSTRAINT dm_canonical_pair CHECK ((user_id_1 < user_id_2)),
    CONSTRAINT dm_conversations_check CHECK ((user_id_1 < user_id_2)),
    CONSTRAINT dm_conversations_user_ordering CHECK ((user_id_1 < user_id_2)),
    CONSTRAINT dm_no_self_chat CHECK ((user_id_1 <> user_id_2))
);

-- dm_score_sticker_unlocks
CREATE TABLE IF NOT EXISTS dm_score_sticker_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id_1 uuid NOT NULL,
    user_id_2 uuid NOT NULL,
    pack_name text NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL
);

-- drop_room_replays
CREATE TABLE IF NOT EXISTS drop_room_replays (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title text NOT NULL,
    highlights jsonb NOT NULL,
    replay_fee_kobo bigint DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT false,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- elder_mentorships
CREATE TABLE IF NOT EXISTS elder_mentorships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    elder_id uuid NOT NULL,
    mentee_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    CONSTRAINT elder_mentorships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'terminated'::text])))
);

-- elder_requests
CREATE TABLE IF NOT EXISTS elder_requests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    mentee_id uuid NOT NULL,
    elder_id uuid NOT NULL,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT elder_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))
);

-- failed_commissions
CREATE TABLE IF NOT EXISTS failed_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id text NOT NULL,
    user_id uuid NOT NULL,
    coin_amount bigint NOT NULL,
    amount_kobo bigint DEFAULT 0 NOT NULL,
    source text DEFAULT 'unknown'::text NOT NULL,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retried_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- failed_webhooks
CREATE TABLE IF NOT EXISTS failed_webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_type text,
    payload jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    last_error text,
    next_retry_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

-- failed_xp_awards
CREATE TABLE IF NOT EXISTS failed_xp_awards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    track text NOT NULL,
    source text NOT NULL,
    reference_id text,
    error_message text,
    failed_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retried_at timestamp with time zone,
    resolved_at timestamp with time zone,
    CONSTRAINT failed_xp_awards_amount_check CHECK ((amount > 0))
);

-- feature_flags
CREATE TABLE IF NOT EXISTS feature_flags (
    key text NOT NULL,
    available_from timestamp with time zone,
    early_access_plans text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- flash_xp_events
CREATE TABLE IF NOT EXISTS flash_xp_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    multiplier numeric(3,1) DEFAULT 2.0 NOT NULL,
    announced_at timestamp with time zone,
    fires_at timestamp with time zone,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    fired boolean DEFAULT false,
    announcement_notification_sent boolean DEFAULT false NOT NULL,
    notification_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    description text,
    updated_at timestamp with time zone DEFAULT now()
);

-- follows
CREATE TABLE IF NOT EXISTS follows (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- footer_scripts
CREATE TABLE IF NOT EXISTS footer_scripts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    is_active boolean DEFAULT true,
    "position" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- forum_answers
CREATE TABLE IF NOT EXISTS forum_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_answer_id uuid,
    depth integer DEFAULT 0 NOT NULL,
    body text NOT NULL,
    vote_score integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

-- forum_categories
CREATE TABLE IF NOT EXISTS forum_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    icon_emoji text DEFAULT '💬'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- forum_favorites
CREATE TABLE IF NOT EXISTS forum_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- forum_moderation_log
CREATE TABLE IF NOT EXISTS forum_moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    moderator_id uuid NOT NULL,
    question_id uuid,
    answer_id uuid,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- forum_questions
CREATE TABLE IF NOT EXISTS forum_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    vote_score integer DEFAULT 0 NOT NULL,
    answer_count integer DEFAULT 0 NOT NULL,
    favorite_count integer DEFAULT 0 NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    best_answer_id uuid,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    category_id uuid,
    slug text
);

-- forum_votes
CREATE TABLE IF NOT EXISTS forum_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    user_id uuid NOT NULL,
    value smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_votes_target_type_check CHECK ((target_type = ANY (ARRAY['question'::text, 'answer'::text]))),
    CONSTRAINT forum_votes_value_check CHECK ((value = ANY (ARRAY['-1'::integer, 1])))
);

-- friendships
CREATE TABLE IF NOT EXISTS friendships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    requester_id uuid NOT NULL,
    addressee_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT friendships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'blocked'::text])))
);

-- game_best_scores
CREATE TABLE IF NOT EXISTS game_best_scores (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    best_score bigint DEFAULT 0 NOT NULL,
    plays integer DEFAULT 0 NOT NULL,
    wins integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- game_challenge_rounds
CREATE TABLE IF NOT EXISTS game_challenge_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    round_no integer NOT NULL,
    challenger_play_id uuid,
    opponent_play_id uuid,
    challenger_score bigint,
    opponent_score bigint,
    round_winner_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT game_challenge_rounds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text])))
);

-- game_challenges
CREATE TABLE IF NOT EXISTS game_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    challenger_id uuid NOT NULL,
    opponent_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    rounds integer DEFAULT 1 NOT NULL,
    wager_credits integer DEFAULT 0 NOT NULL,
    escrow_credits integer DEFAULT 0 NOT NULL,
    winner_id uuid,
    prize_credits integer DEFAULT 0 NOT NULL,
    prize_xp integer DEFAULT 0 NOT NULL,
    prize_stars integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '48:00:00'::interval) NOT NULL,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT game_challenges_rounds_check CHECK ((rounds = ANY (ARRAY[1, 3]))),
    CONSTRAINT game_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'active'::text, 'completed'::text, 'cancelled'::text, 'expired'::text]))),
    CONSTRAINT game_challenges_wager_credits_check CHECK ((wager_credits >= 0))
);

-- game_favorites
CREATE TABLE IF NOT EXISTS game_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- game_milestone_claims
CREATE TABLE IF NOT EXISTS game_milestone_claims (
    user_id uuid NOT NULL,
    threshold integer NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- game_play_milestones
CREATE TABLE IF NOT EXISTS game_play_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    games_played_threshold integer NOT NULL,
    reward_credits integer DEFAULT 0 NOT NULL,
    reward_xp integer DEFAULT 0 NOT NULL,
    reward_stars integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- game_plays
CREATE TABLE IF NOT EXISTS game_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    score bigint DEFAULT 0 NOT NULL,
    session_nonce text NOT NULL,
    counted boolean DEFAULT false NOT NULL,
    challenge_round_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);

-- game_ratings
CREATE TABLE IF NOT EXISTS game_ratings (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

-- game_saves
CREATE TABLE IF NOT EXISTS game_saves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    label text,
    state jsonb NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- games
CREATE TABLE IF NOT EXISTS games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    tagline text,
    description text,
    cover_image_url text,
    cover_emoji text DEFAULT '🎮'::text NOT NULL,
    creator_id uuid,
    is_public boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    play_count bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    category text,
    long_description text,
    engine_key text,
    sort_order integer DEFAULT 0 NOT NULL,
    reward_credits_per_win integer DEFAULT 0 NOT NULL,
    reward_xp_per_win integer DEFAULT 0 NOT NULL,
    reward_stars_per_win integer DEFAULT 0 NOT NULL,
    play_cost_credits integer DEFAULT 0 NOT NULL,
    play_cost_stars integer DEFAULT 0 NOT NULL,
    max_score bigint,
    min_play_seconds integer DEFAULT 0 NOT NULL,
    avg_rating numeric(3,2) DEFAULT 0 NOT NULL,
    rating_count integer DEFAULT 0 NOT NULL,
    favorite_count integer DEFAULT 0 NOT NULL
);

-- gift_items
CREATE TABLE IF NOT EXISTS gift_items (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    emoji text NOT NULL,
    coin_cost bigint DEFAULT 0 NOT NULL,
    tier integer NOT NULL,
    spectacle_threshold_coins integer,
    animation_url text,
    is_limited_edition boolean DEFAULT false,
    season_id uuid,
    is_retired boolean DEFAULT false,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gift_items_tier_check CHECK (((tier >= 1) AND (tier <= 3)))
);

-- gift_types
CREATE TABLE IF NOT EXISTS gift_types (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    emoji text NOT NULL,
    coin_cost bigint NOT NULL,
    xp_value integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_limited_edition boolean DEFAULT false NOT NULL,
    is_retired boolean DEFAULT false NOT NULL,
    season_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- gifts
CREATE TABLE IF NOT EXISTS gifts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    room_id uuid,
    gift_item_id uuid NOT NULL,
    coin_value bigint NOT NULL,
    coin_cost bigint NOT NULL,
    animation_url text,
    message_id uuid,
    status text DEFAULT 'delivered'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    gift_type_id uuid,
    CONSTRAINT gifts_status_check CHECK ((status = ANY (ARRAY['delivered'::text, 'failed'::text, 'refunded'::text])))
);

ALTER TABLE gifts FORCE ROW LEVEL SECURITY;

-- group_chat_members
CREATE TABLE IF NOT EXISTS group_chat_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    group_chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_chat_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);

-- group_chats
CREATE TABLE IF NOT EXISTS group_chats (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    creator_id uuid NOT NULL,
    avatar_emoji text DEFAULT '👥'::text,
    tag text,
    member_count integer DEFAULT 1 NOT NULL,
    max_members integer DEFAULT 300 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_chats_tag_check CHECK ((tag = ANY (ARRAY['Study Group'::text, 'Crew'::text, 'Business'::text])))
);

-- guild_alliance_members
CREATE TABLE IF NOT EXISTS guild_alliance_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    alliance_id uuid NOT NULL,
    guild_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now()
);

-- guild_alliances
CREATE TABLE IF NOT EXISTS guild_alliances (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    founded_by uuid NOT NULL,
    is_active boolean DEFAULT true,
    wars_won integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- guild_applications
CREATE TABLE IF NOT EXISTS guild_applications (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT guild_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

-- guild_contribution_alerts
CREATE TABLE IF NOT EXISTS guild_contribution_alerts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weeks_below integer DEFAULT 1 NOT NULL,
    alerted_at timestamp with time zone DEFAULT now(),
    resolved boolean DEFAULT false
);

-- guild_invites
CREATE TABLE IF NOT EXISTS guild_invites (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    token text NOT NULL,
    invited_user_id uuid,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now()
);

-- guild_members
CREATE TABLE IF NOT EXISTS guild_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    contribution_score integer DEFAULT 0 NOT NULL,
    war_points_total integer DEFAULT 0 NOT NULL,
    contribution_below_average_weeks integer DEFAULT 0 NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone,
    CONSTRAINT guild_members_role_check CHECK ((role = ANY (ARRAY['captain'::text, 'veteran'::text, 'recruiter'::text, 'member'::text])))
);

-- guild_messages
CREATE TABLE IF NOT EXISTS guild_messages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    sticker_id text,
    gif_url text,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guild_messages_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 1000))),
    CONSTRAINT guild_messages_type_check CHECK ((type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text])))
);

-- guild_quest_contributions
CREATE TABLE IF NOT EXISTS guild_quest_contributions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- guild_quests
CREATE TABLE IF NOT EXISTS guild_quests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    quest_type text DEFAULT 'collective'::text NOT NULL,
    target_count integer DEFAULT 100 NOT NULL,
    current_count integer DEFAULT 0 NOT NULL,
    reward_guild_xp integer DEFAULT 500 NOT NULL,
    reward_coins integer DEFAULT 200 NOT NULL,
    week_start timestamp with time zone NOT NULL,
    week_end timestamp with time zone NOT NULL,
    is_completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT guild_quests_week_start_is_monday CHECK ((EXTRACT(isodow FROM (week_start AT TIME ZONE 'UTC'::text)) = (1)::numeric))
);

-- guild_rooms
CREATE TABLE IF NOT EXISTS guild_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_id uuid NOT NULL,
    room_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- guild_tier_history
CREATE TABLE IF NOT EXISTS guild_tier_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_id uuid NOT NULL,
    from_tier text NOT NULL,
    to_tier text NOT NULL,
    guild_xp_at bigint NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    war_id uuid
);

-- guild_treasury_ledger
CREATE TABLE IF NOT EXISTS guild_treasury_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    description text,
    reference_id text,
    created_at timestamp with time zone DEFAULT now()
);

-- guild_war_rematch_tokens
CREATE TABLE IF NOT EXISTS guild_war_rematch_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    war_id uuid NOT NULL,
    discount_percent integer DEFAULT 50 NOT NULL,
    is_used boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- guild_wars
CREATE TABLE IF NOT EXISTS guild_wars (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    challenger_guild_id uuid NOT NULL,
    defender_guild_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    challenger_points bigint DEFAULT 0 NOT NULL,
    defender_points bigint DEFAULT 0 NOT NULL,
    winner_guild_id uuid,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    final_hour_starts_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_wars_status_check CHECK ((status = ANY (ARRAY['active'::text, 'final_hour'::text, 'completed'::text, 'cancelled'::text])))
);

-- guilds
CREATE TABLE IF NOT EXISTS guilds (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    crest_emoji text DEFAULT '🛡️'::text NOT NULL,
    description text,
    city text,
    country text DEFAULT 'NG'::text,
    captain_id uuid NOT NULL,
    tier text DEFAULT 'bronze_1'::text NOT NULL,
    guild_xp bigint DEFAULT 0 NOT NULL,
    member_count integer DEFAULT 1 NOT NULL,
    treasury_balance bigint DEFAULT 0 NOT NULL,
    treasury_cap bigint DEFAULT 50000 NOT NULL,
    recruitment_type text DEFAULT 'open'::text NOT NULL,
    wars_won integer DEFAULT 0 NOT NULL,
    wars_lost integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_war_ended_at timestamp with time zone,
    below_min_since timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    wars_drawn integer DEFAULT 0 NOT NULL,
    CONSTRAINT guilds_recruitment_type_check CHECK ((recruitment_type = ANY (ARRAY['open'::text, 'approval'::text, 'invite_only'::text]))),
    CONSTRAINT guilds_tier_check CHECK ((tier = ANY (ARRAY['bronze_1'::text, 'bronze_2'::text, 'bronze_3'::text, 'silver_1'::text, 'silver_2'::text, 'silver_3'::text, 'gold_1'::text, 'gold_2'::text, 'gold_3'::text, 'platinum_1'::text, 'platinum_2'::text, 'platinum_3'::text, 'legend'::text]))),
    CONSTRAINT guilds_treasury_balance_max CHECK ((treasury_balance <= '1000000000000'::bigint)),
    CONSTRAINT guilds_treasury_cap_max CHECK ((treasury_cap <= '1000000000000'::bigint))
);

-- hall_of_fame
CREATE TABLE IF NOT EXISTS hall_of_fame (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    prestige_count integer NOT NULL,
    legacy_score bigint DEFAULT 0 NOT NULL,
    inducted_at timestamp with time zone DEFAULT now() NOT NULL
);

-- leaderboard_rank_snapshots
CREATE TABLE IF NOT EXISTS leaderboard_rank_snapshots (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    rank integer NOT NULL,
    xp bigint DEFAULT 0 NOT NULL,
    snapped_at timestamp with time zone DEFAULT now() NOT NULL
);

-- leaderboard_snapshots
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    city text,
    season_id uuid,
    xp_value bigint DEFAULT 0 NOT NULL,
    rank_position integer,
    updated_at timestamp with time zone DEFAULT now(),
    last_notified_rank integer,
    rank integer
);

-- learning_certificates
CREATE TABLE IF NOT EXISTS learning_certificates (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    certificate_url text,
    metadata jsonb,
    room_id uuid,
    recipient_user_id uuid,
    issuer_user_id uuid,
    title text,
    note text
);

-- merch_orders
CREATE TABLE IF NOT EXISTS merch_orders (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    creator_id uuid,
    amount_kobo bigint,
    creator_share_kobo bigint,
    platform_fee_kobo bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    shipping_name text,
    shipping_address text,
    shipping_city text,
    shipping_country text,
    fulfillment_method text DEFAULT 'manual'::text,
    seller_notes text,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    tracking_updates jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    store_id uuid,
    price_kobo bigint,
    creator_net_kobo bigint,
    payment_method text,
    updated_at timestamp with time zone DEFAULT now(),
    provider_reference text,
    CONSTRAINT merch_orders_fulfillment_method_check CHECK ((fulfillment_method = ANY (ARRAY['manual'::text, 'partner'::text]))),
    CONSTRAINT merch_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'shipped'::text, 'in_transit'::text, 'delivered'::text, 'completed'::text, 'refunded'::text])))
);

-- merch_products
CREATE TABLE IF NOT EXISTS merch_products (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    product_type text DEFAULT 'digital'::text NOT NULL,
    price_kobo bigint NOT NULL,
    image_url text,
    is_active boolean DEFAULT true,
    stock integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT merch_products_product_type_check CHECK ((product_type = ANY (ARRAY['digital'::text, 'physical'::text, 'course_material'::text])))
);

-- merch_stores
CREATE TABLE IF NOT EXISTS merch_stores (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    physical_goods_enabled boolean DEFAULT false,
    default_fulfillment_method text DEFAULT 'manual'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT merch_stores_default_fulfillment_method_check CHECK ((default_fulfillment_method = ANY (ARRAY['manual'::text, 'partner'::text])))
);

-- message_reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    is_custom boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- messages
CREATE TABLE IF NOT EXISTS messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid,
    conversation_id uuid,
    message_type text DEFAULT 'text'::text NOT NULL,
    content text,
    media_url text,
    metadata jsonb,
    coin_cost bigint DEFAULT 0,
    reply_count_from_recipient integer DEFAULT 0,
    is_read boolean DEFAULT false NOT NULL,
    is_deleted boolean DEFAULT false,
    is_flagged boolean DEFAULT false,
    sender_plan_at_creation text DEFAULT 'free'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_chat_id uuid,
    idempotency_key text,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    retain_until timestamp with time zone,
    CONSTRAINT messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text, 'gift'::text, 'moment'::text, 'system'::text, 'broadcast'::text])))
);

ALTER TABLE messages FORCE ROW LEVEL SECURITY;

-- moderation_actions
CREATE TABLE IF NOT EXISTS moderation_actions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    target_user_id uuid NOT NULL,
    moderator_id uuid,
    action_type text,
    reason text,
    report_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    duration_hours integer,
    metadata jsonb,
    actor_type text DEFAULT 'manual'::text NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    reversal_note text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT moderation_actions_action_type_check CHECK ((action_type = ANY (ARRAY['warn'::text, 'suspend'::text, 'ban'::text, 'remove_content'::text, 'escalate'::text, 'dismiss'::text])))
);

-- moderation_ai_escalations
CREATE TABLE IF NOT EXISTS moderation_ai_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    provider text NOT NULL,
    verdict text NOT NULL,
    confidence numeric(4,3) NOT NULL,
    reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_ai_escalations_verdict_check CHECK ((verdict = ANY (ARRAY['violation'::text, 'borderline'::text, 'no_violation'::text])))
);

-- moderation_reports
CREATE TABLE IF NOT EXISTS moderation_reports (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_user_id uuid,
    reported_message_id uuid,
    reported_room_id uuid,
    reported_guild_id uuid,
    report_type text DEFAULT 'other'::text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    pipeline_status text DEFAULT 'manual_queue'::text NOT NULL,
    ai_category text,
    ai_confidence numeric(5,4),
    ai_recommendation text,
    ai_provider text,
    ai_classified_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reported_forum_question_id uuid,
    reported_forum_answer_id uuid,
    CONSTRAINT moderation_reports_pipeline_status_check CHECK ((pipeline_status = ANY (ARRAY['ai_auto_actioned'::text, 'community_review'::text, 'manual_queue'::text, 'resolved'::text])))
);

-- moment_reactions
CREATE TABLE IF NOT EXISTS moment_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    moment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- moment_views
CREATE TABLE IF NOT EXISTS moment_views (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    moment_id uuid NOT NULL,
    viewer_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now()
);

-- moments
CREATE TABLE IF NOT EXISTS moments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'text'::text NOT NULL,
    media_url text,
    thumbnail_url text,
    caption text,
    view_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reactions_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT moments_content_type_check CHECK ((content_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text])))
);

-- monthly_gift_drops
CREATE TABLE IF NOT EXISTS monthly_gift_drops (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    gift_item_id uuid,
    title text NOT NULL,
    available_from timestamp with time zone NOT NULL,
    available_until timestamp with time zone NOT NULL,
    announced_at timestamp with time zone,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- nemesis_assignments
CREATE TABLE IF NOT EXISTS nemesis_assignments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    nemesis_user_id uuid NOT NULL,
    nemesis_id uuid,
    track text DEFAULT 'main'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    dismissed_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_notified_at timestamp with time zone
);

-- nemesis_challenges
CREATE TABLE IF NOT EXISTS nemesis_challenges (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    challenger_id uuid NOT NULL,
    challenged_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nemesis_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'completed'::text, 'expired'::text])))
);

-- new_member_quests
CREATE TABLE IF NOT EXISTS new_member_quests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    quest_type text DEFAULT 'new_member'::text NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    reward_claimed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    payload jsonb,
    title text,
    body text,
    metadata jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    reference_id text
);

-- password_reset_tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- payments
CREATE TABLE IF NOT EXISTS payments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    payment_type text NOT NULL,
    amount_kobo bigint NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    provider text NOT NULL,
    provider_reference text,
    provider_transaction_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    coins_credited bigint,
    amount_received_kobo bigint,
    idempotency_key text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    reference_id text,
    payment_url text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['coin_purchase'::text, 'subscription'::text, 'season_pass'::text, 'booster_pack'::text, 'room_entry'::text, 'room_subscription'::text, 'business_upgrade'::text]))),
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['paystack'::text, 'dodopayments'::text, 'google_play'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'refunded'::text])))
);

ALTER TABLE payments FORCE ROW LEVEL SECURITY;

-- payout_dead_letter_queue
CREATE TABLE IF NOT EXISTS payout_dead_letter_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    failure_reason text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_attempted_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- platform_council_ideas
CREATE TABLE IF NOT EXISTS platform_council_ideas (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    votes integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    CONSTRAINT platform_council_ideas_status_check CHECK ((status = ANY (ARRAY['open'::text, 'selected'::text, 'implemented'::text, 'rejected'::text])))
);

-- platform_council_members
CREATE TABLE IF NOT EXISTS platform_council_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    cycle_month text NOT NULL,
    legacy_score bigint NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone
);

-- platform_events
CREATE TABLE IF NOT EXISTS platform_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    event_type text DEFAULT 'cultural'::text NOT NULL,
    xp_multiplier numeric(3,1) DEFAULT 1.0,
    coin_bonus_pct integer DEFAULT 0,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    target_cities text[],
    is_recurring_annual boolean DEFAULT false NOT NULL,
    recurrence_anchor_month_start integer,
    recurrence_anchor_day_start integer,
    recurrence_anchor_month_end integer,
    recurrence_anchor_day_end integer,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT platform_events_event_type_check CHECK ((event_type = ANY (ARRAY['cultural'::text, 'season_launch'::text, 'flash_xp'::text, 'guild_war_event'::text, 'mystery_drop'::text, 'platform'::text])))
);

-- push_tickets
CREATE TABLE IF NOT EXISTS push_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ticket_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    receipt_id text,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_at timestamp with time zone,
    resolved_at timestamp with time zone
);

-- quest_templates
CREATE TABLE IF NOT EXISTS quest_templates (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    action_type text NOT NULL,
    target_count integer NOT NULL,
    xp_reward integer DEFAULT 0 NOT NULL,
    coin_reward integer DEFAULT 0 NOT NULL,
    track text DEFAULT 'main'::text,
    plan_required text DEFAULT 'free'::text,
    category text DEFAULT 'general'::text NOT NULL,
    icon text,
    valid_date date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

-- rank_up_events
CREATE TABLE IF NOT EXISTS rank_up_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    rank_from text NOT NULL,
    rank_to text NOT NULL,
    xp_at_event bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- reaction_set_items
CREATE TABLE IF NOT EXISTS reaction_set_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_id uuid NOT NULL,
    emoji text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

-- reaction_sets
CREATE TABLE IF NOT EXISTS reaction_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    coin_price integer DEFAULT 100 NOT NULL,
    preview_emoji text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- referral_commissions
CREATE TABLE IF NOT EXISTS referral_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    referred_user_id uuid NOT NULL,
    trigger_event_id text NOT NULL,
    purchase_amount_kobo bigint NOT NULL,
    commission_kobo bigint NOT NULL,
    commission_coins bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    credited_at timestamp with time zone,
    tier text DEFAULT '1'::text NOT NULL
);

-- referrals
CREATE TABLE IF NOT EXISTS referrals (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    referrer_id uuid NOT NULL,
    referred_id uuid NOT NULL,
    tier integer DEFAULT 1 NOT NULL,
    qualified boolean DEFAULT false NOT NULL,
    qualified_at timestamp with time zone,
    coin_reward integer,
    xp_reward integer,
    rewarded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    code text,
    CONSTRAINT referrals_tier_check CHECK ((tier = ANY (ARRAY[1, 2])))
);

-- refunds
CREATE TABLE IF NOT EXISTS refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount_coins bigint NOT NULL,
    reason text,
    reference_id text,
    status text DEFAULT 'processed'::text NOT NULL,
    processed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);

-- reports
CREATE TABLE IF NOT EXISTS reports (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    reporter_id uuid NOT NULL,
    reported_user_id uuid,
    reported_message_id uuid,
    reported_room_id uuid,
    reported_guild_id uuid,
    report_type text NOT NULL,
    description text,
    ai_category text,
    ai_confidence numeric(5,4),
    status text DEFAULT 'pending'::text NOT NULL,
    moderator_id uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    reported_forum_question_id uuid,
    reported_forum_answer_id uuid,
    CONSTRAINT reports_report_type_check CHECK ((report_type = ANY (ARRAY['harassment'::text, 'spam'::text, 'fraud'::text, 'sexual_content'::text, 'impersonation'::text, 'hate_speech'::text, 'other'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'resolved_action'::text, 'resolved_dismissed'::text, 'escalated'::text])))
);

-- room_member_highlights
CREATE TABLE IF NOT EXISTS room_member_highlights (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    highlighted_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- room_members
CREATE TABLE IF NOT EXISTS room_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    is_muted boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    left_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_members_role_check CHECK ((role = ANY (ARRAY['creator'::text, 'admin'::text, 'co_moderator'::text, 'member'::text])))
);

-- room_message_reactions
CREATE TABLE IF NOT EXISTS room_message_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- room_messages
CREATE TABLE IF NOT EXISTS room_messages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sender_id uuid NOT NULL,
    room_id uuid,
    group_chat_id uuid,
    conversation_id uuid,
    message_type text DEFAULT 'text'::text NOT NULL,
    content text,
    media_url text,
    metadata jsonb,
    coin_cost bigint DEFAULT 0,
    reply_count_from_recipient integer DEFAULT 0,
    is_deleted boolean DEFAULT false,
    is_flagged boolean DEFAULT false,
    is_pinned boolean DEFAULT false,
    pinned_at timestamp with time zone,
    pinned_by uuid,
    pin_expires_at timestamp with time zone,
    reply_to_message_id uuid,
    is_pending_approval boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    idempotency_key text,
    CONSTRAINT room_messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text, 'gift'::text, 'moment'::text, 'system'::text, 'broadcast'::text])))
);

-- room_moderation_log
CREATE TABLE IF NOT EXISTS room_moderation_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    moderator_id uuid NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- room_monthly_active_users
CREATE TABLE IF NOT EXISTS room_monthly_active_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    month date NOT NULL,
    mau_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- room_pins
CREATE TABLE IF NOT EXISTS room_pins (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- room_promotions
CREATE TABLE IF NOT EXISTS room_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    promoted_by uuid,
    coin_cost integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- room_subscriptions
CREATE TABLE IF NOT EXISTS room_subscriptions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    amount_kobo bigint,
    started_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text])))
);

-- room_visits
CREATE TABLE IF NOT EXISTS room_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    last_visited_at timestamp with time zone DEFAULT now() NOT NULL
);

-- rooms
CREATE TABLE IF NOT EXISTS rooms (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    type text DEFAULT 'free_open'::text NOT NULL,
    category text,
    city text,
    cover_image_url text,
    cover_emoji text DEFAULT '💬'::text NOT NULL,
    is_public boolean DEFAULT true,
    max_members integer,
    member_count integer DEFAULT 0 NOT NULL,
    subscription_price_kobo bigint,
    entry_fee_kobo bigint,
    subscription_price_ngn bigint,
    entry_fee_ngn bigint,
    enrolment_fee_ngn bigint,
    curriculum jsonb,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    class_start_date date,
    class_end_date date,
    drop_starts_at timestamp with time zone,
    drop_ends_at timestamp with time zone,
    guild_id uuid,
    total_messages integer DEFAULT 0 NOT NULL,
    health_score integer DEFAULT 100,
    spotlight_until timestamp with time zone,
    spotlight_by uuid,
    moderation_rules jsonb,
    spectacle_threshold_coins integer,
    is_ad_enrolled boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    is_sponsored boolean DEFAULT false,
    sponsored_by text,
    metadata jsonb,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    duration_minutes integer,
    status text DEFAULT 'active'::text NOT NULL,
    is_suspended boolean DEFAULT false NOT NULL,
    suspended_at timestamp with time zone,
    suspended_by uuid,
    suspension_reason text,
    is_banned boolean DEFAULT false NOT NULL,
    banned_at timestamp with time zone,
    banned_by uuid,
    flagged_at timestamp with time zone,
    flagged_by uuid,
    flag_reason text,
    monetization_disabled boolean DEFAULT false NOT NULL,
    admin_notes text,
    slug text,
    CONSTRAINT rooms_enrolment_fee_ngn_max CHECK (((enrolment_fee_ngn IS NULL) OR (enrolment_fee_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_entry_fee_kobo_max CHECK (((entry_fee_kobo IS NULL) OR (entry_fee_kobo <= '1000000000000'::bigint))),
    CONSTRAINT rooms_entry_fee_ngn_max CHECK (((entry_fee_ngn IS NULL) OR (entry_fee_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_public_requires_slug CHECK ((NOT ((is_public = true) AND (slug IS NULL)))),
    CONSTRAINT rooms_subscription_price_kobo_max CHECK (((subscription_price_kobo IS NULL) OR (subscription_price_kobo <= '1000000000000'::bigint))),
    CONSTRAINT rooms_subscription_price_ngn_max CHECK (((subscription_price_ngn IS NULL) OR (subscription_price_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_type_check CHECK ((type = ANY (ARRAY['free_open'::text, 'vip'::text, 'drop'::text, 'tipping'::text, 'classroom'::text, 'guild'::text, 'limited'::text])))
);

-- season_pass_milestones
CREATE TABLE IF NOT EXISTS season_pass_milestones (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    season_id uuid NOT NULL,
    milestone_xp integer NOT NULL,
    tier text DEFAULT 'free'::text NOT NULL,
    reward_type text NOT NULL,
    reward_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    required_plan text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT season_pass_milestones_required_plan_check CHECK ((required_plan = ANY (ARRAY['pro'::text, 'max'::text])))
);

-- season_rank_archives
CREATE TABLE IF NOT EXISTS season_rank_archives (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    season_id uuid NOT NULL,
    user_id uuid NOT NULL,
    final_rank integer,
    final_season_xp bigint DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone DEFAULT now()
);

-- seasons
CREATE TABLE IF NOT EXISTS seasons (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    theme text,
    description text,
    season_number integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    pass_price_coins integer DEFAULT 500 NOT NULL,
    reward_pool_coins integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    rankings_reset_at timestamp with time zone
);

-- slug_redirects
CREATE TABLE IF NOT EXISTS slug_redirects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    old_slug text NOT NULL,
    entity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slug_redirects_entity_type_check CHECK ((entity_type = ANY (ARRAY['room'::text, 'game'::text, 'forum_question'::text])))
);

-- sponsored_leaderboard_banners
CREATE TABLE IF NOT EXISTS sponsored_leaderboard_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sponsor_name text NOT NULL,
    sponsor_logo_url text,
    cta_text text NOT NULL,
    cta_url text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- sponsored_quest_applications
CREATE TABLE IF NOT EXISTS sponsored_quest_applications (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quest_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    room_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    completion_proof text,
    completed_at timestamp with time zone,
    approved_at timestamp with time zone,
    payout_id uuid,
    payout_coins bigint,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    applied_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sponsored_quest_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'accepted'::text, 'completed'::text, 'approved'::text, 'rejected'::text, 'paid'::text])))
);

-- sponsored_quests
CREATE TABLE IF NOT EXISTS sponsored_quests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    brand_name text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    target_action text,
    target_value integer,
    reward_coins bigint,
    creator_payout_kobo bigint,
    platform_fee_kobo bigint,
    platform_share_percent integer DEFAULT 30 NOT NULL,
    creator_share_percent integer DEFAULT 70 NOT NULL,
    min_creator_tier text DEFAULT 'verified'::text NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    is_active boolean DEFAULT true,
    max_creators integer DEFAULT 10,
    created_at timestamp with time zone DEFAULT now(),
    brand_logo_url text,
    requirements text,
    max_applications integer,
    deadline timestamp with time zone
);

-- star_ledger
CREATE TABLE IF NOT EXISTS star_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint DEFAULT 0 NOT NULL,
    balance_after bigint DEFAULT 0 NOT NULL,
    transaction_type text NOT NULL,
    description text,
    reference_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- star_ledger_archive
CREATE TABLE IF NOT EXISTS star_ledger_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint DEFAULT 0 NOT NULL,
    balance_after bigint DEFAULT 0 NOT NULL,
    transaction_type text NOT NULL,
    description text,
    reference_id text,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='100');

-- sticker_packs
CREATE TABLE IF NOT EXISTS sticker_packs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    cover_emoji text DEFAULT '🎨'::text NOT NULL,
    cover_sticker_url text,
    pack_type text DEFAULT 'free'::text NOT NULL,
    coin_price integer DEFAULT 0 NOT NULL,
    unlock_condition text,
    locale text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    slug text,
    CONSTRAINT sticker_packs_pack_type_check CHECK ((pack_type = ANY (ARRAY['free'::text, 'earnable'::text, 'premium'::text])))
);

-- stickers
CREATE TABLE IF NOT EXISTS stickers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    pack_id uuid NOT NULL,
    name text NOT NULL,
    emoji text NOT NULL,
    image_url text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- store_items
CREATE TABLE IF NOT EXISTS store_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    item_type text NOT NULL,
    price_kobo bigint,
    currency text DEFAULT 'NGN'::text NOT NULL,
    coins_cost bigint,
    stars_cost integer,
    coins_granted bigint,
    stars_granted integer,
    cosmetic_type text,
    bonus_label text,
    is_featured boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_exclusive boolean DEFAULT false NOT NULL,
    season_id uuid,
    prestige_required integer,
    valid_until timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    iap_product_id text,
    CONSTRAINT store_items_item_type_check CHECK ((item_type = ANY (ARRAY['coin_pack'::text, 'star_pack'::text, 'booster'::text, 'cosmetic'::text])))
);

-- subscription_plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan text NOT NULL,
    name text NOT NULL,
    "interval" text DEFAULT 'monthly'::text NOT NULL,
    price_kobo bigint NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_plans_interval_check CHECK (("interval" = ANY (ARRAY['monthly'::text, 'annual'::text])))
);

-- subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    plan text NOT NULL,
    billing_period text DEFAULT 'monthly'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    auto_renew boolean DEFAULT true,
    provider text,
    provider_subscription_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cancelled_at timestamp with time zone,
    grace_period_ends_at timestamp with time zone,
    CONSTRAINT subscriptions_billing_period_check CHECK ((billing_period = ANY (ARRAY['monthly'::text, 'annual'::text]))),
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['plus'::text, 'pro'::text, 'max'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'expired'::text, 'paused'::text])))
);

-- system_alerts
CREATE TABLE IF NOT EXISTS system_alerts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    message text NOT NULL,
    metadata jsonb,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);

-- telegram_delivery_queue
CREATE TABLE IF NOT EXISTS telegram_delivery_queue (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    broadcast_id uuid,
    telegram_ids jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    delivered_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT telegram_delivery_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])))
);

-- telegram_login_states
CREATE TABLE IF NOT EXISTS telegram_login_states (
    state text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    token text,
    user_payload text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT telegram_login_states_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'expired'::text])))
);

-- track_milestone_unlocks
CREATE TABLE IF NOT EXISTS track_milestone_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    track text NOT NULL,
    milestone_level integer NOT NULL,
    unlock_key text,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_announcement_rotation
CREATE TABLE IF NOT EXISTS user_announcement_rotation (
    user_id uuid NOT NULL,
    content_type text NOT NULL,
    last_shown_id uuid NOT NULL,
    last_shown_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_announcement_rotation_content_type_check CHECK ((content_type = ANY (ARRAY['modal'::text, 'banner'::text])))
);

-- user_badges
CREATE TABLE IF NOT EXISTS user_badges (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    badge_type text,
    badge_key text,
    reference_id text,
    metadata jsonb,
    awarded_at timestamp with time zone DEFAULT now()
);

-- user_banner_views
CREATE TABLE IF NOT EXISTS user_banner_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    banner_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_blocks
CREATE TABLE IF NOT EXISTS user_blocks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);

-- user_cosmetics
CREATE TABLE IF NOT EXISTS user_cosmetics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    store_item_id uuid NOT NULL,
    cosmetic_type text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    metadata jsonb
);

-- user_daily_logins
CREATE TABLE IF NOT EXISTS user_daily_logins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    login_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- user_email_preferences
CREATE TABLE IF NOT EXISTS user_email_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_inactivity_events
CREATE TABLE IF NOT EXISTS user_inactivity_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    inactive_days integer NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    push_email_notified boolean DEFAULT false NOT NULL,
    telegram_notified boolean DEFAULT false NOT NULL
);

-- user_messages
CREATE TABLE IF NOT EXISTS user_messages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sender_id uuid,
    recipient_id uuid NOT NULL,
    content text NOT NULL,
    message_type text DEFAULT 'direct'::text NOT NULL,
    reference_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_messages_message_type_check CHECK ((message_type = ANY (ARRAY['direct'::text, 'broadcast'::text, 'admin'::text, 'system'::text])))
);

-- user_modal_views
CREATE TABLE IF NOT EXISTS user_modal_views (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    modal_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now()
);

-- user_pins
CREATE TABLE IF NOT EXISTS user_pins (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    pin_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- user_push_tokens
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    device_id character varying(255)
);

-- user_quest_decks
CREATE TABLE IF NOT EXISTS user_quest_decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    assigned_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_quest_progress
CREATE TABLE IF NOT EXISTS user_quest_progress (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    quest_date date NOT NULL,
    progress_count integer DEFAULT 0 NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    expired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_progress_nonneg CHECK ((progress_count >= 0))
);

-- user_reaction_sets
CREATE TABLE IF NOT EXISTS user_reaction_sets (
    user_id uuid NOT NULL,
    set_id uuid NOT NULL,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_season_milestone_claims
CREATE TABLE IF NOT EXISTS user_season_milestone_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    milestone_id uuid NOT NULL,
    claimed_at timestamp with time zone DEFAULT now()
);

-- user_season_passes
CREATE TABLE IF NOT EXISTS user_season_passes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    is_paid boolean DEFAULT false NOT NULL,
    season_xp bigint DEFAULT 0 NOT NULL,
    season_rank integer,
    purchased_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- user_sticker_packs
CREATE TABLE IF NOT EXISTS user_sticker_packs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    acquired_at timestamp with time zone DEFAULT now(),
    unlocked_at timestamp with time zone
);

-- user_subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'paystack'::text NOT NULL,
    provider_subscription_id text,
    status text DEFAULT 'active'::text NOT NULL,
    next_renewal_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_titles
CREATE TABLE IF NOT EXISTS user_titles (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    source text,
    is_active boolean DEFAULT false NOT NULL,
    awarded_at timestamp with time zone DEFAULT now()
);

-- user_xp_boosters
CREATE TABLE IF NOT EXISTS user_xp_boosters (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    multiplier integer DEFAULT 200 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    booster_type text,
    is_active boolean DEFAULT true NOT NULL
);

-- users
CREATE TABLE IF NOT EXISTS users (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    username text NOT NULL,
    display_name text NOT NULL,
    email text,
    password_hash text,
    pin_hash text,
    avatar_emoji text DEFAULT '😊'::text NOT NULL,
    bio text,
    city text,
    country text DEFAULT 'NG'::text,
    locale text DEFAULT 'en'::text,
    gender text,
    google_id text,
    telegram_id text,
    is_email_verified boolean DEFAULT false,
    totp_secret text,
    totp_enabled boolean DEFAULT false NOT NULL,
    pre_auth_session text,
    plan text DEFAULT 'free'::text NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    is_moderator boolean DEFAULT false NOT NULL,
    is_creator boolean DEFAULT false NOT NULL,
    creator_tier text DEFAULT 'rookie'::text NOT NULL,
    creator_role boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false,
    is_seed boolean DEFAULT false NOT NULL,
    is_council_member boolean DEFAULT false NOT NULL,
    trust_score integer DEFAULT 50,
    is_suspended boolean DEFAULT false,
    suspended_until timestamp with time zone,
    suspension_reason text,
    is_banned boolean DEFAULT false NOT NULL,
    ban_type text,
    banned_until timestamp with time zone,
    ban_reason text,
    dm_privacy text DEFAULT 'everyone'::text NOT NULL,
    dm_opt_out boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    xp_total bigint DEFAULT 0 NOT NULL,
    legacy_score bigint DEFAULT 0 NOT NULL,
    rank_name text DEFAULT 'Beginner'::text NOT NULL,
    rank_level integer DEFAULT 1 NOT NULL,
    rank_sublevel integer DEFAULT 1 NOT NULL,
    prestige_count integer DEFAULT 0 NOT NULL,
    prestige_cycle_boost_expires_at timestamp with time zone,
    custom_crest text,
    xp_social bigint DEFAULT 0 NOT NULL,
    xp_creator bigint DEFAULT 0 NOT NULL,
    xp_competitor bigint DEFAULT 0 NOT NULL,
    xp_generosity bigint DEFAULT 0 NOT NULL,
    xp_knowledge bigint DEFAULT 0 NOT NULL,
    xp_explorer bigint DEFAULT 0 NOT NULL,
    level_social integer DEFAULT 1 NOT NULL,
    level_creator integer DEFAULT 1 NOT NULL,
    level_competitor integer DEFAULT 1 NOT NULL,
    level_generosity integer DEFAULT 1 NOT NULL,
    level_knowledge integer DEFAULT 1 NOT NULL,
    level_explorer integer DEFAULT 1 NOT NULL,
    coin_balance bigint DEFAULT 0 NOT NULL,
    star_balance bigint DEFAULT 0 NOT NULL,
    available_earnings_kobo bigint DEFAULT 0 NOT NULL,
    payout_recipient_code text,
    payout_account_last4 text,
    login_streak integer DEFAULT 0 NOT NULL,
    login_streak_days integer DEFAULT 0 NOT NULL,
    longest_streak integer DEFAULT 0 NOT NULL,
    last_streak_before_break integer DEFAULT 0 NOT NULL,
    last_login_at timestamp with time zone,
    last_login_date date,
    last_active_at timestamp with time zone DEFAULT now(),
    guild_id uuid,
    date_of_birth date,
    vibe_quiz_responses jsonb,
    onboarding_personalization jsonb,
    onboarding_completed boolean DEFAULT false,
    new_member_quest_completed boolean DEFAULT false,
    chat_theme text DEFAULT 'default'::text NOT NULL,
    referred_by uuid,
    referral_code text,
    active_cosmetic_frame_id uuid,
    active_cosmetic_title text,
    active_frame_id text,
    hd_send_enabled boolean DEFAULT false NOT NULL,
    push_token text,
    dm_notifications boolean DEFAULT true,
    guild_notifications boolean DEFAULT true,
    streak_notifications boolean DEFAULT true,
    notify_new_message boolean DEFAULT true NOT NULL,
    notify_friend_request boolean DEFAULT true NOT NULL,
    notify_gift_received boolean DEFAULT true NOT NULL,
    notify_rank_up boolean DEFAULT true NOT NULL,
    notify_war_start boolean DEFAULT true NOT NULL,
    notify_season_end boolean DEFAULT true NOT NULL,
    notify_announcement boolean DEFAULT true NOT NULL,
    email_all_enabled boolean DEFAULT true NOT NULL,
    email_non_critical boolean DEFAULT true NOT NULL,
    nudge_email_shown_at timestamp with time zone,
    nudge_email_dismissed_at timestamp with time zone,
    first_gift_received_xp_awarded boolean DEFAULT false,
    pidgin_suggestions_enabled boolean,
    avatar_url text,
    profile_private boolean DEFAULT false NOT NULL,
    profile_hidden_sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    disable_friend_requests boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    warning_count integer DEFAULT 0 NOT NULL,
    banned_at timestamp with time zone,
    banned_by uuid,
    season_xp bigint DEFAULT 0 NOT NULL,
    plan_activated_at timestamp with time zone,
    require_2fa_setup boolean DEFAULT false NOT NULL,
    group_notifications boolean DEFAULT true NOT NULL,
    room_mention_notifications boolean DEFAULT true NOT NULL,
    xp_gaming bigint DEFAULT 0 NOT NULL,
    level_gaming integer DEFAULT 1 NOT NULL,
    sitemap_opt_out boolean DEFAULT false NOT NULL,
    show_online_status boolean DEFAULT false NOT NULL,
    CONSTRAINT users_ban_type_check CHECK ((ban_type = ANY (ARRAY['temporary'::text, 'permanent'::text]))),
    CONSTRAINT users_coin_balance_max CHECK ((coin_balance <= '1000000000000'::bigint)),
    CONSTRAINT users_creator_tier_check CHECK ((creator_tier = ANY (ARRAY['rookie'::text, 'rising'::text, 'verified'::text, 'elite'::text, 'icon'::text]))),
    CONSTRAINT users_custom_crest_check CHECK ((char_length(custom_crest) <= 500)),
    CONSTRAINT users_dm_privacy_check CHECK ((dm_privacy = ANY (ARRAY['everyone'::text, 'friends_only'::text, 'nobody'::text]))),
    CONSTRAINT users_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'non_binary'::text, 'prefer_not_to_say'::text]))),
    CONSTRAINT users_no_self_referral CHECK (((referred_by IS NULL) OR (referred_by <> id))),
    CONSTRAINT users_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text, 'max'::text]))),
    CONSTRAINT users_star_balance_max CHECK ((star_balance <= '1000000000000'::bigint)),
    CONSTRAINT users_trust_score_check CHECK (((trust_score >= 0) AND (trust_score <= 100)))
);

ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- war_contributions
CREATE TABLE IF NOT EXISTS war_contributions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    war_id uuid NOT NULL,
    user_id uuid NOT NULL,
    guild_id uuid NOT NULL,
    war_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- x_manifest
CREATE TABLE IF NOT EXISTS x_manifest (
    key text NOT NULL,
    value text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now()
);

-- xp_events
CREATE TABLE IF NOT EXISTS xp_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    xp_awarded integer NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- xp_events_archive
CREATE TABLE IF NOT EXISTS xp_events_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    xp_awarded integer NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='100');

-- xp_ledger
CREATE TABLE IF NOT EXISTS xp_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    source text NOT NULL,
    reference_id text,
    base_amount bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- xp_ledger_archive
CREATE TABLE IF NOT EXISTS xp_ledger_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    source text NOT NULL,
    reference_id text,
    base_amount integer NOT NULL,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='100');

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_pkey CASCADE;
ALTER TABLE admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);

ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_pkey CASCADE;
ALTER TABLE admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE admin_message_receipts DROP CONSTRAINT IF EXISTS admin_message_receipts_admin_message_id_user_id_key CASCADE;
ALTER TABLE admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_admin_message_id_user_id_key UNIQUE (admin_message_id, user_id);

ALTER TABLE admin_message_receipts DROP CONSTRAINT IF EXISTS admin_message_receipts_pkey CASCADE;
ALTER TABLE admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_pkey PRIMARY KEY (id);

ALTER TABLE admin_messages DROP CONSTRAINT IF EXISTS admin_messages_pkey CASCADE;
ALTER TABLE admin_messages
    ADD CONSTRAINT admin_messages_pkey PRIMARY KEY (id);

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_pkey CASCADE;
ALTER TABLE admin_roles
    ADD CONSTRAINT admin_roles_pkey PRIMARY KEY (id);

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_user_id_role_key CASCADE;
ALTER TABLE admin_roles
    ADD CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role);

ALTER TABLE alliance_wars DROP CONSTRAINT IF EXISTS alliance_wars_pkey CASCADE;
ALTER TABLE alliance_wars
    ADD CONSTRAINT alliance_wars_pkey PRIMARY KEY (id);

ALTER TABLE announcement_banners DROP CONSTRAINT IF EXISTS announcement_banners_pkey CASCADE;
ALTER TABLE announcement_banners
    ADD CONSTRAINT announcement_banners_pkey PRIMARY KEY (id);

ALTER TABLE announcement_modals DROP CONSTRAINT IF EXISTS announcement_modals_pkey CASCADE;
ALTER TABLE announcement_modals
    ADD CONSTRAINT announcement_modals_pkey PRIMARY KEY (id);

ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey CASCADE;
ALTER TABLE app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);

ALTER TABLE audit_discrepancies DROP CONSTRAINT IF EXISTS audit_discrepancies_pkey CASCADE;
ALTER TABLE audit_discrepancies
    ADD CONSTRAINT audit_discrepancies_pkey PRIMARY KEY (id);

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_pkey CASCADE;
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE automated_actions_log DROP CONSTRAINT IF EXISTS automated_actions_log_pkey CASCADE;
ALTER TABLE automated_actions_log
    ADD CONSTRAINT automated_actions_log_pkey PRIMARY KEY (id);

ALTER TABLE branded_rooms DROP CONSTRAINT IF EXISTS branded_rooms_pkey CASCADE;
ALTER TABLE branded_rooms
    ADD CONSTRAINT branded_rooms_pkey PRIMARY KEY (id);

ALTER TABLE business_accounts DROP CONSTRAINT IF EXISTS business_accounts_pkey CASCADE;
ALTER TABLE business_accounts
    ADD CONSTRAINT business_accounts_pkey PRIMARY KEY (id);

ALTER TABLE business_accounts DROP CONSTRAINT IF EXISTS business_accounts_user_id_key CASCADE;
ALTER TABLE business_accounts
    ADD CONSTRAINT business_accounts_user_id_key UNIQUE (user_id);

ALTER TABLE classroom_enrolments DROP CONSTRAINT IF EXISTS classroom_enrolments_pkey CASCADE;
ALTER TABLE classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_pkey PRIMARY KEY (id);

ALTER TABLE classroom_enrolments DROP CONSTRAINT IF EXISTS classroom_enrolments_room_id_user_id_key CASCADE;
ALTER TABLE classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_room_id_user_id_key UNIQUE (room_id, user_id);

ALTER TABLE classroom_quiz_attempts DROP CONSTRAINT IF EXISTS classroom_quiz_attempts_pkey CASCADE;
ALTER TABLE classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_pkey PRIMARY KEY (id);

ALTER TABLE classroom_quiz_attempts DROP CONSTRAINT IF EXISTS classroom_quiz_attempts_quiz_id_user_id_key CASCADE;
ALTER TABLE classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_quiz_id_user_id_key UNIQUE (quiz_id, user_id);

ALTER TABLE classroom_quiz_questions DROP CONSTRAINT IF EXISTS classroom_quiz_questions_pkey CASCADE;
ALTER TABLE classroom_quiz_questions
    ADD CONSTRAINT classroom_quiz_questions_pkey PRIMARY KEY (id);

ALTER TABLE classroom_quizzes DROP CONSTRAINT IF EXISTS classroom_quizzes_pkey CASCADE;
ALTER TABLE classroom_quizzes
    ADD CONSTRAINT classroom_quizzes_pkey PRIMARY KEY (id);

ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_pkey CASCADE;
ALTER TABLE coin_ledger
    ADD CONSTRAINT coin_ledger_pkey PRIMARY KEY (id);

ALTER TABLE community_note_votes DROP CONSTRAINT IF EXISTS community_note_votes_note_id_user_id_key CASCADE;
ALTER TABLE community_note_votes
    ADD CONSTRAINT community_note_votes_note_id_user_id_key UNIQUE (note_id, user_id);

ALTER TABLE community_note_votes DROP CONSTRAINT IF EXISTS community_note_votes_pkey CASCADE;
ALTER TABLE community_note_votes
    ADD CONSTRAINT community_note_votes_pkey PRIMARY KEY (id);

ALTER TABLE community_notes DROP CONSTRAINT IF EXISTS community_notes_pkey CASCADE;
ALTER TABLE community_notes
    ADD CONSTRAINT community_notes_pkey PRIMARY KEY (id);

ALTER TABLE conversation_scores DROP CONSTRAINT IF EXISTS conversation_scores_pkey CASCADE;
ALTER TABLE conversation_scores
    ADD CONSTRAINT conversation_scores_pkey PRIMARY KEY (user_id_1, user_id_2);

ALTER TABLE council_invitations DROP CONSTRAINT IF EXISTS council_invitations_pkey CASCADE;
ALTER TABLE council_invitations
    ADD CONSTRAINT council_invitations_pkey PRIMARY KEY (id);

ALTER TABLE creator_bank_accounts DROP CONSTRAINT IF EXISTS creator_bank_accounts_pkey CASCADE;
ALTER TABLE creator_bank_accounts
    ADD CONSTRAINT creator_bank_accounts_pkey PRIMARY KEY (id);

ALTER TABLE creator_broadcasts DROP CONSTRAINT IF EXISTS creator_broadcasts_pkey CASCADE;
ALTER TABLE creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_pkey PRIMARY KEY (id);

ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_pkey CASCADE;
ALTER TABLE creator_earnings
    ADD CONSTRAINT creator_earnings_pkey PRIMARY KEY (id);

ALTER TABLE creator_kyc DROP CONSTRAINT IF EXISTS creator_kyc_creator_id_key CASCADE;
ALTER TABLE creator_kyc
    ADD CONSTRAINT creator_kyc_creator_id_key UNIQUE (creator_id);

ALTER TABLE creator_kyc DROP CONSTRAINT IF EXISTS creator_kyc_pkey CASCADE;
ALTER TABLE creator_kyc
    ADD CONSTRAINT creator_kyc_pkey PRIMARY KEY (id);

ALTER TABLE creator_payouts DROP CONSTRAINT IF EXISTS creator_payouts_idempotency_key_key CASCADE;
ALTER TABLE creator_payouts
    ADD CONSTRAINT creator_payouts_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE creator_payouts DROP CONSTRAINT IF EXISTS creator_payouts_pkey CASCADE;
ALTER TABLE creator_payouts
    ADD CONSTRAINT creator_payouts_pkey PRIMARY KEY (id);

ALTER TABLE creator_spotlights DROP CONSTRAINT IF EXISTS creator_spotlights_pkey CASCADE;
ALTER TABLE creator_spotlights
    ADD CONSTRAINT creator_spotlights_pkey PRIMARY KEY (id);

ALTER TABLE creator_wallet_addresses DROP CONSTRAINT IF EXISTS creator_wallet_addresses_creator_id_key CASCADE;
ALTER TABLE creator_wallet_addresses
    ADD CONSTRAINT creator_wallet_addresses_creator_id_key UNIQUE (creator_id);

ALTER TABLE creator_wallet_addresses DROP CONSTRAINT IF EXISTS creator_wallet_addresses_pkey CASCADE;
ALTER TABLE creator_wallet_addresses
    ADD CONSTRAINT creator_wallet_addresses_pkey PRIMARY KEY (id);

ALTER TABLE cron_state DROP CONSTRAINT IF EXISTS cron_state_pkey CASCADE;
ALTER TABLE cron_state
    ADD CONSTRAINT cron_state_pkey PRIMARY KEY (key);

ALTER TABLE data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_pkey CASCADE;
ALTER TABLE data_export_requests
    ADD CONSTRAINT data_export_requests_pkey PRIMARY KEY (id);

ALTER TABLE dm_conversation_score_milestones DROP CONSTRAINT IF EXISTS dm_conversation_score_milesto_user_id_a_user_id_b_milestone_key CASCADE;
ALTER TABLE dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milesto_user_id_a_user_id_b_milestone_key UNIQUE (user_id_a, user_id_b, milestone_score);

ALTER TABLE dm_conversation_score_milestones DROP CONSTRAINT IF EXISTS dm_conversation_score_milestones_pkey CASCADE;
ALTER TABLE dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milestones_pkey PRIMARY KEY (id);

ALTER TABLE dm_conversation_unlocks DROP CONSTRAINT IF EXISTS dm_conversation_unlocks_conversation_key_key CASCADE;
ALTER TABLE dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_conversation_key_key UNIQUE (conversation_key);

ALTER TABLE dm_conversation_unlocks DROP CONSTRAINT IF EXISTS dm_conversation_unlocks_pkey CASCADE;
ALTER TABLE dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_pkey PRIMARY KEY (id);

ALTER TABLE dm_conversations DROP CONSTRAINT IF EXISTS dm_conversations_pkey CASCADE;
ALTER TABLE dm_conversations
    ADD CONSTRAINT dm_conversations_pkey PRIMARY KEY (id);

ALTER TABLE dm_conversations DROP CONSTRAINT IF EXISTS dm_conversations_user_id_1_user_id_2_key CASCADE;
ALTER TABLE dm_conversations
    ADD CONSTRAINT dm_conversations_user_id_1_user_id_2_key UNIQUE (user_id_1, user_id_2);

ALTER TABLE dm_score_sticker_unlocks DROP CONSTRAINT IF EXISTS dm_score_sticker_unlocks_pkey CASCADE;
ALTER TABLE dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_pkey PRIMARY KEY (id);

ALTER TABLE dm_score_sticker_unlocks DROP CONSTRAINT IF EXISTS dm_score_sticker_unlocks_user_id_1_user_id_2_pack_name_key CASCADE;
ALTER TABLE dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_user_id_1_user_id_2_pack_name_key UNIQUE (user_id_1, user_id_2, pack_name);

ALTER TABLE drop_room_replays DROP CONSTRAINT IF EXISTS drop_room_replays_pkey CASCADE;
ALTER TABLE drop_room_replays
    ADD CONSTRAINT drop_room_replays_pkey PRIMARY KEY (id);

ALTER TABLE drop_room_replays DROP CONSTRAINT IF EXISTS drop_room_replays_room_id_key CASCADE;
ALTER TABLE drop_room_replays
    ADD CONSTRAINT drop_room_replays_room_id_key UNIQUE (room_id);

ALTER TABLE elder_mentorships DROP CONSTRAINT IF EXISTS elder_mentorships_elder_id_mentee_id_key CASCADE;
ALTER TABLE elder_mentorships
    ADD CONSTRAINT elder_mentorships_elder_id_mentee_id_key UNIQUE (elder_id, mentee_id);

ALTER TABLE elder_mentorships DROP CONSTRAINT IF EXISTS elder_mentorships_pkey CASCADE;
ALTER TABLE elder_mentorships
    ADD CONSTRAINT elder_mentorships_pkey PRIMARY KEY (id);

ALTER TABLE elder_requests DROP CONSTRAINT IF EXISTS elder_requests_mentee_id_elder_id_key CASCADE;
ALTER TABLE elder_requests
    ADD CONSTRAINT elder_requests_mentee_id_elder_id_key UNIQUE (mentee_id, elder_id);

ALTER TABLE elder_requests DROP CONSTRAINT IF EXISTS elder_requests_pkey CASCADE;
ALTER TABLE elder_requests
    ADD CONSTRAINT elder_requests_pkey PRIMARY KEY (id);

ALTER TABLE failed_commissions DROP CONSTRAINT IF EXISTS failed_commissions_pkey CASCADE;
ALTER TABLE failed_commissions
    ADD CONSTRAINT failed_commissions_pkey PRIMARY KEY (id);

ALTER TABLE failed_webhooks DROP CONSTRAINT IF EXISTS failed_webhooks_pkey CASCADE;
ALTER TABLE failed_webhooks
    ADD CONSTRAINT failed_webhooks_pkey PRIMARY KEY (id);

ALTER TABLE failed_xp_awards DROP CONSTRAINT IF EXISTS failed_xp_awards_pkey CASCADE;
ALTER TABLE failed_xp_awards
    ADD CONSTRAINT failed_xp_awards_pkey PRIMARY KEY (id);

ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_pkey CASCADE;
ALTER TABLE feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);

ALTER TABLE flash_xp_events DROP CONSTRAINT IF EXISTS flash_xp_events_pkey CASCADE;
ALTER TABLE flash_xp_events
    ADD CONSTRAINT flash_xp_events_pkey PRIMARY KEY (id);

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follower_id_following_id_key CASCADE;
ALTER TABLE follows
    ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_pkey CASCADE;
ALTER TABLE follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);

ALTER TABLE footer_scripts DROP CONSTRAINT IF EXISTS footer_scripts_pkey CASCADE;
ALTER TABLE footer_scripts
    ADD CONSTRAINT footer_scripts_pkey PRIMARY KEY (id);

ALTER TABLE forum_answers DROP CONSTRAINT IF EXISTS forum_answers_pkey CASCADE;
ALTER TABLE forum_answers
    ADD CONSTRAINT forum_answers_pkey PRIMARY KEY (id);

ALTER TABLE forum_categories DROP CONSTRAINT IF EXISTS forum_categories_pkey CASCADE;
ALTER TABLE forum_categories
    ADD CONSTRAINT forum_categories_pkey PRIMARY KEY (id);

ALTER TABLE forum_favorites DROP CONSTRAINT IF EXISTS forum_favorites_pkey CASCADE;
ALTER TABLE forum_favorites
    ADD CONSTRAINT forum_favorites_pkey PRIMARY KEY (id);

ALTER TABLE forum_favorites DROP CONSTRAINT IF EXISTS forum_favorites_user_id_question_id_key CASCADE;
ALTER TABLE forum_favorites
    ADD CONSTRAINT forum_favorites_user_id_question_id_key UNIQUE (user_id, question_id);

ALTER TABLE forum_moderation_log DROP CONSTRAINT IF EXISTS forum_moderation_log_pkey CASCADE;
ALTER TABLE forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_pkey PRIMARY KEY (id);

ALTER TABLE forum_questions DROP CONSTRAINT IF EXISTS forum_questions_pkey CASCADE;
ALTER TABLE forum_questions
    ADD CONSTRAINT forum_questions_pkey PRIMARY KEY (id);

ALTER TABLE forum_votes DROP CONSTRAINT IF EXISTS forum_votes_pkey CASCADE;
ALTER TABLE forum_votes
    ADD CONSTRAINT forum_votes_pkey PRIMARY KEY (id);

ALTER TABLE forum_votes DROP CONSTRAINT IF EXISTS forum_votes_target_type_target_id_user_id_key CASCADE;
ALTER TABLE forum_votes
    ADD CONSTRAINT forum_votes_target_type_target_id_user_id_key UNIQUE (target_type, target_id, user_id);

ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_pkey CASCADE;
ALTER TABLE friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);

ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_requester_id_addressee_id_key CASCADE;
ALTER TABLE friendships
    ADD CONSTRAINT friendships_requester_id_addressee_id_key UNIQUE (requester_id, addressee_id);

ALTER TABLE game_best_scores DROP CONSTRAINT IF EXISTS game_best_scores_pkey CASCADE;
ALTER TABLE game_best_scores
    ADD CONSTRAINT game_best_scores_pkey PRIMARY KEY (game_id, user_id);

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_challenge_id_round_no_key CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_challenge_id_round_no_key UNIQUE (challenge_id, round_no);

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_pkey CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_pkey PRIMARY KEY (id);

ALTER TABLE game_challenges DROP CONSTRAINT IF EXISTS game_challenges_pkey CASCADE;
ALTER TABLE game_challenges
    ADD CONSTRAINT game_challenges_pkey PRIMARY KEY (id);

ALTER TABLE game_favorites DROP CONSTRAINT IF EXISTS game_favorites_pkey CASCADE;
ALTER TABLE game_favorites
    ADD CONSTRAINT game_favorites_pkey PRIMARY KEY (id);

ALTER TABLE game_favorites DROP CONSTRAINT IF EXISTS game_favorites_user_id_game_id_key CASCADE;
ALTER TABLE game_favorites
    ADD CONSTRAINT game_favorites_user_id_game_id_key UNIQUE (user_id, game_id);

ALTER TABLE game_milestone_claims DROP CONSTRAINT IF EXISTS game_milestone_claims_pkey CASCADE;
ALTER TABLE game_milestone_claims
    ADD CONSTRAINT game_milestone_claims_pkey PRIMARY KEY (user_id, threshold);

ALTER TABLE game_play_milestones DROP CONSTRAINT IF EXISTS game_play_milestones_games_played_threshold_key CASCADE;
ALTER TABLE game_play_milestones
    ADD CONSTRAINT game_play_milestones_games_played_threshold_key UNIQUE (games_played_threshold);

ALTER TABLE game_play_milestones DROP CONSTRAINT IF EXISTS game_play_milestones_pkey CASCADE;
ALTER TABLE game_play_milestones
    ADD CONSTRAINT game_play_milestones_pkey PRIMARY KEY (id);

ALTER TABLE game_plays DROP CONSTRAINT IF EXISTS game_plays_pkey CASCADE;
ALTER TABLE game_plays
    ADD CONSTRAINT game_plays_pkey PRIMARY KEY (id);

ALTER TABLE game_ratings DROP CONSTRAINT IF EXISTS game_ratings_pkey CASCADE;
ALTER TABLE game_ratings
    ADD CONSTRAINT game_ratings_pkey PRIMARY KEY (game_id, user_id);

ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_pkey CASCADE;
ALTER TABLE game_saves
    ADD CONSTRAINT game_saves_pkey PRIMARY KEY (id);

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_pkey CASCADE;
ALTER TABLE games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);

ALTER TABLE gift_items DROP CONSTRAINT IF EXISTS gift_items_name_key CASCADE;
ALTER TABLE gift_items
    ADD CONSTRAINT gift_items_name_key UNIQUE (name);

ALTER TABLE gift_items DROP CONSTRAINT IF EXISTS gift_items_pkey CASCADE;
ALTER TABLE gift_items
    ADD CONSTRAINT gift_items_pkey PRIMARY KEY (id);

ALTER TABLE gift_types DROP CONSTRAINT IF EXISTS gift_types_name_key CASCADE;
ALTER TABLE gift_types
    ADD CONSTRAINT gift_types_name_key UNIQUE (name);

ALTER TABLE gift_types DROP CONSTRAINT IF EXISTS gift_types_pkey CASCADE;
ALTER TABLE gift_types
    ADD CONSTRAINT gift_types_pkey PRIMARY KEY (id);

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_pkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_pkey PRIMARY KEY (id);

ALTER TABLE group_chat_members DROP CONSTRAINT IF EXISTS group_chat_members_group_chat_id_user_id_key CASCADE;
ALTER TABLE group_chat_members
    ADD CONSTRAINT group_chat_members_group_chat_id_user_id_key UNIQUE (group_chat_id, user_id);

ALTER TABLE group_chat_members DROP CONSTRAINT IF EXISTS group_chat_members_pkey CASCADE;
ALTER TABLE group_chat_members
    ADD CONSTRAINT group_chat_members_pkey PRIMARY KEY (id);

ALTER TABLE group_chats DROP CONSTRAINT IF EXISTS group_chats_pkey CASCADE;
ALTER TABLE group_chats
    ADD CONSTRAINT group_chats_pkey PRIMARY KEY (id);

ALTER TABLE guild_alliance_members DROP CONSTRAINT IF EXISTS guild_alliance_members_alliance_id_guild_id_key CASCADE;
ALTER TABLE guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_alliance_id_guild_id_key UNIQUE (alliance_id, guild_id);

ALTER TABLE guild_alliance_members DROP CONSTRAINT IF EXISTS guild_alliance_members_pkey CASCADE;
ALTER TABLE guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_pkey PRIMARY KEY (id);

ALTER TABLE guild_alliances DROP CONSTRAINT IF EXISTS guild_alliances_name_key CASCADE;
ALTER TABLE guild_alliances
    ADD CONSTRAINT guild_alliances_name_key UNIQUE (name);

ALTER TABLE guild_alliances DROP CONSTRAINT IF EXISTS guild_alliances_pkey CASCADE;
ALTER TABLE guild_alliances
    ADD CONSTRAINT guild_alliances_pkey PRIMARY KEY (id);

ALTER TABLE guild_applications DROP CONSTRAINT IF EXISTS guild_applications_guild_id_user_id_key CASCADE;
ALTER TABLE guild_applications
    ADD CONSTRAINT guild_applications_guild_id_user_id_key UNIQUE (guild_id, user_id);

ALTER TABLE guild_applications DROP CONSTRAINT IF EXISTS guild_applications_pkey CASCADE;
ALTER TABLE guild_applications
    ADD CONSTRAINT guild_applications_pkey PRIMARY KEY (id);

ALTER TABLE guild_contribution_alerts DROP CONSTRAINT IF EXISTS guild_contribution_alerts_guild_id_user_id_key CASCADE;
ALTER TABLE guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_guild_id_user_id_key UNIQUE (guild_id, user_id);

ALTER TABLE guild_contribution_alerts DROP CONSTRAINT IF EXISTS guild_contribution_alerts_pkey CASCADE;
ALTER TABLE guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_pkey PRIMARY KEY (id);

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_pkey CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_pkey PRIMARY KEY (id);

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_token_key CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_token_key UNIQUE (token);

ALTER TABLE guild_members DROP CONSTRAINT IF EXISTS guild_members_guild_id_user_id_key CASCADE;
ALTER TABLE guild_members
    ADD CONSTRAINT guild_members_guild_id_user_id_key UNIQUE (guild_id, user_id);

ALTER TABLE guild_members DROP CONSTRAINT IF EXISTS guild_members_pkey CASCADE;
ALTER TABLE guild_members
    ADD CONSTRAINT guild_members_pkey PRIMARY KEY (id);

ALTER TABLE guild_messages DROP CONSTRAINT IF EXISTS guild_messages_pkey CASCADE;
ALTER TABLE guild_messages
    ADD CONSTRAINT guild_messages_pkey PRIMARY KEY (id);

ALTER TABLE guild_quest_contributions DROP CONSTRAINT IF EXISTS guild_quest_contributions_pkey CASCADE;
ALTER TABLE guild_quest_contributions
    ADD CONSTRAINT guild_quest_contributions_pkey PRIMARY KEY (id);

ALTER TABLE guild_quests DROP CONSTRAINT IF EXISTS guild_quests_pkey CASCADE;
ALTER TABLE guild_quests
    ADD CONSTRAINT guild_quests_pkey PRIMARY KEY (id);

ALTER TABLE guild_rooms DROP CONSTRAINT IF EXISTS guild_rooms_guild_id_room_id_key CASCADE;
ALTER TABLE guild_rooms
    ADD CONSTRAINT guild_rooms_guild_id_room_id_key UNIQUE (guild_id, room_id);

ALTER TABLE guild_rooms DROP CONSTRAINT IF EXISTS guild_rooms_pkey CASCADE;
ALTER TABLE guild_rooms
    ADD CONSTRAINT guild_rooms_pkey PRIMARY KEY (id);

ALTER TABLE guild_tier_history DROP CONSTRAINT IF EXISTS guild_tier_history_pkey CASCADE;
ALTER TABLE guild_tier_history
    ADD CONSTRAINT guild_tier_history_pkey PRIMARY KEY (id);

ALTER TABLE guild_treasury_ledger DROP CONSTRAINT IF EXISTS guild_treasury_ledger_pkey CASCADE;
ALTER TABLE guild_treasury_ledger
    ADD CONSTRAINT guild_treasury_ledger_pkey PRIMARY KEY (id);

ALTER TABLE guild_war_rematch_tokens DROP CONSTRAINT IF EXISTS guild_war_rematch_tokens_pkey CASCADE;
ALTER TABLE guild_war_rematch_tokens
    ADD CONSTRAINT guild_war_rematch_tokens_pkey PRIMARY KEY (id);

ALTER TABLE guild_wars DROP CONSTRAINT IF EXISTS guild_wars_pkey CASCADE;
ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_pkey PRIMARY KEY (id);

ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_name_key CASCADE;
ALTER TABLE guilds
    ADD CONSTRAINT guilds_name_key UNIQUE (name);

ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_pkey CASCADE;
ALTER TABLE guilds
    ADD CONSTRAINT guilds_pkey PRIMARY KEY (id);

ALTER TABLE hall_of_fame DROP CONSTRAINT IF EXISTS hall_of_fame_pkey CASCADE;
ALTER TABLE hall_of_fame
    ADD CONSTRAINT hall_of_fame_pkey PRIMARY KEY (id);

ALTER TABLE hall_of_fame DROP CONSTRAINT IF EXISTS hall_of_fame_user_id_key CASCADE;
ALTER TABLE hall_of_fame
    ADD CONSTRAINT hall_of_fame_user_id_key UNIQUE (user_id);

ALTER TABLE leaderboard_rank_snapshots DROP CONSTRAINT IF EXISTS leaderboard_rank_snapshots_pkey CASCADE;
ALTER TABLE leaderboard_rank_snapshots
    ADD CONSTRAINT leaderboard_rank_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE leaderboard_rank_snapshots DROP CONSTRAINT IF EXISTS leaderboard_rank_snapshots_user_id_scope_key CASCADE;
ALTER TABLE leaderboard_rank_snapshots
    ADD CONSTRAINT leaderboard_rank_snapshots_user_id_scope_key UNIQUE (user_id, scope);

ALTER TABLE leaderboard_snapshots DROP CONSTRAINT IF EXISTS leaderboard_snapshots_pkey CASCADE;
ALTER TABLE leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE leaderboard_snapshots DROP CONSTRAINT IF EXISTS leaderboard_snapshots_user_id_track_scope_city_season_id_key CASCADE;
ALTER TABLE leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_user_id_track_scope_city_season_id_key UNIQUE (user_id, track, scope, city, season_id);

ALTER TABLE learning_certificates DROP CONSTRAINT IF EXISTS learning_certificates_pkey CASCADE;
ALTER TABLE learning_certificates
    ADD CONSTRAINT learning_certificates_pkey PRIMARY KEY (id);

ALTER TABLE merch_orders DROP CONSTRAINT IF EXISTS merch_orders_pkey CASCADE;
ALTER TABLE merch_orders
    ADD CONSTRAINT merch_orders_pkey PRIMARY KEY (id);

ALTER TABLE merch_products DROP CONSTRAINT IF EXISTS merch_products_pkey CASCADE;
ALTER TABLE merch_products
    ADD CONSTRAINT merch_products_pkey PRIMARY KEY (id);

ALTER TABLE merch_stores DROP CONSTRAINT IF EXISTS merch_stores_creator_id_key CASCADE;
ALTER TABLE merch_stores
    ADD CONSTRAINT merch_stores_creator_id_key UNIQUE (creator_id);

ALTER TABLE merch_stores DROP CONSTRAINT IF EXISTS merch_stores_pkey CASCADE;
ALTER TABLE merch_stores
    ADD CONSTRAINT merch_stores_pkey PRIMARY KEY (id);

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_message_id_user_id_emoji_key CASCADE;
ALTER TABLE message_reactions
    ADD CONSTRAINT message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_pkey CASCADE;
ALTER TABLE message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_pkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_pkey CASCADE;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);

ALTER TABLE moderation_ai_escalations DROP CONSTRAINT IF EXISTS moderation_ai_escalations_pkey CASCADE;
ALTER TABLE moderation_ai_escalations
    ADD CONSTRAINT moderation_ai_escalations_pkey PRIMARY KEY (id);

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_pkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_pkey PRIMARY KEY (id);

ALTER TABLE moment_reactions DROP CONSTRAINT IF EXISTS moment_reactions_moment_id_user_id_key CASCADE;
ALTER TABLE moment_reactions
    ADD CONSTRAINT moment_reactions_moment_id_user_id_key UNIQUE (moment_id, user_id);

ALTER TABLE moment_reactions DROP CONSTRAINT IF EXISTS moment_reactions_pkey CASCADE;
ALTER TABLE moment_reactions
    ADD CONSTRAINT moment_reactions_pkey PRIMARY KEY (id);

ALTER TABLE moment_views DROP CONSTRAINT IF EXISTS moment_views_moment_id_viewer_id_key CASCADE;
ALTER TABLE moment_views
    ADD CONSTRAINT moment_views_moment_id_viewer_id_key UNIQUE (moment_id, viewer_id);

ALTER TABLE moment_views DROP CONSTRAINT IF EXISTS moment_views_pkey CASCADE;
ALTER TABLE moment_views
    ADD CONSTRAINT moment_views_pkey PRIMARY KEY (id);

ALTER TABLE moments DROP CONSTRAINT IF EXISTS moments_pkey CASCADE;
ALTER TABLE moments
    ADD CONSTRAINT moments_pkey PRIMARY KEY (id);

ALTER TABLE monthly_gift_drops DROP CONSTRAINT IF EXISTS monthly_gift_drops_pkey CASCADE;
ALTER TABLE monthly_gift_drops
    ADD CONSTRAINT monthly_gift_drops_pkey PRIMARY KEY (id);

ALTER TABLE nemesis_assignments DROP CONSTRAINT IF EXISTS nemesis_assignments_pkey CASCADE;
ALTER TABLE nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_pkey PRIMARY KEY (id);

ALTER TABLE nemesis_challenges DROP CONSTRAINT IF EXISTS nemesis_challenges_pkey CASCADE;
ALTER TABLE nemesis_challenges
    ADD CONSTRAINT nemesis_challenges_pkey PRIMARY KEY (id);

ALTER TABLE new_member_quests DROP CONSTRAINT IF EXISTS new_member_quests_pkey CASCADE;
ALTER TABLE new_member_quests
    ADD CONSTRAINT new_member_quests_pkey PRIMARY KEY (id);

ALTER TABLE new_member_quests DROP CONSTRAINT IF EXISTS new_member_quests_user_id_quest_type_key CASCADE;
ALTER TABLE new_member_quests
    ADD CONSTRAINT new_member_quests_user_id_quest_type_key UNIQUE (user_id, quest_type);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_pkey CASCADE;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_pkey CASCADE;
ALTER TABLE password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_token_hash_key CASCADE;
ALTER TABLE password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_idempotency_key_key CASCADE;
ALTER TABLE payments
    ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_pkey CASCADE;
ALTER TABLE payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_reference_key CASCADE;
ALTER TABLE payments
    ADD CONSTRAINT payments_provider_reference_key UNIQUE (provider_reference);

ALTER TABLE payout_dead_letter_queue DROP CONSTRAINT IF EXISTS payout_dead_letter_queue_pkey CASCADE;
ALTER TABLE payout_dead_letter_queue
    ADD CONSTRAINT payout_dead_letter_queue_pkey PRIMARY KEY (id);

ALTER TABLE platform_council_ideas DROP CONSTRAINT IF EXISTS platform_council_ideas_pkey CASCADE;
ALTER TABLE platform_council_ideas
    ADD CONSTRAINT platform_council_ideas_pkey PRIMARY KEY (id);

ALTER TABLE platform_council_members DROP CONSTRAINT IF EXISTS platform_council_members_pkey CASCADE;
ALTER TABLE platform_council_members
    ADD CONSTRAINT platform_council_members_pkey PRIMARY KEY (id);

ALTER TABLE platform_council_members DROP CONSTRAINT IF EXISTS platform_council_members_user_id_key CASCADE;
ALTER TABLE platform_council_members
    ADD CONSTRAINT platform_council_members_user_id_key UNIQUE (user_id);

ALTER TABLE platform_events DROP CONSTRAINT IF EXISTS platform_events_name_key CASCADE;
ALTER TABLE platform_events
    ADD CONSTRAINT platform_events_name_key UNIQUE (name);

ALTER TABLE platform_events DROP CONSTRAINT IF EXISTS platform_events_pkey CASCADE;
ALTER TABLE platform_events
    ADD CONSTRAINT platform_events_pkey PRIMARY KEY (id);

ALTER TABLE push_tickets DROP CONSTRAINT IF EXISTS push_tickets_pkey CASCADE;
ALTER TABLE push_tickets
    ADD CONSTRAINT push_tickets_pkey PRIMARY KEY (id);

ALTER TABLE push_tickets DROP CONSTRAINT IF EXISTS push_tickets_ticket_id_key CASCADE;
ALTER TABLE push_tickets
    ADD CONSTRAINT push_tickets_ticket_id_key UNIQUE (ticket_id);

ALTER TABLE quest_templates DROP CONSTRAINT IF EXISTS quest_templates_pkey CASCADE;
ALTER TABLE quest_templates
    ADD CONSTRAINT quest_templates_pkey PRIMARY KEY (id);

ALTER TABLE quest_templates DROP CONSTRAINT IF EXISTS quest_templates_title_key CASCADE;
ALTER TABLE quest_templates
    ADD CONSTRAINT quest_templates_title_key UNIQUE (title);

ALTER TABLE rank_up_events DROP CONSTRAINT IF EXISTS rank_up_events_pkey CASCADE;
ALTER TABLE rank_up_events
    ADD CONSTRAINT rank_up_events_pkey PRIMARY KEY (id);

ALTER TABLE reaction_set_items DROP CONSTRAINT IF EXISTS reaction_set_items_pkey CASCADE;
ALTER TABLE reaction_set_items
    ADD CONSTRAINT reaction_set_items_pkey PRIMARY KEY (id);

ALTER TABLE reaction_sets DROP CONSTRAINT IF EXISTS reaction_sets_pkey CASCADE;
ALTER TABLE reaction_sets
    ADD CONSTRAINT reaction_sets_pkey PRIMARY KEY (id);

ALTER TABLE referral_commissions DROP CONSTRAINT IF EXISTS referral_commissions_pkey CASCADE;
ALTER TABLE referral_commissions
    ADD CONSTRAINT referral_commissions_pkey PRIMARY KEY (id);

ALTER TABLE referral_commissions DROP CONSTRAINT IF EXISTS referral_commissions_trigger_event_id_key CASCADE;
ALTER TABLE referral_commissions
    ADD CONSTRAINT referral_commissions_trigger_event_id_key UNIQUE (trigger_event_id);

ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_pkey CASCADE;
ALTER TABLE referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);

ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_referred_id_key CASCADE;
ALTER TABLE referrals
    ADD CONSTRAINT referrals_referrer_id_referred_id_key UNIQUE (referrer_id, referred_id);

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_pkey CASCADE;
ALTER TABLE refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_pkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE room_member_highlights DROP CONSTRAINT IF EXISTS room_member_highlights_pkey CASCADE;
ALTER TABLE room_member_highlights
    ADD CONSTRAINT room_member_highlights_pkey PRIMARY KEY (id);

ALTER TABLE room_member_highlights DROP CONSTRAINT IF EXISTS room_member_highlights_room_id_user_id_key CASCADE;
ALTER TABLE room_member_highlights
    ADD CONSTRAINT room_member_highlights_room_id_user_id_key UNIQUE (room_id, user_id);

ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_pkey CASCADE;
ALTER TABLE room_members
    ADD CONSTRAINT room_members_pkey PRIMARY KEY (id);

ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_room_id_user_id_key CASCADE;
ALTER TABLE room_members
    ADD CONSTRAINT room_members_room_id_user_id_key UNIQUE (room_id, user_id);

ALTER TABLE room_message_reactions DROP CONSTRAINT IF EXISTS room_message_reactions_message_id_user_id_emoji_key CASCADE;
ALTER TABLE room_message_reactions
    ADD CONSTRAINT room_message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);

ALTER TABLE room_message_reactions DROP CONSTRAINT IF EXISTS room_message_reactions_pkey CASCADE;
ALTER TABLE room_message_reactions
    ADD CONSTRAINT room_message_reactions_pkey PRIMARY KEY (id);

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_pkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_pkey PRIMARY KEY (id);

ALTER TABLE room_moderation_log DROP CONSTRAINT IF EXISTS room_moderation_log_pkey CASCADE;
ALTER TABLE room_moderation_log
    ADD CONSTRAINT room_moderation_log_pkey PRIMARY KEY (id);

ALTER TABLE room_monthly_active_users DROP CONSTRAINT IF EXISTS room_monthly_active_users_pkey CASCADE;
ALTER TABLE room_monthly_active_users
    ADD CONSTRAINT room_monthly_active_users_pkey PRIMARY KEY (id);

ALTER TABLE room_monthly_active_users DROP CONSTRAINT IF EXISTS room_monthly_active_users_room_id_month_key CASCADE;
ALTER TABLE room_monthly_active_users
    ADD CONSTRAINT room_monthly_active_users_room_id_month_key UNIQUE (room_id, month);

ALTER TABLE room_pins DROP CONSTRAINT IF EXISTS room_pins_pkey CASCADE;
ALTER TABLE room_pins
    ADD CONSTRAINT room_pins_pkey PRIMARY KEY (id);

ALTER TABLE room_pins DROP CONSTRAINT IF EXISTS room_pins_user_id_room_id_key CASCADE;
ALTER TABLE room_pins
    ADD CONSTRAINT room_pins_user_id_room_id_key UNIQUE (user_id, room_id);

ALTER TABLE room_promotions DROP CONSTRAINT IF EXISTS room_promotions_pkey CASCADE;
ALTER TABLE room_promotions
    ADD CONSTRAINT room_promotions_pkey PRIMARY KEY (id);

ALTER TABLE room_promotions DROP CONSTRAINT IF EXISTS room_promotions_room_id_key CASCADE;
ALTER TABLE room_promotions
    ADD CONSTRAINT room_promotions_room_id_key UNIQUE (room_id);

ALTER TABLE room_subscriptions DROP CONSTRAINT IF EXISTS room_subscriptions_pkey CASCADE;
ALTER TABLE room_subscriptions
    ADD CONSTRAINT room_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE room_visits DROP CONSTRAINT IF EXISTS room_visits_pkey CASCADE;
ALTER TABLE room_visits
    ADD CONSTRAINT room_visits_pkey PRIMARY KEY (id);

ALTER TABLE room_visits DROP CONSTRAINT IF EXISTS room_visits_user_id_room_id_key CASCADE;
ALTER TABLE room_visits
    ADD CONSTRAINT room_visits_user_id_room_id_key UNIQUE (user_id, room_id);

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_pkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);

ALTER TABLE season_pass_milestones DROP CONSTRAINT IF EXISTS season_pass_milestones_pkey CASCADE;
ALTER TABLE season_pass_milestones
    ADD CONSTRAINT season_pass_milestones_pkey PRIMARY KEY (id);

ALTER TABLE season_rank_archives DROP CONSTRAINT IF EXISTS season_rank_archives_pkey CASCADE;
ALTER TABLE season_rank_archives
    ADD CONSTRAINT season_rank_archives_pkey PRIMARY KEY (id);

ALTER TABLE season_rank_archives DROP CONSTRAINT IF EXISTS season_rank_archives_season_id_user_id_key CASCADE;
ALTER TABLE season_rank_archives
    ADD CONSTRAINT season_rank_archives_season_id_user_id_key UNIQUE (season_id, user_id);

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_pkey CASCADE;
ALTER TABLE seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);

ALTER TABLE slug_redirects DROP CONSTRAINT IF EXISTS slug_redirects_entity_type_old_slug_key CASCADE;
ALTER TABLE slug_redirects
    ADD CONSTRAINT slug_redirects_entity_type_old_slug_key UNIQUE (entity_type, old_slug);

ALTER TABLE slug_redirects DROP CONSTRAINT IF EXISTS slug_redirects_pkey CASCADE;
ALTER TABLE slug_redirects
    ADD CONSTRAINT slug_redirects_pkey PRIMARY KEY (id);

ALTER TABLE sponsored_leaderboard_banners DROP CONSTRAINT IF EXISTS sponsored_leaderboard_banners_pkey CASCADE;
ALTER TABLE sponsored_leaderboard_banners
    ADD CONSTRAINT sponsored_leaderboard_banners_pkey PRIMARY KEY (id);

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_pkey CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_pkey PRIMARY KEY (id);

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_quest_id_creator_id_key CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_quest_id_creator_id_key UNIQUE (quest_id, creator_id);

ALTER TABLE sponsored_quests DROP CONSTRAINT IF EXISTS sponsored_quests_pkey CASCADE;
ALTER TABLE sponsored_quests
    ADD CONSTRAINT sponsored_quests_pkey PRIMARY KEY (id);

ALTER TABLE star_ledger DROP CONSTRAINT IF EXISTS star_ledger_pkey CASCADE;
ALTER TABLE star_ledger
    ADD CONSTRAINT star_ledger_pkey PRIMARY KEY (id);

ALTER TABLE sticker_packs DROP CONSTRAINT IF EXISTS sticker_packs_name_key CASCADE;
ALTER TABLE sticker_packs
    ADD CONSTRAINT sticker_packs_name_key UNIQUE (name);

ALTER TABLE sticker_packs DROP CONSTRAINT IF EXISTS sticker_packs_pkey CASCADE;
ALTER TABLE sticker_packs
    ADD CONSTRAINT sticker_packs_pkey PRIMARY KEY (id);

ALTER TABLE sticker_packs DROP CONSTRAINT IF EXISTS sticker_packs_slug_key CASCADE;
ALTER TABLE sticker_packs
    ADD CONSTRAINT sticker_packs_slug_key UNIQUE (slug);

ALTER TABLE stickers DROP CONSTRAINT IF EXISTS stickers_pack_id_name_key CASCADE;
ALTER TABLE stickers
    ADD CONSTRAINT stickers_pack_id_name_key UNIQUE (pack_id, name);

ALTER TABLE stickers DROP CONSTRAINT IF EXISTS stickers_pkey CASCADE;
ALTER TABLE stickers
    ADD CONSTRAINT stickers_pkey PRIMARY KEY (id);

ALTER TABLE store_items DROP CONSTRAINT IF EXISTS store_items_name_key CASCADE;
ALTER TABLE store_items
    ADD CONSTRAINT store_items_name_key UNIQUE (name);

ALTER TABLE store_items DROP CONSTRAINT IF EXISTS store_items_pkey CASCADE;
ALTER TABLE store_items
    ADD CONSTRAINT store_items_pkey PRIMARY KEY (id);

ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_pkey CASCADE;
ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);

ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_plan_interval_uq CASCADE;
ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_plan_interval_uq UNIQUE (plan, "interval");

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey CASCADE;
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_pkey CASCADE;
ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_pkey PRIMARY KEY (id);

ALTER TABLE telegram_delivery_queue DROP CONSTRAINT IF EXISTS telegram_delivery_queue_pkey CASCADE;
ALTER TABLE telegram_delivery_queue
    ADD CONSTRAINT telegram_delivery_queue_pkey PRIMARY KEY (id);

ALTER TABLE telegram_login_states DROP CONSTRAINT IF EXISTS telegram_login_states_pkey CASCADE;
ALTER TABLE telegram_login_states
    ADD CONSTRAINT telegram_login_states_pkey PRIMARY KEY (state);

ALTER TABLE track_milestone_unlocks DROP CONSTRAINT IF EXISTS track_milestone_unlocks_pkey CASCADE;
ALTER TABLE track_milestone_unlocks
    ADD CONSTRAINT track_milestone_unlocks_pkey PRIMARY KEY (id);

ALTER TABLE track_milestone_unlocks DROP CONSTRAINT IF EXISTS track_milestone_unlocks_user_id_track_milestone_level_key CASCADE;
ALTER TABLE track_milestone_unlocks
    ADD CONSTRAINT track_milestone_unlocks_user_id_track_milestone_level_key UNIQUE (user_id, track, milestone_level);

ALTER TABLE creator_spotlights DROP CONSTRAINT IF EXISTS uq_creator_spotlight_month CASCADE;
ALTER TABLE creator_spotlights
    ADD CONSTRAINT uq_creator_spotlight_month UNIQUE (month_year);

ALTER TABLE payout_dead_letter_queue DROP CONSTRAINT IF EXISTS uq_pdlq_payout_id CASCADE;
ALTER TABLE payout_dead_letter_queue
    ADD CONSTRAINT uq_pdlq_payout_id UNIQUE (payout_id);

ALTER TABLE user_announcement_rotation DROP CONSTRAINT IF EXISTS user_announcement_rotation_pkey CASCADE;
ALTER TABLE user_announcement_rotation
    ADD CONSTRAINT user_announcement_rotation_pkey PRIMARY KEY (user_id, content_type);

ALTER TABLE user_badges DROP CONSTRAINT IF EXISTS user_badges_pkey CASCADE;
ALTER TABLE user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);

ALTER TABLE user_banner_views DROP CONSTRAINT IF EXISTS user_banner_views_pkey CASCADE;
ALTER TABLE user_banner_views
    ADD CONSTRAINT user_banner_views_pkey PRIMARY KEY (id);

ALTER TABLE user_banner_views DROP CONSTRAINT IF EXISTS user_banner_views_user_id_banner_id_key CASCADE;
ALTER TABLE user_banner_views
    ADD CONSTRAINT user_banner_views_user_id_banner_id_key UNIQUE (user_id, banner_id);

ALTER TABLE user_blocks DROP CONSTRAINT IF EXISTS user_blocks_blocker_id_blocked_id_key CASCADE;
ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id);

ALTER TABLE user_blocks DROP CONSTRAINT IF EXISTS user_blocks_pkey CASCADE;
ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);

ALTER TABLE user_cosmetics DROP CONSTRAINT IF EXISTS user_cosmetics_pkey CASCADE;
ALTER TABLE user_cosmetics
    ADD CONSTRAINT user_cosmetics_pkey PRIMARY KEY (id);

ALTER TABLE user_cosmetics DROP CONSTRAINT IF EXISTS user_cosmetics_user_id_store_item_id_key CASCADE;
ALTER TABLE user_cosmetics
    ADD CONSTRAINT user_cosmetics_user_id_store_item_id_key UNIQUE (user_id, store_item_id);

ALTER TABLE user_daily_logins DROP CONSTRAINT IF EXISTS user_daily_logins_pkey CASCADE;
ALTER TABLE user_daily_logins
    ADD CONSTRAINT user_daily_logins_pkey PRIMARY KEY (id);

ALTER TABLE user_email_preferences DROP CONSTRAINT IF EXISTS user_email_preferences_pkey CASCADE;
ALTER TABLE user_email_preferences
    ADD CONSTRAINT user_email_preferences_pkey PRIMARY KEY (id);

ALTER TABLE user_email_preferences DROP CONSTRAINT IF EXISTS user_email_preferences_user_id_notification_type_key CASCADE;
ALTER TABLE user_email_preferences
    ADD CONSTRAINT user_email_preferences_user_id_notification_type_key UNIQUE (user_id, notification_type);

ALTER TABLE user_inactivity_events DROP CONSTRAINT IF EXISTS user_inactivity_events_pkey CASCADE;
ALTER TABLE user_inactivity_events
    ADD CONSTRAINT user_inactivity_events_pkey PRIMARY KEY (id);

ALTER TABLE user_inactivity_events DROP CONSTRAINT IF EXISTS user_inactivity_events_user_id_inactive_days_created_at_key CASCADE;
ALTER TABLE user_inactivity_events
    ADD CONSTRAINT user_inactivity_events_user_id_inactive_days_created_at_key UNIQUE (user_id, inactive_days, created_at);

ALTER TABLE user_messages DROP CONSTRAINT IF EXISTS user_messages_pkey CASCADE;
ALTER TABLE user_messages
    ADD CONSTRAINT user_messages_pkey PRIMARY KEY (id);

ALTER TABLE user_modal_views DROP CONSTRAINT IF EXISTS user_modal_views_pkey CASCADE;
ALTER TABLE user_modal_views
    ADD CONSTRAINT user_modal_views_pkey PRIMARY KEY (id);

ALTER TABLE user_modal_views DROP CONSTRAINT IF EXISTS user_modal_views_user_id_modal_id_key CASCADE;
ALTER TABLE user_modal_views
    ADD CONSTRAINT user_modal_views_user_id_modal_id_key UNIQUE (user_id, modal_id);

ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_pkey CASCADE;
ALTER TABLE user_pins
    ADD CONSTRAINT user_pins_pkey PRIMARY KEY (id);

ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_user_id_key CASCADE;
ALTER TABLE user_pins
    ADD CONSTRAINT user_pins_user_id_key UNIQUE (user_id);

ALTER TABLE user_push_tokens DROP CONSTRAINT IF EXISTS user_push_tokens_pkey CASCADE;
ALTER TABLE user_push_tokens
    ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);

ALTER TABLE user_quest_decks DROP CONSTRAINT IF EXISTS user_quest_decks_pkey CASCADE;
ALTER TABLE user_quest_decks
    ADD CONSTRAINT user_quest_decks_pkey PRIMARY KEY (id);

ALTER TABLE user_quest_decks DROP CONSTRAINT IF EXISTS user_quest_decks_user_id_quest_id_assigned_date_key CASCADE;
ALTER TABLE user_quest_decks
    ADD CONSTRAINT user_quest_decks_user_id_quest_id_assigned_date_key UNIQUE (user_id, quest_id, assigned_date);

ALTER TABLE user_quest_progress DROP CONSTRAINT IF EXISTS user_quest_progress_pkey CASCADE;
ALTER TABLE user_quest_progress
    ADD CONSTRAINT user_quest_progress_pkey PRIMARY KEY (id);

ALTER TABLE user_quest_progress DROP CONSTRAINT IF EXISTS user_quest_progress_user_id_quest_id_quest_date_key CASCADE;
ALTER TABLE user_quest_progress
    ADD CONSTRAINT user_quest_progress_user_id_quest_id_quest_date_key UNIQUE (user_id, quest_id, quest_date);

ALTER TABLE user_reaction_sets DROP CONSTRAINT IF EXISTS user_reaction_sets_pkey CASCADE;
ALTER TABLE user_reaction_sets
    ADD CONSTRAINT user_reaction_sets_pkey PRIMARY KEY (user_id, set_id);

ALTER TABLE user_season_milestone_claims DROP CONSTRAINT IF EXISTS user_season_milestone_claims_pkey CASCADE;
ALTER TABLE user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_pkey PRIMARY KEY (id);

ALTER TABLE user_season_milestone_claims DROP CONSTRAINT IF EXISTS user_season_milestone_claims_user_id_season_id_milestone_id_key CASCADE;
ALTER TABLE user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_user_id_season_id_milestone_id_key UNIQUE (user_id, season_id, milestone_id);

ALTER TABLE user_season_passes DROP CONSTRAINT IF EXISTS user_season_passes_pkey CASCADE;
ALTER TABLE user_season_passes
    ADD CONSTRAINT user_season_passes_pkey PRIMARY KEY (id);

ALTER TABLE user_season_passes DROP CONSTRAINT IF EXISTS user_season_passes_user_id_season_id_key CASCADE;
ALTER TABLE user_season_passes
    ADD CONSTRAINT user_season_passes_user_id_season_id_key UNIQUE (user_id, season_id);

ALTER TABLE user_sticker_packs DROP CONSTRAINT IF EXISTS user_sticker_packs_pkey CASCADE;
ALTER TABLE user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_pkey PRIMARY KEY (id);

ALTER TABLE user_sticker_packs DROP CONSTRAINT IF EXISTS user_sticker_packs_user_id_pack_id_key CASCADE;
ALTER TABLE user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_user_id_pack_id_key UNIQUE (user_id, pack_id);

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_pkey CASCADE;
ALTER TABLE user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_key CASCADE;
ALTER TABLE user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_key UNIQUE (user_id);

ALTER TABLE user_titles DROP CONSTRAINT IF EXISTS user_titles_pkey CASCADE;
ALTER TABLE user_titles
    ADD CONSTRAINT user_titles_pkey PRIMARY KEY (id);

ALTER TABLE user_titles DROP CONSTRAINT IF EXISTS user_titles_user_id_title_key CASCADE;
ALTER TABLE user_titles
    ADD CONSTRAINT user_titles_user_id_title_key UNIQUE (user_id, title);

ALTER TABLE user_xp_boosters DROP CONSTRAINT IF EXISTS user_xp_boosters_pkey CASCADE;
ALTER TABLE user_xp_boosters
    ADD CONSTRAINT user_xp_boosters_pkey PRIMARY KEY (id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_google_id_key CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_referral_code_key CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_telegram_id_key CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_telegram_id_key UNIQUE (telegram_id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_username_key UNIQUE (username);

ALTER TABLE war_contributions DROP CONSTRAINT IF EXISTS war_contributions_pkey CASCADE;
ALTER TABLE war_contributions
    ADD CONSTRAINT war_contributions_pkey PRIMARY KEY (id);

ALTER TABLE war_contributions DROP CONSTRAINT IF EXISTS war_contributions_war_id_user_id_key CASCADE;
ALTER TABLE war_contributions
    ADD CONSTRAINT war_contributions_war_id_user_id_key UNIQUE (war_id, user_id);

ALTER TABLE x_manifest DROP CONSTRAINT IF EXISTS x_manifest_pkey CASCADE;
ALTER TABLE x_manifest
    ADD CONSTRAINT x_manifest_pkey PRIMARY KEY (key);

ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_pkey CASCADE;
ALTER TABLE xp_events
    ADD CONSTRAINT xp_events_pkey PRIMARY KEY (id);

ALTER TABLE xp_ledger DROP CONSTRAINT IF EXISTS xp_ledger_pkey CASCADE;
ALTER TABLE xp_ledger
    ADD CONSTRAINT xp_ledger_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS audit_discrepancies_active_idx ON audit_discrepancies USING btree (user_id, asset_type) WHERE (resolved = false);

CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_reference_id_idx ON creator_earnings USING btree (creator_id, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS forum_categories_slug_unique_idx ON forum_categories USING btree (slug);

CREATE UNIQUE INDEX IF NOT EXISTS forum_questions_slug_unique_idx ON forum_questions USING btree (slug) WHERE ((deleted_at IS NULL) AND (slug IS NOT NULL));

CREATE INDEX IF NOT EXISTS game_best_scores_leaderboard_idx ON game_best_scores USING btree (game_id, best_score DESC);

CREATE INDEX IF NOT EXISTS game_challenge_rounds_challenge_idx ON game_challenge_rounds USING btree (challenge_id, round_no);

CREATE INDEX IF NOT EXISTS game_challenges_challenger_idx ON game_challenges USING btree (challenger_id, status);

CREATE INDEX IF NOT EXISTS game_challenges_expiry_idx ON game_challenges USING btree (status, expires_at);

CREATE INDEX IF NOT EXISTS game_challenges_opponent_idx ON game_challenges USING btree (opponent_id, status);

CREATE INDEX IF NOT EXISTS game_plays_game_idx ON game_plays USING btree (game_id, ended_at);

CREATE UNIQUE INDEX IF NOT EXISTS game_plays_nonce_idx ON game_plays USING btree (session_nonce);

CREATE INDEX IF NOT EXISTS game_plays_user_idx ON game_plays USING btree (user_id, ended_at);

CREATE INDEX IF NOT EXISTS game_ratings_game_idx ON game_ratings USING btree (game_id);

CREATE INDEX IF NOT EXISTS games_category_active_idx ON games USING btree (category, sort_order) WHERE ((deleted_at IS NULL) AND (is_active = true));

CREATE UNIQUE INDEX IF NOT EXISTS games_slug_unique_idx ON games USING btree (slug);

CREATE INDEX IF NOT EXISTS gifts_gift_type_id_idx ON gifts USING btree (gift_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS guild_treasury_ledger_idem_idx ON guild_treasury_ledger USING btree (guild_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions USING btree (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log USING btree (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_msg_receipts_user ON admin_message_receipts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_alliance_wars_active ON alliance_wars USING btree (status) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alliance_wars_active_pair ON alliance_wars USING btree (LEAST((alliance_1_id)::text, (alliance_2_id)::text), GREATEST((alliance_1_id)::text, (alliance_2_id)::text)) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_audit_discrepancies_unresolved ON audit_discrepancies USING btree (detected_at) WHERE (resolved = false);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log USING btree (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log USING btree (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log USING btree (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automated_actions_log_created ON automated_actions_log USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automated_actions_log_target_user ON automated_actions_log USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_business_accounts_verification_status ON business_accounts USING btree (verification_status) WHERE (verification_status = ANY (ARRAY['pending'::text, 'rejected'::text]));

CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_room ON classroom_enrolments USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_user ON classroom_enrolments USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_archive_user ON coin_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_created_at ON coin_ledger USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_id ON coin_ledger USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_type_created ON coin_ledger USING btree (user_id, transaction_type, created_at);

CREATE INDEX IF NOT EXISTS idx_community_notes_target ON community_notes USING btree (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_conversation_scores_score ON conversation_scores USING btree (score DESC) WHERE (score > 0);

CREATE INDEX IF NOT EXISTS idx_conversation_scores_u1 ON conversation_scores USING btree (user_id_1);

CREATE INDEX IF NOT EXISTS idx_conversation_scores_u2 ON conversation_scores USING btree (user_id_2);

CREATE INDEX IF NOT EXISTS idx_council_invitations_date ON council_invitations USING btree (invited_at DESC);

CREATE INDEX IF NOT EXISTS idx_council_invitations_user ON council_invitations USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_creator_bank_accounts_creator ON creator_bank_accounts USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_created ON creator_broadcasts USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_creator ON creator_broadcasts USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_recipient ON creator_broadcasts USING btree (recipient_id, created_at DESC) WHERE (recipient_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator ON creator_earnings USING btree (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator ON creator_payouts USING btree (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_pending_bank ON creator_payouts USING btree (created_at) WHERE ((status = 'pending'::text) AND (payout_method = 'bank_transfer'::text));

CREATE INDEX IF NOT EXISTS idx_creator_payouts_provider_ref ON creator_payouts USING btree (provider_reference);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_retry ON creator_payouts USING btree (next_retry_at) WHERE ((status = 'failed'::text) AND (next_retry_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_creator_payouts_status ON creator_payouts USING btree (status) WHERE (status <> ALL (ARRAY['completed'::text, 'failed'::text]));

CREATE INDEX IF NOT EXISTS idx_creator_spotlights_creator ON creator_spotlights USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_spotlights_is_active ON creator_spotlights USING btree (is_active) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_creator_spotlights_month ON creator_spotlights USING btree (month_year DESC);

CREATE INDEX IF NOT EXISTS idx_creator_wallet_addresses_creator ON creator_wallet_addresses USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_data_export_requests_status ON data_export_requests USING btree (status) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS idx_data_export_requests_user ON data_export_requests USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations USING btree (user_id_1);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations USING btree (user_id_2);

CREATE INDEX IF NOT EXISTS idx_dm_score_milestones ON dm_conversation_score_milestones USING btree (user_id_a, user_id_b);

CREATE INDEX IF NOT EXISTS idx_dm_sticker_unlocks_pair ON dm_score_sticker_unlocks USING btree (user_id_1, user_id_2);

CREATE INDEX IF NOT EXISTS idx_elder_mentorships_elder ON elder_mentorships USING btree (elder_id);

CREATE INDEX IF NOT EXISTS idx_elder_mentorships_mentee ON elder_mentorships USING btree (mentee_id);

CREATE INDEX IF NOT EXISTS idx_failed_webhooks_retry ON failed_webhooks USING btree (next_retry_at) WHERE ((resolved = false) AND (retry_count < 3));

CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_pending ON failed_xp_awards USING btree (retry_count, last_retried_at) WHERE (resolved_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_retry ON failed_xp_awards USING btree (resolved_at, retry_count, last_retried_at) WHERE (resolved_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_feature_flags_early_access_plans ON feature_flags USING gin (early_access_plans);

CREATE INDEX IF NOT EXISTS idx_flash_xp_events_announce ON flash_xp_events USING btree (announced_at, announcement_notification_sent, is_active);

CREATE INDEX IF NOT EXISTS idx_flash_xp_events_fires ON flash_xp_events USING btree (fires_at, fired, is_active);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows USING btree (follower_id);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows USING btree (following_id);

CREATE INDEX IF NOT EXISTS idx_forum_answers_author ON forum_answers USING btree (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_answers_question ON forum_answers USING btree (question_id, parent_answer_id, vote_score DESC);

CREATE INDEX IF NOT EXISTS idx_forum_favorites_user ON forum_favorites USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_moderation_log_q ON forum_moderation_log USING btree (question_id);

CREATE INDEX IF NOT EXISTS idx_forum_questions_author ON forum_questions USING btree (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_questions_category ON forum_questions USING btree (category_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_questions_new ON forum_questions USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_questions_popular ON forum_questions USING btree (status, vote_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_questions_trending ON forum_questions USING btree (status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_votes_target ON forum_votes USING btree (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships USING btree (addressee_id);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships USING btree (requester_id);

CREATE INDEX IF NOT EXISTS idx_game_challenges_archived ON game_challenges USING btree (archived_at) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_game_favorites_game ON game_favorites USING btree (game_id);

CREATE INDEX IF NOT EXISTS idx_game_favorites_user_created ON game_favorites USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_saves_user_updated ON game_saves USING btree (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_applications_guild ON guild_applications USING btree (guild_id, status);

CREATE INDEX IF NOT EXISTS idx_guild_applications_user ON guild_applications USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_guild_contribution_alerts_guild ON guild_contribution_alerts USING btree (guild_id);

CREATE INDEX IF NOT EXISTS idx_guild_invites_guild ON guild_invites USING btree (guild_id);

CREATE INDEX IF NOT EXISTS idx_guild_invites_token ON guild_invites USING btree (token);

CREATE INDEX IF NOT EXISTS idx_guild_members_active ON guild_members USING btree (guild_id) WHERE (left_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members USING btree (guild_id);

CREATE INDEX IF NOT EXISTS idx_guild_members_guild_contribution ON guild_members USING btree (guild_id, contribution_score);

CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_guild_messages_guild ON guild_messages USING btree (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_messages_sender ON guild_messages USING btree (sender_id);

CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_quest ON guild_quest_contributions USING btree (quest_id);

CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_user ON guild_quest_contributions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_guild_quests_active ON guild_quests USING btree (guild_id, is_active) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_guild_quests_guild_week ON guild_quests USING btree (guild_id, week_start);

CREATE INDEX IF NOT EXISTS idx_guild_rooms_room ON guild_rooms USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_guild ON guild_treasury_ledger USING btree (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_ref ON guild_treasury_ledger USING btree (reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_wars_defender_active ON guild_wars USING btree (defender_guild_id) WHERE (status = ANY (ARRAY['active'::text, 'final_hour'::text]));

CREATE INDEX IF NOT EXISTS idx_guilds_city ON guilds USING btree (city);

CREATE INDEX IF NOT EXISTS idx_guilds_tier ON guilds USING btree (tier);

CREATE INDEX IF NOT EXISTS idx_hall_of_fame_legacy ON hall_of_fame USING btree (legacy_score DESC);

CREATE INDEX IF NOT EXISTS idx_hall_of_fame_user ON hall_of_fame USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_lb_rank_snapshots_scope ON leaderboard_rank_snapshots USING btree (scope, user_id);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_city ON leaderboard_snapshots USING btree (city, track, xp_value DESC) WHERE (city IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope ON leaderboard_snapshots USING btree (scope, track, xp_value DESC);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope_track_city ON leaderboard_snapshots USING btree (scope, track, city, xp_value DESC);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_user ON leaderboard_snapshots USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank_snapshots_user_scope ON leaderboard_rank_snapshots USING btree (user_id, scope);

CREATE INDEX IF NOT EXISTS idx_learning_certs_recipient ON learning_certificates USING btree (recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_learning_certs_room_id ON learning_certificates USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_merch_orders_buyer_status ON merch_orders USING btree (buyer_id, status);

CREATE INDEX IF NOT EXISTS idx_merch_orders_creator_status ON merch_orders USING btree (creator_id, status);

CREATE INDEX IF NOT EXISTS idx_merch_orders_store ON merch_orders USING btree (store_id) WHERE (store_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_group_chat ON messages USING btree (group_chat_id, created_at DESC) WHERE (group_chat_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_dm ON messages USING btree (recipient_id) WHERE (recipient_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_messages_sender_dm ON messages USING btree (sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender_plan_created ON messages USING btree (sender_plan_at_creation, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages USING btree (conversation_id, recipient_id, is_read, is_deleted) WHERE ((is_read = false) AND (is_deleted = false));

CREATE INDEX IF NOT EXISTS idx_mod_ai_escalations_report ON moderation_ai_escalations USING btree (report_id);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_actor_type ON moderation_actions USING btree (actor_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions USING btree (target_user_id);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_forum_answer ON moderation_reports USING btree (reported_forum_answer_id) WHERE (reported_forum_answer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_forum_question ON moderation_reports USING btree (reported_forum_question_id) WHERE (reported_forum_question_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_pipeline ON moderation_reports USING btree (pipeline_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported ON moderation_reports USING btree (reported_user_id) WHERE (reported_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter ON moderation_reports USING btree (reporter_id);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON moderation_reports USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moments_active_feed ON moments USING btree (expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moments_expires_at ON moments USING btree (expires_at) WHERE (expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_moments_user ON moments USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_monthly_gift_drops_active ON monthly_gift_drops USING btree (available_from, available_until) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_last_notified ON nemesis_assignments USING btree (last_notified_at) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_nemesis_user_id ON nemesis_assignments USING btree (nemesis_user_id);

CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_user_id ON nemesis_assignments USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenged ON nemesis_challenges USING btree (challenged_id, status);

CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenger ON nemesis_challenges USING btree (challenger_id, status);

CREATE INDEX IF NOT EXISTS idx_nemesis_user_id ON nemesis_assignments USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications USING btree (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens USING btree (token_hash);

CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments USING btree (provider_reference);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments USING btree (status);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_payout_dlq_unresolved ON payout_dead_letter_queue USING btree (created_at DESC) WHERE (resolved_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_platform_events_recurring ON platform_events USING btree (is_recurring_annual, event_type) WHERE (is_recurring_annual = true);

CREATE INDEX IF NOT EXISTS idx_push_tickets_pending ON push_tickets USING btree (created_at) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS idx_rank_up_events_user ON rank_up_events USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reaction_set_items_set_id ON reaction_set_items USING btree (set_id);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions USING btree (referrer_id);

CREATE INDEX IF NOT EXISTS idx_referrals_qualified ON referrals USING btree (referrer_id) WHERE (qualified = false);

CREATE INDEX IF NOT EXISTS idx_referrals_qualified_tier ON referrals USING btree (qualified, tier) WHERE (qualified = false);

CREATE INDEX IF NOT EXISTS idx_refunds_user ON refunds USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rematch_tokens_guild ON guild_war_rematch_tokens USING btree (guild_id) WHERE (NOT is_used);

CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports USING btree (reporter_id);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports USING btree (status);

CREATE INDEX IF NOT EXISTS idx_room_mau_room_id ON room_monthly_active_users USING btree (room_id, month DESC);

CREATE INDEX IF NOT EXISTS idx_room_member_highlights_room ON room_member_highlights USING btree (room_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_room_messages_created_at ON room_messages USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_room_messages_pin_expiry ON room_messages USING btree (pin_expires_at) WHERE ((is_pinned = true) AND (pin_expires_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_room_messages_pinned ON room_messages USING btree (room_id) WHERE (is_pinned = true);

CREATE INDEX IF NOT EXISTS idx_room_messages_room ON room_messages USING btree (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_messages_sender ON room_messages USING btree (sender_id);

CREATE INDEX IF NOT EXISTS idx_room_mod_log_room ON room_moderation_log USING btree (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_mod_log_target ON room_moderation_log USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_msg ON room_message_reactions USING btree (message_id);

CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_user ON room_message_reactions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_room_pins_room ON room_pins USING btree (room_id);

CREATE INDEX IF NOT EXISTS idx_room_pins_user ON room_pins USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_room_promotions_active ON room_promotions USING btree (room_id, is_active, ends_at);

CREATE INDEX IF NOT EXISTS idx_room_subscriptions_expiry ON room_subscriptions USING btree (expires_at) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS idx_room_subscriptions_room ON room_subscriptions USING btree (room_id, status);

CREATE INDEX IF NOT EXISTS idx_room_subscriptions_user ON room_subscriptions USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_room_visits_user_last_visited ON room_visits USING btree (user_id, last_visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_rooms_banned ON rooms USING btree (is_banned) WHERE (is_banned = true);

CREATE INDEX IF NOT EXISTS idx_rooms_city ON rooms USING btree (city);

CREATE INDEX IF NOT EXISTS idx_rooms_creator_id ON rooms USING btree (creator_id);

CREATE INDEX IF NOT EXISTS idx_rooms_flagged ON rooms USING btree (flagged_at) WHERE (flagged_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_rooms_guild_id ON rooms USING btree (guild_id) WHERE (guild_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms USING btree (is_active) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_rooms_spotlight ON rooms USING btree (spotlight_until) WHERE (spotlight_until IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_rooms_suspended ON rooms USING btree (is_suspended) WHERE (is_suspended = true);

CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms USING btree (type);

CREATE INDEX IF NOT EXISTS idx_season_milestone_claims ON user_season_milestone_claims USING btree (user_id, season_id);

CREATE INDEX IF NOT EXISTS idx_season_pass_milestones_season ON season_pass_milestones USING btree (season_id, milestone_xp);

CREATE INDEX IF NOT EXISTS idx_season_rank_archives_season ON season_rank_archives USING btree (season_id);

CREATE INDEX IF NOT EXISTS idx_season_rank_archives_user ON season_rank_archives USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_sponsored_banners_active ON sponsored_leaderboard_banners USING btree (is_active, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_star_ledger_archive_user ON star_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_star_ledger_created_at ON star_ledger USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_star_ledger_user ON star_ledger USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_items_type_active ON store_items USING btree (item_type, is_active);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans USING btree (is_active, plan, "interval");

CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved ON system_alerts USING btree (severity, created_at DESC) WHERE (resolved = false);

CREATE INDEX IF NOT EXISTS idx_telegram_delivery_queue_undelivered ON telegram_delivery_queue USING btree (created_at) WHERE ((delivered_at IS NULL) AND (failed_attempts < 3));

CREATE INDEX IF NOT EXISTS idx_telegram_login_states_created ON telegram_login_states USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_track_milestone_unlocks_user ON track_milestone_unlocks USING btree (user_id, track);

CREATE INDEX IF NOT EXISTS idx_user_ann_rotation_user ON user_announcement_rotation USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_key ON user_badges USING btree (user_id, badge_key) WHERE (badge_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_user_banner_views_user ON user_banner_views USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks USING btree (blocked_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks USING btree (blocker_id);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_active ON user_cosmetics USING btree (user_id, is_active) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON user_cosmetics USING btree (user_id, cosmetic_type);

CREATE INDEX IF NOT EXISTS idx_user_email_prefs_user ON user_email_preferences USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_inactivity_events_notified ON user_inactivity_events USING btree (push_email_notified, created_at) WHERE (push_email_notified = false);

CREATE INDEX IF NOT EXISTS idx_user_inactivity_events_telegram ON user_inactivity_events USING btree (telegram_notified, created_at) WHERE (telegram_notified = false);

CREATE INDEX IF NOT EXISTS idx_user_inactivity_notified ON user_inactivity_events USING btree (notified, created_at) WHERE (notified = false);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient ON user_messages USING btree (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_messages_unread ON user_messages USING btree (recipient_id) WHERE (is_read = false);

CREATE INDEX IF NOT EXISTS idx_user_pins_user ON user_pins USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON user_push_tokens USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_quest_decks_user_date ON user_quest_decks USING btree (user_id, assigned_date);

CREATE INDEX IF NOT EXISTS idx_user_quest_progress_user_date ON user_quest_progress USING btree (user_id, quest_date);

CREATE INDEX IF NOT EXISTS idx_user_reaction_sets_user_id ON user_reaction_sets USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sticker_packs_user_pack ON user_sticker_packs USING btree (user_id, pack_id);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_user_xp_boosters_user_active ON user_xp_boosters USING btree (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_users_city ON users USING btree (city) WHERE (city IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_email ON users USING btree (email) WHERE (email IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users USING btree (google_id) WHERE (google_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users USING btree (last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_last_login_date ON users USING btree (last_login_date) WHERE (last_login_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_plan ON users USING btree (plan);

CREATE INDEX IF NOT EXISTS idx_users_plan_deleted ON users USING btree (plan, deleted_at) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_users_prestige_boost ON users USING btree (prestige_cycle_boost_expires_at) WHERE (prestige_cycle_boost_expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users USING btree (referral_code) WHERE (referral_code IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users USING btree (referred_by) WHERE (referred_by IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users USING btree (telegram_id) WHERE (telegram_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_users_username ON users USING btree (username);

CREATE INDEX IF NOT EXISTS idx_users_xp_total ON users USING btree (xp_total DESC);

CREATE INDEX IF NOT EXISTS idx_war_contributions_user ON war_contributions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_war_contributions_war ON war_contributions USING btree (war_id);

CREATE INDEX IF NOT EXISTS idx_xp_events_action ON xp_events USING btree (action);

CREATE INDEX IF NOT EXISTS idx_xp_events_archive_user ON xp_events_archive USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_events_created_at ON xp_events USING btree (created_at);

CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_archive_user ON xp_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_created_at ON xp_ledger USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_deck_completion ON xp_ledger USING btree (user_id, reference_id) WHERE ((source = 'deck_completion'::text) AND (reference_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_xp_ledger_track ON xp_ledger USING btree (track);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_id ON xp_ledger USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_source_date ON xp_ledger USING btree (user_id, source, (((created_at AT TIME ZONE 'UTC'::text))::date));

CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_track_created ON xp_ledger USING btree (user_id, track, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_snapshots_upsert_idx ON leaderboard_snapshots USING btree (user_id, track, scope, COALESCE(city, ''::text), COALESCE((season_id)::text, ''::text));

CREATE UNIQUE INDEX IF NOT EXISTS learning_certificates_room_recipient_idx ON learning_certificates USING btree (room_id, recipient_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique ON messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS messages_retain_until_idx ON messages USING btree (retain_until) WHERE (retain_until IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_idempotency_key_uq ON messages USING btree (sender_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS nemesis_assignments_active_idx ON nemesis_assignments USING btree (user_id, track) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS new_member_quests_user_id_idx ON new_member_quests USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_type_null_ref_unique ON notifications USING btree (user_id, type) WHERE (reference_id IS NULL);

CREATE INDEX IF NOT EXISTS push_tickets_unresolved_idx ON push_tickets USING btree (created_at) WHERE (resolved_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS room_subscriptions_room_user_idx ON room_subscriptions USING btree (room_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_ceremony_season_idx ON rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_season_ceremony_id_idx ON rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_season_ceremony_id_unique ON rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_slug_unique_idx ON rooms USING btree (slug) WHERE ((deleted_at IS NULL) AND (slug IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS season_pass_milestones_season_tier_sort_idx ON season_pass_milestones USING btree (season_id, tier, sort_order);

CREATE INDEX IF NOT EXISTS slug_redirects_entity_idx ON slug_redirects USING btree (entity_type, entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS store_items_iap_product_id_unique ON store_items USING btree (iap_product_id) WHERE (iap_product_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_uq ON subscriptions USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_alliance_wars_active_pair ON alliance_wars USING btree (alliance_1_id, alliance_2_id) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_tx_type_ref ON coin_ledger USING btree (user_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_creator_bank_accounts_primary ON creator_bank_accounts USING btree (creator_id) WHERE ((is_primary = true) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uidx_failed_commissions_payment_id ON failed_commissions USING btree (payment_id) WHERE (payment_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_guild_tier_history_guild_war ON guild_tier_history USING btree (guild_id, war_id) WHERE (war_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_messages_sender_idempotency ON messages USING btree (sender_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_notifications_user_type_ref ON notifications USING btree (user_id, type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_star_ledger_tx_type_ref ON star_ledger USING btree (user_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_daily_logins_user_date ON user_daily_logins USING btree (user_id, login_date);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_xp_ledger_source_ref ON xp_ledger USING btree (user_id, source, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_failed_xp_reference_partial ON failed_xp_awards USING btree (user_id, source, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS user_push_tokens_user_token_idx ON user_push_tokens USING btree (user_id, token);

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_admin_id_fkey CASCADE;
ALTER TABLE admin_actions
    ADD CONSTRAINT admin_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_target_user_id_fkey CASCADE;
ALTER TABLE admin_actions
    ADD CONSTRAINT admin_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_admin_id_fkey CASCADE;
ALTER TABLE admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE admin_message_receipts DROP CONSTRAINT IF EXISTS admin_message_receipts_admin_message_id_fkey CASCADE;
ALTER TABLE admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_admin_message_id_fkey FOREIGN KEY (admin_message_id) REFERENCES admin_messages(id) ON DELETE CASCADE;

ALTER TABLE admin_message_receipts DROP CONSTRAINT IF EXISTS admin_message_receipts_user_id_fkey CASCADE;
ALTER TABLE admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE admin_messages DROP CONSTRAINT IF EXISTS admin_messages_sender_admin_id_fkey CASCADE;
ALTER TABLE admin_messages
    ADD CONSTRAINT admin_messages_sender_admin_id_fkey FOREIGN KEY (sender_admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE admin_roles DROP CONSTRAINT IF EXISTS admin_roles_user_id_fkey CASCADE;
ALTER TABLE admin_roles
    ADD CONSTRAINT admin_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE alliance_wars DROP CONSTRAINT IF EXISTS alliance_wars_alliance_1_id_fkey CASCADE;
ALTER TABLE alliance_wars
    ADD CONSTRAINT alliance_wars_alliance_1_id_fkey FOREIGN KEY (alliance_1_id) REFERENCES guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE alliance_wars DROP CONSTRAINT IF EXISTS alliance_wars_alliance_2_id_fkey CASCADE;
ALTER TABLE alliance_wars
    ADD CONSTRAINT alliance_wars_alliance_2_id_fkey FOREIGN KEY (alliance_2_id) REFERENCES guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE alliance_wars DROP CONSTRAINT IF EXISTS alliance_wars_winner_alliance_id_fkey CASCADE;
ALTER TABLE alliance_wars
    ADD CONSTRAINT alliance_wars_winner_alliance_id_fkey FOREIGN KEY (winner_alliance_id) REFERENCES guild_alliances(id) ON DELETE SET NULL;

ALTER TABLE automated_actions_log DROP CONSTRAINT IF EXISTS automated_actions_log_reversed_by_fkey CASCADE;
ALTER TABLE automated_actions_log
    ADD CONSTRAINT automated_actions_log_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE automated_actions_log DROP CONSTRAINT IF EXISTS automated_actions_log_target_user_id_fkey CASCADE;
ALTER TABLE automated_actions_log
    ADD CONSTRAINT automated_actions_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE automated_actions_log DROP CONSTRAINT IF EXISTS automated_actions_log_user_id_fkey CASCADE;
ALTER TABLE automated_actions_log
    ADD CONSTRAINT automated_actions_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE branded_rooms DROP CONSTRAINT IF EXISTS branded_rooms_created_by_fkey CASCADE;
ALTER TABLE branded_rooms
    ADD CONSTRAINT branded_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE branded_rooms DROP CONSTRAINT IF EXISTS branded_rooms_room_id_fkey CASCADE;
ALTER TABLE branded_rooms
    ADD CONSTRAINT branded_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE business_accounts DROP CONSTRAINT IF EXISTS business_accounts_subscription_id_fkey CASCADE;
ALTER TABLE business_accounts
    ADD CONSTRAINT business_accounts_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;

ALTER TABLE business_accounts DROP CONSTRAINT IF EXISTS business_accounts_user_id_fkey CASCADE;
ALTER TABLE business_accounts
    ADD CONSTRAINT business_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE classroom_enrolments DROP CONSTRAINT IF EXISTS classroom_enrolments_room_id_fkey CASCADE;
ALTER TABLE classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE classroom_enrolments DROP CONSTRAINT IF EXISTS classroom_enrolments_user_id_fkey CASCADE;
ALTER TABLE classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE classroom_quiz_attempts DROP CONSTRAINT IF EXISTS classroom_quiz_attempts_quiz_id_fkey CASCADE;
ALTER TABLE classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id) ON DELETE CASCADE;

ALTER TABLE classroom_quiz_attempts DROP CONSTRAINT IF EXISTS classroom_quiz_attempts_user_id_fkey CASCADE;
ALTER TABLE classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE classroom_quiz_questions DROP CONSTRAINT IF EXISTS classroom_quiz_questions_quiz_id_fkey CASCADE;
ALTER TABLE classroom_quiz_questions
    ADD CONSTRAINT classroom_quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id) ON DELETE CASCADE;

ALTER TABLE classroom_quizzes DROP CONSTRAINT IF EXISTS classroom_quizzes_creator_id_fkey CASCADE;
ALTER TABLE classroom_quizzes
    ADD CONSTRAINT classroom_quizzes_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE classroom_quizzes DROP CONSTRAINT IF EXISTS classroom_quizzes_room_id_fkey CASCADE;
ALTER TABLE classroom_quizzes
    ADD CONSTRAINT classroom_quizzes_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_user_id_fkey CASCADE;
ALTER TABLE coin_ledger
    ADD CONSTRAINT coin_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE community_note_votes DROP CONSTRAINT IF EXISTS community_note_votes_note_id_fkey CASCADE;
ALTER TABLE community_note_votes
    ADD CONSTRAINT community_note_votes_note_id_fkey FOREIGN KEY (note_id) REFERENCES community_notes(id) ON DELETE CASCADE;

ALTER TABLE community_note_votes DROP CONSTRAINT IF EXISTS community_note_votes_user_id_fkey CASCADE;
ALTER TABLE community_note_votes
    ADD CONSTRAINT community_note_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE community_notes DROP CONSTRAINT IF EXISTS community_notes_author_id_fkey CASCADE;
ALTER TABLE community_notes
    ADD CONSTRAINT community_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE community_notes DROP CONSTRAINT IF EXISTS community_notes_reviewed_by_fkey CASCADE;
ALTER TABLE community_notes
    ADD CONSTRAINT community_notes_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversation_scores DROP CONSTRAINT IF EXISTS conversation_scores_user_id_1_fkey CASCADE;
ALTER TABLE conversation_scores
    ADD CONSTRAINT conversation_scores_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE conversation_scores DROP CONSTRAINT IF EXISTS conversation_scores_user_id_2_fkey CASCADE;
ALTER TABLE conversation_scores
    ADD CONSTRAINT conversation_scores_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE council_invitations DROP CONSTRAINT IF EXISTS council_invitations_user_id_fkey CASCADE;
ALTER TABLE council_invitations
    ADD CONSTRAINT council_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_bank_accounts DROP CONSTRAINT IF EXISTS creator_bank_accounts_creator_id_fkey CASCADE;
ALTER TABLE creator_bank_accounts
    ADD CONSTRAINT creator_bank_accounts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_broadcasts DROP CONSTRAINT IF EXISTS creator_broadcasts_creator_id_fkey CASCADE;
ALTER TABLE creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_broadcasts DROP CONSTRAINT IF EXISTS creator_broadcasts_recipient_id_fkey CASCADE;
ALTER TABLE creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_broadcasts DROP CONSTRAINT IF EXISTS creator_broadcasts_sender_id_fkey CASCADE;
ALTER TABLE creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_creator_id_fkey CASCADE;
ALTER TABLE creator_earnings
    ADD CONSTRAINT creator_earnings_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_payout_id_fkey CASCADE;
ALTER TABLE creator_earnings
    ADD CONSTRAINT creator_earnings_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES creator_payouts(id) ON DELETE SET NULL;

ALTER TABLE creator_kyc DROP CONSTRAINT IF EXISTS creator_kyc_creator_id_fkey CASCADE;
ALTER TABLE creator_kyc
    ADD CONSTRAINT creator_kyc_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_payouts DROP CONSTRAINT IF EXISTS creator_payouts_appeal_resolved_by_fkey CASCADE;
ALTER TABLE creator_payouts
    ADD CONSTRAINT creator_payouts_appeal_resolved_by_fkey FOREIGN KEY (appeal_resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE creator_payouts DROP CONSTRAINT IF EXISTS creator_payouts_approved_by_admin_id_fkey CASCADE;
ALTER TABLE creator_payouts
    ADD CONSTRAINT creator_payouts_approved_by_admin_id_fkey FOREIGN KEY (approved_by_admin_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE creator_payouts DROP CONSTRAINT IF EXISTS creator_payouts_creator_id_fkey CASCADE;
ALTER TABLE creator_payouts
    ADD CONSTRAINT creator_payouts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_spotlights DROP CONSTRAINT IF EXISTS creator_spotlights_created_by_fkey CASCADE;
ALTER TABLE creator_spotlights
    ADD CONSTRAINT creator_spotlights_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE creator_spotlights DROP CONSTRAINT IF EXISTS creator_spotlights_creator_id_fkey CASCADE;
ALTER TABLE creator_spotlights
    ADD CONSTRAINT creator_spotlights_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE creator_wallet_addresses DROP CONSTRAINT IF EXISTS creator_wallet_addresses_creator_id_fkey CASCADE;
ALTER TABLE creator_wallet_addresses
    ADD CONSTRAINT creator_wallet_addresses_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_user_id_fkey CASCADE;
ALTER TABLE data_export_requests
    ADD CONSTRAINT data_export_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversation_score_milestones DROP CONSTRAINT IF EXISTS dm_conversation_score_milestones_user_id_a_fkey CASCADE;
ALTER TABLE dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milestones_user_id_a_fkey FOREIGN KEY (user_id_a) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversation_score_milestones DROP CONSTRAINT IF EXISTS dm_conversation_score_milestones_user_id_b_fkey CASCADE;
ALTER TABLE dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milestones_user_id_b_fkey FOREIGN KEY (user_id_b) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversation_unlocks DROP CONSTRAINT IF EXISTS dm_conversation_unlocks_initiator_id_fkey CASCADE;
ALTER TABLE dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversation_unlocks DROP CONSTRAINT IF EXISTS dm_conversation_unlocks_recipient_id_fkey CASCADE;
ALTER TABLE dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversations DROP CONSTRAINT IF EXISTS dm_conversations_user_id_1_fkey CASCADE;
ALTER TABLE dm_conversations
    ADD CONSTRAINT dm_conversations_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_conversations DROP CONSTRAINT IF EXISTS dm_conversations_user_id_2_fkey CASCADE;
ALTER TABLE dm_conversations
    ADD CONSTRAINT dm_conversations_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_score_sticker_unlocks DROP CONSTRAINT IF EXISTS dm_score_sticker_unlocks_user_id_1_fkey CASCADE;
ALTER TABLE dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE dm_score_sticker_unlocks DROP CONSTRAINT IF EXISTS dm_score_sticker_unlocks_user_id_2_fkey CASCADE;
ALTER TABLE dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE drop_room_replays DROP CONSTRAINT IF EXISTS drop_room_replays_creator_id_fkey CASCADE;
ALTER TABLE drop_room_replays
    ADD CONSTRAINT drop_room_replays_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE drop_room_replays DROP CONSTRAINT IF EXISTS drop_room_replays_room_id_fkey CASCADE;
ALTER TABLE drop_room_replays
    ADD CONSTRAINT drop_room_replays_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE elder_mentorships DROP CONSTRAINT IF EXISTS elder_mentorships_elder_id_fkey CASCADE;
ALTER TABLE elder_mentorships
    ADD CONSTRAINT elder_mentorships_elder_id_fkey FOREIGN KEY (elder_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE elder_mentorships DROP CONSTRAINT IF EXISTS elder_mentorships_mentee_id_fkey CASCADE;
ALTER TABLE elder_mentorships
    ADD CONSTRAINT elder_mentorships_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE elder_requests DROP CONSTRAINT IF EXISTS elder_requests_elder_id_fkey CASCADE;
ALTER TABLE elder_requests
    ADD CONSTRAINT elder_requests_elder_id_fkey FOREIGN KEY (elder_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE elder_requests DROP CONSTRAINT IF EXISTS elder_requests_mentee_id_fkey CASCADE;
ALTER TABLE elder_requests
    ADD CONSTRAINT elder_requests_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follower_id_fkey CASCADE;
ALTER TABLE follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_following_id_fkey CASCADE;
ALTER TABLE follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forum_answers DROP CONSTRAINT IF EXISTS forum_answers_author_id_fkey CASCADE;
ALTER TABLE forum_answers
    ADD CONSTRAINT forum_answers_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forum_answers DROP CONSTRAINT IF EXISTS forum_answers_parent_answer_id_fkey CASCADE;
ALTER TABLE forum_answers
    ADD CONSTRAINT forum_answers_parent_answer_id_fkey FOREIGN KEY (parent_answer_id) REFERENCES forum_answers(id) ON DELETE CASCADE;

ALTER TABLE forum_answers DROP CONSTRAINT IF EXISTS forum_answers_question_id_fkey CASCADE;
ALTER TABLE forum_answers
    ADD CONSTRAINT forum_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES forum_questions(id) ON DELETE CASCADE;

ALTER TABLE forum_favorites DROP CONSTRAINT IF EXISTS forum_favorites_question_id_fkey CASCADE;
ALTER TABLE forum_favorites
    ADD CONSTRAINT forum_favorites_question_id_fkey FOREIGN KEY (question_id) REFERENCES forum_questions(id) ON DELETE CASCADE;

ALTER TABLE forum_favorites DROP CONSTRAINT IF EXISTS forum_favorites_user_id_fkey CASCADE;
ALTER TABLE forum_favorites
    ADD CONSTRAINT forum_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forum_moderation_log DROP CONSTRAINT IF EXISTS forum_moderation_log_answer_id_fkey CASCADE;
ALTER TABLE forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_answer_id_fkey FOREIGN KEY (answer_id) REFERENCES forum_answers(id) ON DELETE CASCADE;

ALTER TABLE forum_moderation_log DROP CONSTRAINT IF EXISTS forum_moderation_log_moderator_id_fkey CASCADE;
ALTER TABLE forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forum_moderation_log DROP CONSTRAINT IF EXISTS forum_moderation_log_question_id_fkey CASCADE;
ALTER TABLE forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_question_id_fkey FOREIGN KEY (question_id) REFERENCES forum_questions(id) ON DELETE CASCADE;

ALTER TABLE forum_moderation_log DROP CONSTRAINT IF EXISTS forum_moderation_log_target_user_id_fkey CASCADE;
ALTER TABLE forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE forum_questions DROP CONSTRAINT IF EXISTS forum_questions_author_id_fkey CASCADE;
ALTER TABLE forum_questions
    ADD CONSTRAINT forum_questions_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE forum_questions DROP CONSTRAINT IF EXISTS forum_questions_best_answer_fk CASCADE;
ALTER TABLE forum_questions
    ADD CONSTRAINT forum_questions_best_answer_fk FOREIGN KEY (best_answer_id) REFERENCES forum_answers(id) ON DELETE SET NULL;

ALTER TABLE forum_questions DROP CONSTRAINT IF EXISTS forum_questions_category_id_fkey CASCADE;
ALTER TABLE forum_questions
    ADD CONSTRAINT forum_questions_category_id_fkey FOREIGN KEY (category_id) REFERENCES forum_categories(id) ON DELETE SET NULL;

ALTER TABLE forum_votes DROP CONSTRAINT IF EXISTS forum_votes_user_id_fkey CASCADE;
ALTER TABLE forum_votes
    ADD CONSTRAINT forum_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_addressee_id_fkey CASCADE;
ALTER TABLE friendships
    ADD CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE friendships DROP CONSTRAINT IF EXISTS friendships_requester_id_fkey CASCADE;
ALTER TABLE friendships
    ADD CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_best_scores DROP CONSTRAINT IF EXISTS game_best_scores_game_id_fkey CASCADE;
ALTER TABLE game_best_scores
    ADD CONSTRAINT game_best_scores_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_best_scores DROP CONSTRAINT IF EXISTS game_best_scores_user_id_fkey CASCADE;
ALTER TABLE game_best_scores
    ADD CONSTRAINT game_best_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_challenge_id_fkey CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES game_challenges(id) ON DELETE CASCADE;

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_challenger_play_id_fkey CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_challenger_play_id_fkey FOREIGN KEY (challenger_play_id) REFERENCES game_plays(id) ON DELETE SET NULL;

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_opponent_play_id_fkey CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_opponent_play_id_fkey FOREIGN KEY (opponent_play_id) REFERENCES game_plays(id) ON DELETE SET NULL;

ALTER TABLE game_challenge_rounds DROP CONSTRAINT IF EXISTS game_challenge_rounds_round_winner_id_fkey CASCADE;
ALTER TABLE game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_round_winner_id_fkey FOREIGN KEY (round_winner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_challenges DROP CONSTRAINT IF EXISTS game_challenges_challenger_id_fkey CASCADE;
ALTER TABLE game_challenges
    ADD CONSTRAINT game_challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_challenges DROP CONSTRAINT IF EXISTS game_challenges_game_id_fkey CASCADE;
ALTER TABLE game_challenges
    ADD CONSTRAINT game_challenges_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_challenges DROP CONSTRAINT IF EXISTS game_challenges_opponent_id_fkey CASCADE;
ALTER TABLE game_challenges
    ADD CONSTRAINT game_challenges_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_challenges DROP CONSTRAINT IF EXISTS game_challenges_winner_id_fkey CASCADE;
ALTER TABLE game_challenges
    ADD CONSTRAINT game_challenges_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_favorites DROP CONSTRAINT IF EXISTS game_favorites_game_id_fkey CASCADE;
ALTER TABLE game_favorites
    ADD CONSTRAINT game_favorites_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_favorites DROP CONSTRAINT IF EXISTS game_favorites_user_id_fkey CASCADE;
ALTER TABLE game_favorites
    ADD CONSTRAINT game_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_milestone_claims DROP CONSTRAINT IF EXISTS game_milestone_claims_user_id_fkey CASCADE;
ALTER TABLE game_milestone_claims
    ADD CONSTRAINT game_milestone_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_plays DROP CONSTRAINT IF EXISTS game_plays_game_id_fkey CASCADE;
ALTER TABLE game_plays
    ADD CONSTRAINT game_plays_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_plays DROP CONSTRAINT IF EXISTS game_plays_user_id_fkey CASCADE;
ALTER TABLE game_plays
    ADD CONSTRAINT game_plays_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_ratings DROP CONSTRAINT IF EXISTS game_ratings_game_id_fkey CASCADE;
ALTER TABLE game_ratings
    ADD CONSTRAINT game_ratings_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_ratings DROP CONSTRAINT IF EXISTS game_ratings_user_id_fkey CASCADE;
ALTER TABLE game_ratings
    ADD CONSTRAINT game_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_game_id_fkey CASCADE;
ALTER TABLE game_saves
    ADD CONSTRAINT game_saves_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_user_id_fkey CASCADE;
ALTER TABLE game_saves
    ADD CONSTRAINT game_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_creator_id_fkey CASCADE;
ALTER TABLE games
    ADD CONSTRAINT games_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE gift_items DROP CONSTRAINT IF EXISTS gift_items_season_id_fkey CASCADE;
ALTER TABLE gift_items
    ADD CONSTRAINT gift_items_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL;

ALTER TABLE gift_types DROP CONSTRAINT IF EXISTS gift_types_season_id_fkey CASCADE;
ALTER TABLE gift_types
    ADD CONSTRAINT gift_types_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_gift_item_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES gift_items(id) ON DELETE RESTRICT;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_gift_type_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_gift_type_id_fkey FOREIGN KEY (gift_type_id) REFERENCES gift_types(id) ON DELETE RESTRICT;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_message_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_recipient_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_room_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_sender_id_fkey CASCADE;
ALTER TABLE gifts
    ADD CONSTRAINT gifts_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE group_chat_members DROP CONSTRAINT IF EXISTS group_chat_members_group_chat_id_fkey CASCADE;
ALTER TABLE group_chat_members
    ADD CONSTRAINT group_chat_members_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE;

ALTER TABLE group_chat_members DROP CONSTRAINT IF EXISTS group_chat_members_user_id_fkey CASCADE;
ALTER TABLE group_chat_members
    ADD CONSTRAINT group_chat_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE group_chats DROP CONSTRAINT IF EXISTS group_chats_creator_id_fkey CASCADE;
ALTER TABLE group_chats
    ADD CONSTRAINT group_chats_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_alliance_members DROP CONSTRAINT IF EXISTS guild_alliance_members_alliance_id_fkey CASCADE;
ALTER TABLE guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_alliance_id_fkey FOREIGN KEY (alliance_id) REFERENCES guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE guild_alliance_members DROP CONSTRAINT IF EXISTS guild_alliance_members_guild_id_fkey CASCADE;
ALTER TABLE guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_alliances DROP CONSTRAINT IF EXISTS guild_alliances_founded_by_fkey CASCADE;
ALTER TABLE guild_alliances
    ADD CONSTRAINT guild_alliances_founded_by_fkey FOREIGN KEY (founded_by) REFERENCES guilds(id) ON DELETE RESTRICT;

ALTER TABLE guild_applications DROP CONSTRAINT IF EXISTS guild_applications_guild_id_fkey CASCADE;
ALTER TABLE guild_applications
    ADD CONSTRAINT guild_applications_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_applications DROP CONSTRAINT IF EXISTS guild_applications_reviewed_by_fkey CASCADE;
ALTER TABLE guild_applications
    ADD CONSTRAINT guild_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE guild_applications DROP CONSTRAINT IF EXISTS guild_applications_user_id_fkey CASCADE;
ALTER TABLE guild_applications
    ADD CONSTRAINT guild_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_contribution_alerts DROP CONSTRAINT IF EXISTS guild_contribution_alerts_guild_id_fkey CASCADE;
ALTER TABLE guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_contribution_alerts DROP CONSTRAINT IF EXISTS guild_contribution_alerts_user_id_fkey CASCADE;
ALTER TABLE guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_created_by_fkey CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_guild_id_fkey CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_invited_user_id_fkey CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_invites DROP CONSTRAINT IF EXISTS guild_invites_used_by_user_id_fkey CASCADE;
ALTER TABLE guild_invites
    ADD CONSTRAINT guild_invites_used_by_user_id_fkey FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE guild_members DROP CONSTRAINT IF EXISTS guild_members_guild_id_fkey CASCADE;
ALTER TABLE guild_members
    ADD CONSTRAINT guild_members_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_members DROP CONSTRAINT IF EXISTS guild_members_user_id_fkey CASCADE;
ALTER TABLE guild_members
    ADD CONSTRAINT guild_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_messages DROP CONSTRAINT IF EXISTS guild_messages_guild_id_fkey CASCADE;
ALTER TABLE guild_messages
    ADD CONSTRAINT guild_messages_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_messages DROP CONSTRAINT IF EXISTS guild_messages_sender_id_fkey CASCADE;
ALTER TABLE guild_messages
    ADD CONSTRAINT guild_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_quest_contributions DROP CONSTRAINT IF EXISTS guild_quest_contributions_quest_id_fkey CASCADE;
ALTER TABLE guild_quest_contributions
    ADD CONSTRAINT guild_quest_contributions_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES guild_quests(id) ON DELETE CASCADE;

ALTER TABLE guild_quest_contributions DROP CONSTRAINT IF EXISTS guild_quest_contributions_user_id_fkey CASCADE;
ALTER TABLE guild_quest_contributions
    ADD CONSTRAINT guild_quest_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE guild_quests DROP CONSTRAINT IF EXISTS guild_quests_guild_id_fkey CASCADE;
ALTER TABLE guild_quests
    ADD CONSTRAINT guild_quests_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_rooms DROP CONSTRAINT IF EXISTS guild_rooms_guild_id_fkey CASCADE;
ALTER TABLE guild_rooms
    ADD CONSTRAINT guild_rooms_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_rooms DROP CONSTRAINT IF EXISTS guild_rooms_room_id_fkey CASCADE;
ALTER TABLE guild_rooms
    ADD CONSTRAINT guild_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE guild_tier_history DROP CONSTRAINT IF EXISTS guild_tier_history_guild_id_fkey CASCADE;
ALTER TABLE guild_tier_history
    ADD CONSTRAINT guild_tier_history_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_tier_history DROP CONSTRAINT IF EXISTS guild_tier_history_war_id_fkey CASCADE;
ALTER TABLE guild_tier_history
    ADD CONSTRAINT guild_tier_history_war_id_fkey FOREIGN KEY (war_id) REFERENCES guild_wars(id) ON DELETE SET NULL;

ALTER TABLE guild_treasury_ledger DROP CONSTRAINT IF EXISTS guild_treasury_ledger_guild_id_fkey CASCADE;
ALTER TABLE guild_treasury_ledger
    ADD CONSTRAINT guild_treasury_ledger_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_treasury_ledger DROP CONSTRAINT IF EXISTS guild_treasury_ledger_user_id_fkey CASCADE;
ALTER TABLE guild_treasury_ledger
    ADD CONSTRAINT guild_treasury_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE guild_war_rematch_tokens DROP CONSTRAINT IF EXISTS guild_war_rematch_tokens_guild_id_fkey CASCADE;
ALTER TABLE guild_war_rematch_tokens
    ADD CONSTRAINT guild_war_rematch_tokens_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_war_rematch_tokens DROP CONSTRAINT IF EXISTS guild_war_rematch_tokens_war_id_fkey CASCADE;
ALTER TABLE guild_war_rematch_tokens
    ADD CONSTRAINT guild_war_rematch_tokens_war_id_fkey FOREIGN KEY (war_id) REFERENCES guild_wars(id) ON DELETE CASCADE;

ALTER TABLE guild_wars DROP CONSTRAINT IF EXISTS guild_wars_challenger_guild_id_fkey CASCADE;
ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_challenger_guild_id_fkey FOREIGN KEY (challenger_guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_wars DROP CONSTRAINT IF EXISTS guild_wars_defender_guild_id_fkey CASCADE;
ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_defender_guild_id_fkey FOREIGN KEY (defender_guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE guild_wars DROP CONSTRAINT IF EXISTS guild_wars_winner_guild_id_fkey CASCADE;
ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_winner_guild_id_fkey FOREIGN KEY (winner_guild_id) REFERENCES guilds(id);

ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_captain_id_fkey CASCADE;
ALTER TABLE guilds
    ADD CONSTRAINT guilds_captain_id_fkey FOREIGN KEY (captain_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE hall_of_fame DROP CONSTRAINT IF EXISTS hall_of_fame_user_id_fkey CASCADE;
ALTER TABLE hall_of_fame
    ADD CONSTRAINT hall_of_fame_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE leaderboard_rank_snapshots DROP CONSTRAINT IF EXISTS leaderboard_rank_snapshots_user_id_fkey CASCADE;
ALTER TABLE leaderboard_rank_snapshots
    ADD CONSTRAINT leaderboard_rank_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE leaderboard_snapshots DROP CONSTRAINT IF EXISTS leaderboard_snapshots_season_id_fkey CASCADE;
ALTER TABLE leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE leaderboard_snapshots DROP CONSTRAINT IF EXISTS leaderboard_snapshots_user_id_fkey CASCADE;
ALTER TABLE leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE learning_certificates DROP CONSTRAINT IF EXISTS learning_certificates_issuer_user_id_fkey CASCADE;
ALTER TABLE learning_certificates
    ADD CONSTRAINT learning_certificates_issuer_user_id_fkey FOREIGN KEY (issuer_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE learning_certificates DROP CONSTRAINT IF EXISTS learning_certificates_recipient_user_id_fkey CASCADE;
ALTER TABLE learning_certificates
    ADD CONSTRAINT learning_certificates_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE learning_certificates DROP CONSTRAINT IF EXISTS learning_certificates_room_id_fkey CASCADE;
ALTER TABLE learning_certificates
    ADD CONSTRAINT learning_certificates_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE merch_orders DROP CONSTRAINT IF EXISTS merch_orders_buyer_id_fkey CASCADE;
ALTER TABLE merch_orders
    ADD CONSTRAINT merch_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE merch_orders DROP CONSTRAINT IF EXISTS merch_orders_creator_id_fkey CASCADE;
ALTER TABLE merch_orders
    ADD CONSTRAINT merch_orders_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE merch_orders DROP CONSTRAINT IF EXISTS merch_orders_product_id_fkey CASCADE;
ALTER TABLE merch_orders
    ADD CONSTRAINT merch_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES merch_products(id) ON DELETE RESTRICT;

ALTER TABLE merch_orders DROP CONSTRAINT IF EXISTS merch_orders_store_id_fkey CASCADE;
ALTER TABLE merch_orders
    ADD CONSTRAINT merch_orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES merch_stores(id) ON DELETE SET NULL;

ALTER TABLE merch_products DROP CONSTRAINT IF EXISTS merch_products_store_id_fkey CASCADE;
ALTER TABLE merch_products
    ADD CONSTRAINT merch_products_store_id_fkey FOREIGN KEY (store_id) REFERENCES merch_stores(id) ON DELETE CASCADE;

ALTER TABLE merch_stores DROP CONSTRAINT IF EXISTS merch_stores_creator_id_fkey CASCADE;
ALTER TABLE merch_stores
    ADD CONSTRAINT merch_stores_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_message_id_fkey CASCADE;
ALTER TABLE message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_user_id_fkey CASCADE;
ALTER TABLE message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_deleted_by_fkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_group_chat_id_fkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_recipient_id_fkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey CASCADE;
ALTER TABLE messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_moderator_id_fkey CASCADE;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_report_id_fkey CASCADE;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_reversed_by_fkey CASCADE;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_target_user_id_fkey CASCADE;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moderation_ai_escalations DROP CONSTRAINT IF EXISTS moderation_ai_escalations_admin_id_fkey CASCADE;
ALTER TABLE moderation_ai_escalations
    ADD CONSTRAINT moderation_ai_escalations_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moderation_ai_escalations DROP CONSTRAINT IF EXISTS moderation_ai_escalations_report_id_fkey CASCADE;
ALTER TABLE moderation_ai_escalations
    ADD CONSTRAINT moderation_ai_escalations_report_id_fkey FOREIGN KEY (report_id) REFERENCES moderation_reports(id) ON DELETE CASCADE;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_forum_answer_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_forum_answer_id_fkey FOREIGN KEY (reported_forum_answer_id) REFERENCES forum_answers(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_forum_question_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_forum_question_id_fkey FOREIGN KEY (reported_forum_question_id) REFERENCES forum_questions(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_guild_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_guild_id_fkey FOREIGN KEY (reported_guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_message_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_message_id_fkey FOREIGN KEY (reported_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_room_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_room_id_fkey FOREIGN KEY (reported_room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reported_user_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_reporter_id_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_resolved_by_fkey CASCADE;
ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE moment_reactions DROP CONSTRAINT IF EXISTS moment_reactions_moment_id_fkey CASCADE;
ALTER TABLE moment_reactions
    ADD CONSTRAINT moment_reactions_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE;

ALTER TABLE moment_reactions DROP CONSTRAINT IF EXISTS moment_reactions_user_id_fkey CASCADE;
ALTER TABLE moment_reactions
    ADD CONSTRAINT moment_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moment_views DROP CONSTRAINT IF EXISTS moment_views_moment_id_fkey CASCADE;
ALTER TABLE moment_views
    ADD CONSTRAINT moment_views_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE;

ALTER TABLE moment_views DROP CONSTRAINT IF EXISTS moment_views_viewer_id_fkey CASCADE;
ALTER TABLE moment_views
    ADD CONSTRAINT moment_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE moments DROP CONSTRAINT IF EXISTS moments_user_id_fkey CASCADE;
ALTER TABLE moments
    ADD CONSTRAINT moments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE monthly_gift_drops DROP CONSTRAINT IF EXISTS monthly_gift_drops_gift_item_id_fkey CASCADE;
ALTER TABLE monthly_gift_drops
    ADD CONSTRAINT monthly_gift_drops_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES gift_items(id) ON DELETE SET NULL;

ALTER TABLE nemesis_assignments DROP CONSTRAINT IF EXISTS nemesis_assignments_nemesis_id_fkey CASCADE;
ALTER TABLE nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_nemesis_id_fkey FOREIGN KEY (nemesis_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE nemesis_assignments DROP CONSTRAINT IF EXISTS nemesis_assignments_nemesis_user_id_fkey CASCADE;
ALTER TABLE nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_nemesis_user_id_fkey FOREIGN KEY (nemesis_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE nemesis_assignments DROP CONSTRAINT IF EXISTS nemesis_assignments_user_id_fkey CASCADE;
ALTER TABLE nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE nemesis_challenges DROP CONSTRAINT IF EXISTS nemesis_challenges_challenged_id_fkey CASCADE;
ALTER TABLE nemesis_challenges
    ADD CONSTRAINT nemesis_challenges_challenged_id_fkey FOREIGN KEY (challenged_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE nemesis_challenges DROP CONSTRAINT IF EXISTS nemesis_challenges_challenger_id_fkey CASCADE;
ALTER TABLE nemesis_challenges
    ADD CONSTRAINT nemesis_challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE new_member_quests DROP CONSTRAINT IF EXISTS new_member_quests_user_id_fkey CASCADE;
ALTER TABLE new_member_quests
    ADD CONSTRAINT new_member_quests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey CASCADE;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_user_id_fkey CASCADE;
ALTER TABLE password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey CASCADE;
ALTER TABLE payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE payout_dead_letter_queue DROP CONSTRAINT IF EXISTS payout_dead_letter_queue_creator_id_fkey CASCADE;
ALTER TABLE payout_dead_letter_queue
    ADD CONSTRAINT payout_dead_letter_queue_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE payout_dead_letter_queue DROP CONSTRAINT IF EXISTS payout_dead_letter_queue_payout_id_fkey CASCADE;
ALTER TABLE payout_dead_letter_queue
    ADD CONSTRAINT payout_dead_letter_queue_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES creator_payouts(id) ON DELETE CASCADE;

ALTER TABLE platform_council_ideas DROP CONSTRAINT IF EXISTS platform_council_ideas_author_id_fkey CASCADE;
ALTER TABLE platform_council_ideas
    ADD CONSTRAINT platform_council_ideas_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE platform_council_members DROP CONSTRAINT IF EXISTS platform_council_members_user_id_fkey CASCADE;
ALTER TABLE platform_council_members
    ADD CONSTRAINT platform_council_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE platform_events DROP CONSTRAINT IF EXISTS platform_events_created_by_fkey CASCADE;
ALTER TABLE platform_events
    ADD CONSTRAINT platform_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE push_tickets DROP CONSTRAINT IF EXISTS push_tickets_user_id_fkey CASCADE;
ALTER TABLE push_tickets
    ADD CONSTRAINT push_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE rank_up_events DROP CONSTRAINT IF EXISTS rank_up_events_user_id_fkey CASCADE;
ALTER TABLE rank_up_events
    ADD CONSTRAINT rank_up_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE reaction_set_items DROP CONSTRAINT IF EXISTS reaction_set_items_set_id_fkey CASCADE;
ALTER TABLE reaction_set_items
    ADD CONSTRAINT reaction_set_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES reaction_sets(id) ON DELETE CASCADE;

ALTER TABLE referral_commissions DROP CONSTRAINT IF EXISTS referral_commissions_referred_user_id_fkey CASCADE;
ALTER TABLE referral_commissions
    ADD CONSTRAINT referral_commissions_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE referral_commissions DROP CONSTRAINT IF EXISTS referral_commissions_referrer_id_fkey CASCADE;
ALTER TABLE referral_commissions
    ADD CONSTRAINT referral_commissions_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referred_id_fkey CASCADE;
ALTER TABLE referrals
    ADD CONSTRAINT referrals_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_fkey CASCADE;
ALTER TABLE referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_processed_by_fkey CASCADE;
ALTER TABLE refunds
    ADD CONSTRAINT refunds_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_user_id_fkey CASCADE;
ALTER TABLE refunds
    ADD CONSTRAINT refunds_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_moderator_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_forum_answer_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_forum_answer_id_fkey FOREIGN KEY (reported_forum_answer_id) REFERENCES forum_answers(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_forum_question_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_forum_question_id_fkey FOREIGN KEY (reported_forum_question_id) REFERENCES forum_questions(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_guild_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_guild_id_fkey FOREIGN KEY (reported_guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_message_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_message_id_fkey FOREIGN KEY (reported_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_room_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_room_id_fkey FOREIGN KEY (reported_room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_user_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey CASCADE;
ALTER TABLE reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_member_highlights DROP CONSTRAINT IF EXISTS room_member_highlights_highlighted_by_fkey CASCADE;
ALTER TABLE room_member_highlights
    ADD CONSTRAINT room_member_highlights_highlighted_by_fkey FOREIGN KEY (highlighted_by) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_member_highlights DROP CONSTRAINT IF EXISTS room_member_highlights_room_id_fkey CASCADE;
ALTER TABLE room_member_highlights
    ADD CONSTRAINT room_member_highlights_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_member_highlights DROP CONSTRAINT IF EXISTS room_member_highlights_user_id_fkey CASCADE;
ALTER TABLE room_member_highlights
    ADD CONSTRAINT room_member_highlights_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_room_id_fkey CASCADE;
ALTER TABLE room_members
    ADD CONSTRAINT room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_user_id_fkey CASCADE;
ALTER TABLE room_members
    ADD CONSTRAINT room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_message_reactions DROP CONSTRAINT IF EXISTS room_message_reactions_message_id_fkey CASCADE;
ALTER TABLE room_message_reactions
    ADD CONSTRAINT room_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES room_messages(id) ON DELETE CASCADE;

ALTER TABLE room_message_reactions DROP CONSTRAINT IF EXISTS room_message_reactions_room_id_fkey CASCADE;
ALTER TABLE room_message_reactions
    ADD CONSTRAINT room_message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_message_reactions DROP CONSTRAINT IF EXISTS room_message_reactions_user_id_fkey CASCADE;
ALTER TABLE room_message_reactions
    ADD CONSTRAINT room_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_group_chat_id_fkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE;

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_pinned_by_fkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_reply_to_message_id_fkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_room_id_fkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_sender_id_fkey CASCADE;
ALTER TABLE room_messages
    ADD CONSTRAINT room_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_moderation_log DROP CONSTRAINT IF EXISTS room_moderation_log_moderator_id_fkey CASCADE;
ALTER TABLE room_moderation_log
    ADD CONSTRAINT room_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_moderation_log DROP CONSTRAINT IF EXISTS room_moderation_log_room_id_fkey CASCADE;
ALTER TABLE room_moderation_log
    ADD CONSTRAINT room_moderation_log_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_moderation_log DROP CONSTRAINT IF EXISTS room_moderation_log_target_user_id_fkey CASCADE;
ALTER TABLE room_moderation_log
    ADD CONSTRAINT room_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE room_monthly_active_users DROP CONSTRAINT IF EXISTS room_monthly_active_users_room_id_fkey CASCADE;
ALTER TABLE room_monthly_active_users
    ADD CONSTRAINT room_monthly_active_users_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_pins DROP CONSTRAINT IF EXISTS room_pins_room_id_fkey CASCADE;
ALTER TABLE room_pins
    ADD CONSTRAINT room_pins_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_pins DROP CONSTRAINT IF EXISTS room_pins_user_id_fkey CASCADE;
ALTER TABLE room_pins
    ADD CONSTRAINT room_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_promotions DROP CONSTRAINT IF EXISTS room_promotions_creator_id_fkey CASCADE;
ALTER TABLE room_promotions
    ADD CONSTRAINT room_promotions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_promotions DROP CONSTRAINT IF EXISTS room_promotions_promoted_by_fkey CASCADE;
ALTER TABLE room_promotions
    ADD CONSTRAINT room_promotions_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE room_promotions DROP CONSTRAINT IF EXISTS room_promotions_room_id_fkey CASCADE;
ALTER TABLE room_promotions
    ADD CONSTRAINT room_promotions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_subscriptions DROP CONSTRAINT IF EXISTS room_subscriptions_room_id_fkey CASCADE;
ALTER TABLE room_subscriptions
    ADD CONSTRAINT room_subscriptions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_subscriptions DROP CONSTRAINT IF EXISTS room_subscriptions_user_id_fkey CASCADE;
ALTER TABLE room_subscriptions
    ADD CONSTRAINT room_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE room_visits DROP CONSTRAINT IF EXISTS room_visits_room_id_fkey CASCADE;
ALTER TABLE room_visits
    ADD CONSTRAINT room_visits_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

ALTER TABLE room_visits DROP CONSTRAINT IF EXISTS room_visits_user_id_fkey CASCADE;
ALTER TABLE room_visits
    ADD CONSTRAINT room_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_banned_by_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_creator_id_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_flagged_by_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_flagged_by_fkey FOREIGN KEY (flagged_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_guild_id_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_spotlight_by_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_spotlight_by_fkey FOREIGN KEY (spotlight_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_suspended_by_fkey CASCADE;
ALTER TABLE rooms
    ADD CONSTRAINT rooms_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE season_pass_milestones DROP CONSTRAINT IF EXISTS season_pass_milestones_season_id_fkey CASCADE;
ALTER TABLE season_pass_milestones
    ADD CONSTRAINT season_pass_milestones_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE season_rank_archives DROP CONSTRAINT IF EXISTS season_rank_archives_season_id_fkey CASCADE;
ALTER TABLE season_rank_archives
    ADD CONSTRAINT season_rank_archives_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE season_rank_archives DROP CONSTRAINT IF EXISTS season_rank_archives_user_id_fkey CASCADE;
ALTER TABLE season_rank_archives
    ADD CONSTRAINT season_rank_archives_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_created_by_fkey CASCADE;
ALTER TABLE seasons
    ADD CONSTRAINT seasons_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_creator_id_fkey CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_payout_id_fkey CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES creator_payouts(id) ON DELETE SET NULL;

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_quest_id_fkey CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES sponsored_quests(id) ON DELETE CASCADE;

ALTER TABLE sponsored_quest_applications DROP CONSTRAINT IF EXISTS sponsored_quest_applications_room_id_fkey CASCADE;
ALTER TABLE sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE star_ledger DROP CONSTRAINT IF EXISTS star_ledger_user_id_fkey CASCADE;
ALTER TABLE star_ledger
    ADD CONSTRAINT star_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE stickers DROP CONSTRAINT IF EXISTS stickers_pack_id_fkey CASCADE;
ALTER TABLE stickers
    ADD CONSTRAINT stickers_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE;

ALTER TABLE store_items DROP CONSTRAINT IF EXISTS store_items_season_id_fkey CASCADE;
ALTER TABLE store_items
    ADD CONSTRAINT store_items_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey CASCADE;
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_resolved_by_fkey CASCADE;
ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE telegram_delivery_queue DROP CONSTRAINT IF EXISTS telegram_delivery_queue_broadcast_id_fkey CASCADE;
ALTER TABLE telegram_delivery_queue
    ADD CONSTRAINT telegram_delivery_queue_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES admin_messages(id) ON DELETE CASCADE;

ALTER TABLE track_milestone_unlocks DROP CONSTRAINT IF EXISTS track_milestone_unlocks_user_id_fkey CASCADE;
ALTER TABLE track_milestone_unlocks
    ADD CONSTRAINT track_milestone_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_announcement_rotation DROP CONSTRAINT IF EXISTS user_announcement_rotation_user_id_fkey CASCADE;
ALTER TABLE user_announcement_rotation
    ADD CONSTRAINT user_announcement_rotation_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_badges DROP CONSTRAINT IF EXISTS user_badges_user_id_fkey CASCADE;
ALTER TABLE user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_banner_views DROP CONSTRAINT IF EXISTS user_banner_views_banner_id_fkey CASCADE;
ALTER TABLE user_banner_views
    ADD CONSTRAINT user_banner_views_banner_id_fkey FOREIGN KEY (banner_id) REFERENCES announcement_banners(id) ON DELETE CASCADE;

ALTER TABLE user_banner_views DROP CONSTRAINT IF EXISTS user_banner_views_user_id_fkey CASCADE;
ALTER TABLE user_banner_views
    ADD CONSTRAINT user_banner_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_blocks DROP CONSTRAINT IF EXISTS user_blocks_blocked_id_fkey CASCADE;
ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_blocks DROP CONSTRAINT IF EXISTS user_blocks_blocker_id_fkey CASCADE;
ALTER TABLE user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_cosmetics DROP CONSTRAINT IF EXISTS user_cosmetics_store_item_id_fkey CASCADE;
ALTER TABLE user_cosmetics
    ADD CONSTRAINT user_cosmetics_store_item_id_fkey FOREIGN KEY (store_item_id) REFERENCES store_items(id) ON DELETE CASCADE;

ALTER TABLE user_cosmetics DROP CONSTRAINT IF EXISTS user_cosmetics_user_id_fkey CASCADE;
ALTER TABLE user_cosmetics
    ADD CONSTRAINT user_cosmetics_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_daily_logins DROP CONSTRAINT IF EXISTS user_daily_logins_user_id_fkey CASCADE;
ALTER TABLE user_daily_logins
    ADD CONSTRAINT user_daily_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_email_preferences DROP CONSTRAINT IF EXISTS user_email_preferences_user_id_fkey CASCADE;
ALTER TABLE user_email_preferences
    ADD CONSTRAINT user_email_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_inactivity_events DROP CONSTRAINT IF EXISTS user_inactivity_events_user_id_fkey CASCADE;
ALTER TABLE user_inactivity_events
    ADD CONSTRAINT user_inactivity_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_messages DROP CONSTRAINT IF EXISTS user_messages_recipient_id_fkey CASCADE;
ALTER TABLE user_messages
    ADD CONSTRAINT user_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_messages DROP CONSTRAINT IF EXISTS user_messages_sender_id_fkey CASCADE;
ALTER TABLE user_messages
    ADD CONSTRAINT user_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE user_modal_views DROP CONSTRAINT IF EXISTS user_modal_views_modal_id_fkey CASCADE;
ALTER TABLE user_modal_views
    ADD CONSTRAINT user_modal_views_modal_id_fkey FOREIGN KEY (modal_id) REFERENCES announcement_modals(id) ON DELETE CASCADE;

ALTER TABLE user_modal_views DROP CONSTRAINT IF EXISTS user_modal_views_user_id_fkey CASCADE;
ALTER TABLE user_modal_views
    ADD CONSTRAINT user_modal_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_pins DROP CONSTRAINT IF EXISTS user_pins_user_id_fkey CASCADE;
ALTER TABLE user_pins
    ADD CONSTRAINT user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_push_tokens DROP CONSTRAINT IF EXISTS user_push_tokens_user_id_fkey CASCADE;
ALTER TABLE user_push_tokens
    ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_quest_decks DROP CONSTRAINT IF EXISTS user_quest_decks_quest_id_fkey CASCADE;
ALTER TABLE user_quest_decks
    ADD CONSTRAINT user_quest_decks_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES quest_templates(id) ON DELETE CASCADE;

ALTER TABLE user_quest_decks DROP CONSTRAINT IF EXISTS user_quest_decks_user_id_fkey CASCADE;
ALTER TABLE user_quest_decks
    ADD CONSTRAINT user_quest_decks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_quest_progress DROP CONSTRAINT IF EXISTS user_quest_progress_quest_id_fkey CASCADE;
ALTER TABLE user_quest_progress
    ADD CONSTRAINT user_quest_progress_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES quest_templates(id) ON DELETE CASCADE;

ALTER TABLE user_quest_progress DROP CONSTRAINT IF EXISTS user_quest_progress_user_id_fkey CASCADE;
ALTER TABLE user_quest_progress
    ADD CONSTRAINT user_quest_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_reaction_sets DROP CONSTRAINT IF EXISTS user_reaction_sets_set_id_fkey CASCADE;
ALTER TABLE user_reaction_sets
    ADD CONSTRAINT user_reaction_sets_set_id_fkey FOREIGN KEY (set_id) REFERENCES reaction_sets(id) ON DELETE CASCADE;

ALTER TABLE user_reaction_sets DROP CONSTRAINT IF EXISTS user_reaction_sets_user_id_fkey CASCADE;
ALTER TABLE user_reaction_sets
    ADD CONSTRAINT user_reaction_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_season_milestone_claims DROP CONSTRAINT IF EXISTS user_season_milestone_claims_milestone_id_fkey CASCADE;
ALTER TABLE user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_milestone_id_fkey FOREIGN KEY (milestone_id) REFERENCES season_pass_milestones(id) ON DELETE CASCADE;

ALTER TABLE user_season_milestone_claims DROP CONSTRAINT IF EXISTS user_season_milestone_claims_season_id_fkey CASCADE;
ALTER TABLE user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE user_season_milestone_claims DROP CONSTRAINT IF EXISTS user_season_milestone_claims_user_id_fkey CASCADE;
ALTER TABLE user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_season_passes DROP CONSTRAINT IF EXISTS user_season_passes_season_id_fkey CASCADE;
ALTER TABLE user_season_passes
    ADD CONSTRAINT user_season_passes_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE user_season_passes DROP CONSTRAINT IF EXISTS user_season_passes_user_id_fkey CASCADE;
ALTER TABLE user_season_passes
    ADD CONSTRAINT user_season_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_sticker_packs DROP CONSTRAINT IF EXISTS user_sticker_packs_pack_id_fkey CASCADE;
ALTER TABLE user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE;

ALTER TABLE user_sticker_packs DROP CONSTRAINT IF EXISTS user_sticker_packs_user_id_fkey CASCADE;
ALTER TABLE user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_fkey CASCADE;
ALTER TABLE user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_titles DROP CONSTRAINT IF EXISTS user_titles_user_id_fkey CASCADE;
ALTER TABLE user_titles
    ADD CONSTRAINT user_titles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_xp_boosters DROP CONSTRAINT IF EXISTS user_xp_boosters_user_id_fkey CASCADE;
ALTER TABLE user_xp_boosters
    ADD CONSTRAINT user_xp_boosters_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_active_cosmetic_frame_id_fkey CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_active_cosmetic_frame_id_fkey FOREIGN KEY (active_cosmetic_frame_id) REFERENCES store_items(id) ON DELETE SET NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_banned_by_fkey CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_guild_id_fkey CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE SET NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_referred_by_fkey CASCADE;
ALTER TABLE users
    ADD CONSTRAINT users_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE war_contributions DROP CONSTRAINT IF EXISTS war_contributions_guild_id_fkey CASCADE;
ALTER TABLE war_contributions
    ADD CONSTRAINT war_contributions_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE;

ALTER TABLE war_contributions DROP CONSTRAINT IF EXISTS war_contributions_user_id_fkey CASCADE;
ALTER TABLE war_contributions
    ADD CONSTRAINT war_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE war_contributions DROP CONSTRAINT IF EXISTS war_contributions_war_id_fkey CASCADE;
ALTER TABLE war_contributions
    ADD CONSTRAINT war_contributions_war_id_fkey FOREIGN KEY (war_id) REFERENCES guild_wars(id) ON DELETE CASCADE;

ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_user_id_fkey CASCADE;
ALTER TABLE xp_events
    ADD CONSTRAINT xp_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE xp_ledger DROP CONSTRAINT IF EXISTS xp_ledger_user_id_fkey CASCADE;
ALTER TABLE xp_ledger
    ADD CONSTRAINT xp_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE admin_message_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_messages_insert_service ON admin_messages;
CREATE POLICY admin_messages_insert_service ON admin_messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS admin_msg_receipts_insert_service ON admin_message_receipts;
CREATE POLICY admin_msg_receipts_insert_service ON admin_message_receipts FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS admin_msg_receipts_own ON admin_message_receipts;
CREATE POLICY admin_msg_receipts_own ON admin_message_receipts FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS admin_msg_receipts_update_own ON admin_message_receipts;
CREATE POLICY admin_msg_receipts_update_own ON admin_message_receipts FOR UPDATE USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE announcement_banners ENABLE ROW LEVEL SECURITY;

ALTER TABLE announcement_modals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banners_select ON announcement_banners;
CREATE POLICY banners_select ON announcement_banners FOR SELECT USING (true);

ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coin_ledger_insert_service ON coin_ledger;
CREATE POLICY coin_ledger_insert_service ON coin_ledger FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS coin_ledger_isolation ON coin_ledger;
CREATE POLICY coin_ledger_isolation ON coin_ledger USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS coin_ledger_owner_or_admin ON coin_ledger;
CREATE POLICY coin_ledger_owner_or_admin ON coin_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS coin_ledger_select_own ON coin_ledger;
CREATE POLICY coin_ledger_select_own ON coin_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;

ALTER TABLE creator_kyc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_kyc_self_or_admin ON creator_kyc;
CREATE POLICY creator_kyc_self_or_admin ON creator_kyc USING (((creator_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

ALTER TABLE creator_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creator_payouts_isolation ON creator_payouts;
CREATE POLICY creator_payouts_isolation ON creator_payouts USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((creator_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS creator_payouts_self_or_admin ON creator_payouts;
CREATE POLICY creator_payouts_self_or_admin ON creator_payouts USING (((creator_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_conversations_isolation ON dm_conversations;
CREATE POLICY dm_conversations_isolation ON dm_conversations USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id_1)::text = current_setting('app.current_user_id'::text, true)) OR ((user_id_2)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS earnings_insert_service ON creator_earnings;
CREATE POLICY earnings_insert_service ON creator_earnings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS earnings_own ON creator_earnings;
CREATE POLICY earnings_own ON creator_earnings FOR SELECT USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE failed_xp_awards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS failed_xp_awards_admin_or_system ON failed_xp_awards;
CREATE POLICY failed_xp_awards_admin_or_system ON failed_xp_awards USING (((current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follows_delete ON follows;
CREATE POLICY follows_delete ON follows FOR DELETE USING (((follower_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS follows_insert ON follows;
CREATE POLICY follows_insert ON follows FOR INSERT WITH CHECK (((follower_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS follows_select ON follows;
CREATE POLICY follows_select ON follows FOR SELECT USING (true);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friendships_insert ON friendships;
CREATE POLICY friendships_insert ON friendships FOR INSERT WITH CHECK (((requester_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS friendships_own ON friendships;
CREATE POLICY friendships_own ON friendships FOR SELECT USING ((((requester_id)::text = current_setting('app.current_user_id'::text, true)) OR ((addressee_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS friendships_update_own ON friendships;
CREATE POLICY friendships_update_own ON friendships FOR UPDATE USING ((((requester_id)::text = current_setting('app.current_user_id'::text, true)) OR ((addressee_id)::text = current_setting('app.current_user_id'::text, true))));

ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_saves_isolation ON game_saves;
CREATE POLICY game_saves_isolation ON game_saves USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

ALTER TABLE gift_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_items_select ON gift_items;
CREATE POLICY gift_items_select ON gift_items FOR SELECT USING (true);

ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gifts_insert_service ON gifts;
CREATE POLICY gifts_insert_service ON gifts FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS gifts_own ON gifts;
CREATE POLICY gifts_own ON gifts FOR SELECT USING ((((sender_id)::text = current_setting('app.current_user_id'::text, true)) OR ((recipient_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS gifts_self_or_admin ON gifts;
CREATE POLICY gifts_self_or_admin ON gifts USING (((sender_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (recipient_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

ALTER TABLE group_chat_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_chat_members_insert_service ON group_chat_members;
CREATE POLICY group_chat_members_insert_service ON group_chat_members FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS group_chat_members_select ON group_chat_members;
CREATE POLICY group_chat_members_select ON group_chat_members FOR SELECT USING ((group_chat_id IN ( SELECT group_chat_members_1.group_chat_id
   FROM group_chat_members group_chat_members_1
  WHERE ((group_chat_members_1.user_id)::text = current_setting('app.current_user_id'::text, true)))));

ALTER TABLE group_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_chats_insert ON group_chats;
CREATE POLICY group_chats_insert ON group_chats FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS group_chats_select ON group_chats;
CREATE POLICY group_chats_select ON group_chats FOR SELECT USING ((id IN ( SELECT group_chat_members.group_chat_id
   FROM group_chat_members
  WHERE ((group_chat_members.user_id)::text = current_setting('app.current_user_id'::text, true)))));

ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guild_members_delete_service ON guild_members;
CREATE POLICY guild_members_delete_service ON guild_members FOR DELETE USING (true);

DROP POLICY IF EXISTS guild_members_insert_service ON guild_members;
CREATE POLICY guild_members_insert_service ON guild_members FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS guild_members_isolation ON guild_members;
CREATE POLICY guild_members_isolation ON guild_members USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS guild_members_read_public ON guild_members;
CREATE POLICY guild_members_read_public ON guild_members FOR SELECT USING (((current_setting('app.current_user_id'::text, true) = ''::text) AND (left_at IS NULL)));

DROP POLICY IF EXISTS guild_members_select ON guild_members;
CREATE POLICY guild_members_select ON guild_members FOR SELECT USING ((((user_id)::text = current_setting('app.current_user_id'::text, true)) OR (guild_id IN ( SELECT guild_members_1.guild_id
   FROM guild_members guild_members_1
  WHERE ((guild_members_1.user_id)::text = current_setting('app.current_user_id'::text, true))))));

DROP POLICY IF EXISTS guild_members_update_service ON guild_members;
CREATE POLICY guild_members_update_service ON guild_members FOR UPDATE USING (true);

ALTER TABLE guild_wars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guild_wars_insert_service ON guild_wars;
CREATE POLICY guild_wars_insert_service ON guild_wars FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS guild_wars_select ON guild_wars;
CREATE POLICY guild_wars_select ON guild_wars FOR SELECT USING (true);

DROP POLICY IF EXISTS guild_wars_update_service ON guild_wars;
CREATE POLICY guild_wars_update_service ON guild_wars FOR UPDATE USING (true);

ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guilds_insert ON guilds;
CREATE POLICY guilds_insert ON guilds FOR INSERT WITH CHECK (((captain_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS guilds_select ON guilds;
CREATE POLICY guilds_select ON guilds FOR SELECT USING (true);

DROP POLICY IF EXISTS guilds_update_captain ON guilds;
CREATE POLICY guilds_update_captain ON guilds FOR UPDATE USING (((captain_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS manifest_select ON x_manifest;
CREATE POLICY manifest_select ON x_manifest FOR SELECT USING (true);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_reactions_delete ON message_reactions;
CREATE POLICY message_reactions_delete ON message_reactions FOR DELETE USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS message_reactions_insert ON message_reactions;
CREATE POLICY message_reactions_insert ON message_reactions FOR INSERT WITH CHECK (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_dm_select ON messages;
CREATE POLICY messages_dm_select ON messages FOR SELECT USING ((((sender_id)::text = current_setting('app.current_user_id'::text, true)) OR ((recipient_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS messages_self_or_admin ON messages;
CREATE POLICY messages_self_or_admin ON messages USING (((sender_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (recipient_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS messages_update_own ON messages;
CREATE POLICY messages_update_own ON messages FOR UPDATE USING (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS modal_views_own ON user_modal_views;
CREATE POLICY modal_views_own ON user_modal_views USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS modals_select ON announcement_modals;
CREATE POLICY modals_select ON announcement_modals FOR SELECT USING (true);

ALTER TABLE nemesis_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nemesis_own ON nemesis_assignments;
CREATE POLICY nemesis_own ON nemesis_assignments FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_isolation ON notifications;
CREATE POLICY notifications_isolation ON notifications USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_insert_service ON payments;
CREATE POLICY payments_insert_service ON payments FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS payments_own ON payments;
CREATE POLICY payments_own ON payments FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS payments_self_or_admin ON payments;
CREATE POLICY payments_self_or_admin ON payments USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS payments_update_service ON payments;
CREATE POLICY payments_update_service ON payments FOR UPDATE USING (true);

DROP POLICY IF EXISTS payouts_insert_own ON creator_payouts;
CREATE POLICY payouts_insert_own ON creator_payouts FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS payouts_own ON creator_payouts;
CREATE POLICY payouts_own ON creator_payouts FOR SELECT USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE referral_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_commissions_owner ON referral_commissions;
CREATE POLICY referral_commissions_owner ON referral_commissions FOR SELECT USING (((referrer_id)::text = current_setting('app.user_id'::text, true)));

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_insert_service ON referrals;
CREATE POLICY referrals_insert_service ON referrals FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS referrals_own ON referrals;
CREATE POLICY referrals_own ON referrals FOR SELECT USING ((((referrer_id)::text = current_setting('app.current_user_id'::text, true)) OR ((referred_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS referrals_update_service ON referrals;
CREATE POLICY referrals_update_service ON referrals FOR UPDATE USING (true);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports FOR INSERT WITH CHECK (((reporter_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS reports_select_own ON reports;
CREATE POLICY reports_select_own ON reports FOR SELECT USING (((reporter_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_members_insert_service ON room_members;
CREATE POLICY room_members_insert_service ON room_members FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS room_members_select ON room_members;
CREATE POLICY room_members_select ON room_members FOR SELECT USING ((room_id IN ( SELECT room_members_1.room_id
   FROM room_members room_members_1
  WHERE ((room_members_1.user_id)::text = current_setting('app.current_user_id'::text, true)))));

ALTER TABLE room_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_messages_insert ON room_messages;
CREATE POLICY room_messages_insert ON room_messages FOR INSERT WITH CHECK (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS room_messages_select ON room_messages;
CREATE POLICY room_messages_select ON room_messages FOR SELECT USING (((room_id IN ( SELECT rooms.id
   FROM rooms
  WHERE (rooms.is_public = true))) OR (room_id IN ( SELECT room_members.room_id
   FROM room_members
  WHERE ((room_members.user_id)::text = current_setting('app.current_user_id'::text, true)))) OR ((sender_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS room_messages_update_own ON room_messages;
CREATE POLICY room_messages_update_own ON room_messages FOR UPDATE USING (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE room_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_visits_isolation ON room_visits;
CREATE POLICY room_visits_isolation ON room_visits USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_insert ON rooms;
CREATE POLICY rooms_insert ON rooms FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS rooms_select ON rooms;
CREATE POLICY rooms_select ON rooms FOR SELECT USING (((is_public = true) OR ((creator_id)::text = current_setting('app.current_user_id'::text, true)) OR (id IN ( SELECT room_members.room_id
   FROM room_members
  WHERE ((room_members.user_id)::text = current_setting('app.current_user_id'::text, true))))));

DROP POLICY IF EXISTS rooms_update_creator ON rooms;
CREATE POLICY rooms_update_creator ON rooms FOR UPDATE USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seasons_select ON seasons;
CREATE POLICY seasons_select ON seasons FOR SELECT USING (true);

ALTER TABLE star_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS star_ledger_insert_service ON star_ledger;
CREATE POLICY star_ledger_insert_service ON star_ledger FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS star_ledger_isolation ON star_ledger;
CREATE POLICY star_ledger_isolation ON star_ledger USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

DROP POLICY IF EXISTS star_ledger_owner_or_admin ON star_ledger;
CREATE POLICY star_ledger_owner_or_admin ON star_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS star_ledger_select_own ON star_ledger;
CREATE POLICY star_ledger_select_own ON star_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_insert_service ON subscriptions;
CREATE POLICY subscriptions_insert_service ON subscriptions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS subscriptions_own ON subscriptions;
CREATE POLICY subscriptions_own ON subscriptions FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DROP POLICY IF EXISTS subscriptions_update_service ON subscriptions;
CREATE POLICY subscriptions_update_service ON subscriptions FOR UPDATE USING (true);

ALTER TABLE telegram_login_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_login_states_service_only ON telegram_login_states;
CREATE POLICY telegram_login_states_service_only ON telegram_login_states USING (false) WITH CHECK (false);

ALTER TABLE user_modal_views ENABLE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_public ON users;
CREATE POLICY users_select_public ON users FOR SELECT USING (true);

DROP POLICY IF EXISTS users_self_or_admin ON users;
CREATE POLICY users_self_or_admin ON users USING (((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users FOR UPDATE USING (((id)::text = current_setting('app.current_user_id'::text, true)));

ALTER TABLE x_manifest ENABLE ROW LEVEL SECURITY;

ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS xp_ledger_insert_service ON xp_ledger;
CREATE POLICY xp_ledger_insert_service ON xp_ledger FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS xp_ledger_owner_or_admin ON xp_ledger;
CREATE POLICY xp_ledger_owner_or_admin ON xp_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

DROP POLICY IF EXISTS xp_ledger_select_own ON xp_ledger;
CREATE POLICY xp_ledger_select_own ON xp_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

-- =====================================================================
-- SECTION: REFERENCE / CONFIG SEED DATA
-- Catalog and configuration rows the app depends on to function (feature
-- flags, game catalog, gift/store catalog, quest templates, sticker packs,
-- Answers categories, cultural events calendar). This is NOT sample/demo
-- data -- see db/seed.sql for demo users/rooms/content used in local dev.
-- All statements are idempotent (ON CONFLICT DO NOTHING) so this file is
-- safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- Feature flags & config defaults (x_manifest)
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('minimum_age', '18', 'Minimum age for registration'),
  ('auth_google_enabled', 'true', 'Enable Google OAuth'),
  ('auth_telegram_enabled', 'true', 'Enable Telegram Login'),
  ('feature_nemesis_system', 'true', 'Enable Nemesis system'),
  ('feature_guild_wars', 'true', 'Enable Guild Wars'),
  ('feature_classrooms', 'true', 'Enable ClassRooms'),
  ('feature_community_notes', 'true', 'Enable Community Notes'),
  ('feature_star_purchase', 'false', 'Enable direct Star purchase'),
  ('feature_star_purchase_enabled', 'false', 'Enable direct Star purchase via store'),
  ('feature_merch_store', 'false', 'Enable Creator Merch Store'),
  ('feature_platform_council', 'true', 'Enable Platform Council'),
  ('feature_alliance_system', 'true', 'Enable Alliance System'),
  ('feature_business_accounts', 'true', 'Enable Business Accounts'),
  ('feature_admob_ads', 'true', 'Enable AdMob ads'),
  ('feature_rewarded_ads', 'true', 'Enable rewarded video ads'),
  ('feature_rooms', 'true', 'Enable Rooms feature'),
  ('feature_direct_messages', 'true', 'Enable Direct Messages'),
  ('feature_gifts', 'true', 'Enable Gifts feature'),
  ('feature_rankings', 'true', 'Enable Rankings/Leaderboards'),
  ('feature_pin_auth', 'true', 'Enable PIN authentication'),
  ('feature_mystery_xp_drops', 'true', 'Enable Mystery XP Drop events'),
  ('mystery_drop_batch_size', '50', 'Users per Mystery XP Drop'),
  ('mystery_drop_days_per_week', '3', 'Mystery drop days per week'),
  ('pwa_web_enabled', 'true', 'Enable PWA on web'),
  ('pwa_android_enabled', 'false', 'Enable PWA on Android'),
  ('pwa_ios_enabled', 'false', 'Enable PWA on iOS'),
  ('coin_to_cash_rate', '1', 'Kobo per coin (1 coin = 1 kobo = ₦0.01)'),
  ('payout_threshold_kobo', '100000', 'Minimum payout in kobo (₦1,000)'),
  ('payout_large_approval_kobo', '5000000', 'Manual approval threshold kobo (₦50,000)'),
  ('payout_low_balance_alert_kobo', '10000000', 'Low balance alert kobo (₦100,000)'),
  ('vip_room_min_subscription_kobo', '20000', 'Min VIP Room subscription (₦200)'),
  ('vip_room_max_subscription_kobo', '1000000', 'Max VIP Room subscription (₦10,000)'),
  ('season_pass_price_coins', '500', 'Default Season Pass price in Coins'),
  ('creator_platform_fee_percent', '20', 'Platform fee % on creator earnings'),
  ('dm_coin_cost_free', '2', 'DM coin cost Free tier'),
  ('dm_coin_cost_plus', '1', 'DM coin cost Plus tier'),
  ('dm_reply_limit_free', '25', 'Max DM replies/day Free plan'),
  ('dm_reply_limit_plus', '50', 'Max DM replies/day Plus plan'),
  ('email_all_enabled', 'true', 'Enable all email notifications'),
  ('email_non_critical_enabled', 'true', 'Enable non-critical emails'),
  ('cron_external_enabled', 'false', 'Use cron-jobs.org for high-frequency crons'),
  ('ai_moderation_enabled', 'true', 'Enable AI moderation'),
  ('ai_moderation_auto_action_threshold', '0.9', 'AI auto-action confidence threshold'),
  ('ai_moderation_community_threshold', '0.7', 'AI community review threshold'),
  ('payouts_enabled', 'true', 'Master payout toggle'),
  ('nigeria_cash_payout_enabled', 'true', 'Nigeria bank transfer payouts'),
  ('nigeria_coins_payout_enabled', 'true', 'Nigeria coin-based payouts'),
  ('nigeria_crypto_payout_enabled', 'true', 'Nigeria USDT/Tron payouts'),
  ('global_coins_payout_enabled', 'true', 'Global coin-based payouts'),
  ('global_crypto_payout_enabled', 'true', 'Global USDT/Tron payouts'),
  ('nigeria_payout_auto_approve', 'true', 'Nigeria bank auto-approve'),
  ('payout_batch_size', '200', 'Max payouts per CRON run'),
  ('payout_max_retries', '3', 'Max payout retry attempts'),
  ('bank_account_first_add_xp', '5', 'XP on first bank account add'),
  ('bank_account_first_add_creator_xp', '10', 'Creator XP on first bank account add'),
  ('referral_tier1_coin_bonus', '100', 'Tier 1 referral coin bonus'),
  ('referral_tier1_xp_bonus', '500', 'Tier 1 referral XP bonus'),
  ('referral_tier2_coin_bonus', '50', 'Tier 2 referral coin bonus'),
  ('referral_tier2_xp_bonus', '250', 'Tier 2 referral XP bonus'),
  ('auth_2fa_enabled', 'true', 'Allow users to configure two-factor authentication'),
  ('auth_2fa_required_for_mods', 'false', 'Require 2FA for moderators before they can log in'),
  ('privacy_can_lock_profile', '["pro", "max", "prestige_1"]', 'Plans/roles allowed to lock their profile (hide from non-friends). JSON array.'),
  ('privacy_can_hide_sections', '["plus", "pro", "max", "prestige_1"]', 'Plans/roles allowed to hide individual profile sections. JSON array.'),
  ('privacy_can_disable_friend_requests', '["plus", "pro", "max", "prestige_1"]', 'Plans/roles allowed to disable incoming friend requests. JSON array.'),
  ('privacy_hideable_sections', '["avatar", "bio", "rank", "xp", "guild", "seasons", "badges"]', 'Profile sections that users can hide (admin-controlled list). JSON array.'),
  ('captcha_provider', 'none', 'CAPTCHA provider: recaptcha | turnstile | none'),
  ('payment_provider_nigeria', 'paystack', 'Payment provider Nigeria'),
  ('feature_alliance_wars', 'true', 'Enable National Alliance Wars'),
  ('feature_creator_fund', 'true', 'Enable Creator Fund distributions'),
  ('feature_leaderboard_seasons', 'true', 'Enable seasonal leaderboard mode'),
  ('feature_telegram_integration', 'false', 'Enable Telegram notification channel'),
  ('feature_sentry_tracing', 'false', 'Enable Sentry performance tracing'),
  ('room_free_open_cap', '30', 'Soft concurrent-participant cap for free_open rooms'),
  ('room_tipping_cap', '30', 'Soft concurrent-participant cap for tipping rooms'),
  ('room_vip_cap', '200', 'Soft concurrent-participant cap for VIP rooms'),
  ('room_drop_cap', '100', 'Soft concurrent-participant cap for drop rooms'),
  ('room_classroom_cap', '150', 'Soft concurrent-participant cap for classroom rooms'),
  ('room_guild_cap', '100', 'Soft concurrent-participant cap for guild rooms'),
  ('room_capacity_upgrade_step', '25', 'Slots added per purchased capacity-upgrade step'),
  ('room_capacity_upgrade_cost', '500', 'Coin cost per capacity-upgrade step'),
  ('room_capacity_hard_max', '1000', 'Absolute ceiling a room capacity can be raised to'),
  ('feature_games', 'true', 'Master switch for the Games feature (directory, /g pages, challenges).'),
  ('game_wager_rake_pct', '5', 'Platform rake percentage taken from a challenge wager pot before payout.'),
  ('game_challenge_expiry_hours', '48', 'Hours a pending/active challenge stays open before it expires.'),
  ('game_default_reward_credits', '50', 'Fallback credits awarded for a game win when a game sets 0.'),
  ('game_default_reward_xp', '40', 'Fallback gaming XP awarded for a game win when a game sets 0.'),
  ('game_ads_enabled', 'true', 'Master toggle for ads on game pages (cover + play).'),
  ('game_ads_directory_enabled', 'true', 'Toggle for ads on the games directory page.'),
  ('game_trending_hours', '72', 'Window in hours for computing trending play counts.'),
  ('payment_provider_international', 'dodopayments', 'Payment provider international'),
  ('payout_provider_nigeria', 'paystack', 'Payout provider Nigeria'),
  ('payout_provider_international', 'dodopayments', 'Payout provider international'),
  ('announcement_modal_display_mode', 'serial', 'Modal display: serial or random'),
  ('announcement_banner_mode', 'serial', 'Banner display: serial or random'),
  ('admob_app_id', '', 'AdMob App ID'),
  ('admob_banner_unit_id', '', 'AdMob Banner Ad Unit ID'),
  ('admob_interstitial_unit_id', '', 'AdMob Interstitial Ad Unit ID'),
  ('admob_rewarded_unit_id', '', 'AdMob Rewarded Ad Unit ID'),
  ('gif_provider', 'giphy', 'GIF provider: giphy or tenor'),
  ('ai_moderation_system_prompt', '', 'Override AI moderation system prompt'),
  ('referral_qualifying_action', 'coin_purchase', 'Action that qualifies a referral'),
  ('currency_soft_name_singular', 'Credit', 'Singular display name for the earned soft currency (e.g. Credit)'),
  ('currency_soft_name_plural', 'Credits', 'Plural display name for the earned soft currency (e.g. Credits)'),
  ('currency_premium_name_singular', 'Star', 'Singular display name for the purchased premium currency (e.g. Star)'),
  ('currency_premium_name_plural', 'Stars', 'Plural display name for the purchased premium currency (e.g. Stars)'),
  ('deep_link_base_url', 'https://zobia.vercel.app', 'Base URL for deep links'),
  ('feature_moments', 'true', 'Master toggle for the Zobia Moments feature'),
  ('moments_cost_credits', '100', 'Credits charged to post a Moment (0 = not payable with Credits)'),
  ('moments_cost_stars', '1', 'Stars charged to post a Moment (0 = not payable with Stars)'),
  ('moments_min_level', '2', 'Minimum account level (main rank number) required to post a Moment'),
  ('privacy_can_show_online_status', '["pro","max","prestige_1"]', 'Plans/prestige tiers allowed to toggle "show my online status" in privacy settings'),
  ('feature_forum', 'true', 'Master toggle for Answers (mini forum / Q&A)'),
  ('forum_min_level_to_post', '2', 'Minimum account level required to post a question'),
  ('forum_min_level_to_comment', '1', 'Minimum account level required to answer/comment for free'),
  ('forum_comment_bypass_cost_credits', '1', 'Credits charged to comment when below the comment level gate'),
  ('forum_reward_xp_per_question', '10', 'XP awarded for posting a question'),
  ('forum_reward_credits_per_question', '0', 'Credits awarded for posting a question'),
  ('forum_reward_xp_per_answer', '5', 'XP awarded for posting an answer'),
  ('forum_reward_credits_per_answer', '0', 'Credits awarded for posting an answer'),
  ('forum_reward_xp_per_upvote', '1', 'XP awarded to a content author per upvote received'),
  ('forum_reward_credits_per_upvote', '0', 'Credits awarded to a content author per upvote received'),
  ('forum_reward_xp_best_answer', '25', 'XP awarded when an answer is marked best'),
  ('forum_reward_credits_best_answer', '10', 'Credits awarded when an answer is marked best'),
  ('forum_daily_reward_cap_credits', '50', 'Max forum-sourced credit rewards a single user can earn per rolling 24h'),
  ('forum_auto_moderation_enabled', 'true', 'Run profanity/duplicate auto-moderation on new questions and answers'),
  ('feature_profile_stats', 'true', 'Master toggle for the User Profile Stats page'),
  ('profile_stats_full_plans', '["plus","pro","max"]', 'Plans/prestige tiers that get the Full Stats page; everyone else gets the Basic Stats page'),
  ('save_slots_free', '0', 'Save slots for Free plan users (in-progress game saves).'),
  ('save_slots_plus', '1', 'Save slots for Plus plan users.'),
  ('save_slots_pro', '3', 'Save slots for Pro plan users.'),
  ('save_slots_max', '5', 'Save slots for Max plan users.'),
  ('grace_period_days_plus', '7', 'Grace period (days) after a Plus subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_pro', '14', 'Grace period (days) after a Pro subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_max', '30', 'Grace period (days) after a Max subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_business_starter', '7', 'Grace period (days) after a Business Starter subscription lapses.'),
  ('grace_period_days_business_growth', '14', 'Grace period (days) after a Business Growth subscription lapses.'),
  ('grace_period_days_business_enterprise', '30', 'Grace period (days) after a Business Enterprise subscription lapses.'),
  ('grace_period_features_plus', '["saved_games"]', 'Grace-gated features preserved during the Plus grace period.'),
  ('grace_period_features_pro', '["saved_games"]', 'Grace-gated features preserved during the Pro grace period.'),
  ('grace_period_features_max', '["saved_games"]', 'Grace-gated features preserved during the Max grace period.'),
  ('grace_period_features_business_starter', '["saved_games"]', 'Grace-gated features preserved during the Business Starter grace period.'),
  ('grace_period_features_business_growth', '["saved_games"]', 'Grace-gated features preserved during the Business Growth grace period.'),
  ('grace_period_features_business_enterprise', '["saved_games"]', 'Grace-gated features preserved during the Business Enterprise grace period.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Subscription plans
-- ---------------------------------------------------------------------------
INSERT INTO subscription_plans (plan, name, "interval", price_kobo, currency, is_active, sort_order) VALUES
  ('plus', 'Plus — Monthly', 'monthly', 50000, 'NGN', true, 10),
  ('pro', 'Pro — Monthly', 'monthly', 150000, 'NGN', true, 20),
  ('max', 'Max — Monthly', 'monthly', 350000, 'NGN', true, 30),
  ('plus', 'Plus — Annual', 'annual', 500000, 'NGN', true, 11),
  ('pro', 'Pro — Annual', 'annual', 1500000, 'NGN', true, 21),
  ('max', 'Max — Annual', 'annual', 3500000, 'NGN', true, 31)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Store items (coin/star packs & cosmetics)
-- ---------------------------------------------------------------------------
INSERT INTO store_items (name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, iap_product_id) VALUES
  ('Starter Pack', NULL, 'coin_pack', 20000, 'NGN', NULL, NULL, 100, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 1, NULL, NULL),
  ('Regular Pack', NULL, 'coin_pack', 50000, 'NGN', NULL, NULL, 350, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 2, NULL, NULL),
  ('Big Pack', NULL, 'coin_pack', 100000, 'NGN', NULL, NULL, 800, NULL, NULL, '+14% BONUS', true, true, false, NULL, NULL, NULL, 3, NULL, NULL),
  ('Baller Pack', NULL, 'coin_pack', 200000, 'NGN', NULL, NULL, 1800, NULL, NULL, '+29% BONUS', false, true, false, NULL, NULL, NULL, 4, NULL, NULL),
  ('Boss Pack', NULL, 'coin_pack', 500000, 'NGN', NULL, NULL, 5000, NULL, NULL, '+67% BONUS', false, true, false, NULL, NULL, NULL, 5, NULL, NULL),
  ('Legend Pack', NULL, 'coin_pack', 1000000, 'NGN', NULL, NULL, 11500, NULL, NULL, '+92% BONUS', false, true, false, NULL, NULL, NULL, 6, NULL, NULL),
  ('Starter Stars', NULL, 'star_pack', 200000, 'NGN', NULL, NULL, NULL, 5, NULL, NULL, false, true, false, NULL, NULL, NULL, 1, NULL, NULL),
  ('Rising Stars', NULL, 'star_pack', 500000, 'NGN', NULL, NULL, NULL, 15, NULL, '+20% BONUS', true, true, false, NULL, NULL, NULL, 2, NULL, NULL),
  ('Star Bundle', NULL, 'star_pack', 1000000, 'NGN', NULL, NULL, NULL, 35, NULL, '+40% BONUS', false, true, false, NULL, NULL, NULL, 3, NULL, NULL),
  ('Mega Stars', NULL, 'star_pack', 2500000, 'NGN', NULL, NULL, NULL, 100, NULL, '+67% BONUS', false, true, false, NULL, NULL, NULL, 4, NULL, NULL),
  ('Prestige Flame Frame', 'Animated flame frame for Prestige users.', 'cosmetic', NULL, 'NGN', NULL, 5, NULL, NULL, 'profile_frame', NULL, true, true, true, NULL, NULL, NULL, 10, NULL, NULL),
  ('Golden Galaxy Frame', 'Rare animated gold particles around the avatar.', 'cosmetic', NULL, 'NGN', NULL, 10, NULL, NULL, 'profile_frame', NULL, false, true, true, NULL, NULL, NULL, 11, NULL, NULL),
  ('Phoenix Wings Border', 'Animated phoenix wings for Prestige holders.', 'cosmetic', NULL, 'NGN', NULL, 15, NULL, NULL, 'profile_frame', NULL, false, true, true, NULL, NULL, NULL, 12, NULL, NULL),
  ('Diamond Glow Border', 'Pulsing diamond border animation.', 'cosmetic', NULL, 'NGN', NULL, 3, NULL, NULL, 'avatar_border', NULL, true, true, false, NULL, NULL, NULL, 20, NULL, NULL),
  ('Neon Lagos Border', 'Neon-lit Lagos skyline avatar border.', 'cosmetic', NULL, 'NGN', NULL, 5, NULL, NULL, 'avatar_border', NULL, false, true, false, NULL, NULL, NULL, 21, NULL, NULL),
  ('First in the City', 'Display "First in the City" beneath your name.', 'cosmetic', NULL, 'NGN', NULL, 8, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 30, NULL, NULL),
  ('War Machine', 'Title for winning 10 Guild Wars.', 'cosmetic', NULL, 'NGN', NULL, 12, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 31, NULL, NULL),
  ('The Patron', 'Top Gifter in 3+ Rooms — exclusive title.', 'cosmetic', NULL, 'NGN', NULL, 10, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 32, NULL, NULL),
  ('Zobia Confetti Burst', 'Animated confetti when you send a message.', 'cosmetic', NULL, 'NGN', NULL, 2, NULL, NULL, 'animated_item', NULL, true, true, false, NULL, NULL, NULL, 40, NULL, NULL),
  ('Gold Coin Rain', 'Gold coin shower on profile card.', 'cosmetic', NULL, 'NGN', NULL, 7, NULL, NULL, 'animated_item', NULL, false, true, false, NULL, NULL, NULL, 41, NULL, NULL),
  ('Premium Send', 'Premium animation on your next message.', 'booster', NULL, 'NGN', 50, NULL, NULL, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 90, '{"subtype": "premium_send", "animation": "gold_shimmer", "duration_type": "one_shot"}', NULL),
  ('Premium Send — 7 Day Pass', 'Premium Send for 7 days.', 'booster', NULL, 'NGN', 250, NULL, NULL, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 91, '{"subtype": "premium_send", "animation": "gold_shimmer", "duration_days": 7, "duration_type": "subscription"}', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Gift catalog
-- ---------------------------------------------------------------------------
INSERT INTO gift_items (name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active) VALUES
  ('Flower', '🌸', 5, 1, NULL, NULL, false, NULL, false, true),
  ('Cold One', '🍺', 10, 1, NULL, NULL, false, NULL, false, true),
  ('Respect', '🤝', 15, 1, NULL, NULL, false, NULL, false, true),
  ('Fire', '🔥', 25, 1, NULL, NULL, false, NULL, false, true),
  ('Big Brain', '🧠', 40, 1, NULL, NULL, false, NULL, false, true),
  ('Trophy', '🏆', 80, 2, 150, NULL, false, NULL, false, true),
  ('Diamond', '💎', 150, 2, 150, NULL, false, NULL, false, true),
  ('Crown', '👑', 300, 2, 150, NULL, false, NULL, false, true),
  ('Rocket', '🚀', 400, 2, 150, NULL, false, NULL, false, true),
  ('Lion', '🦁', 500, 2, 150, NULL, false, NULL, false, true),
  ('Money Bag', '💰', 800, 3, 800, NULL, false, NULL, false, true),
  ('City Night', '🌃', 1500, 3, 800, NULL, false, NULL, false, true),
  ('Stadium Roar', '🏟️', 2000, 3, 800, NULL, false, NULL, false, true),
  ('Legendary Crown', '✨', 5000, 3, 800, NULL, false, NULL, false, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cultural / seasonal platform events calendar
-- ---------------------------------------------------------------------------
INSERT INTO platform_events (name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_by) VALUES
  ('Nigerian Independence Day Double XP', 'Full-platform double XP on Oct 1st', 'cultural', 2.0, 0, '2025-10-01 00:00:00+00', '2025-10-01 23:59:59+00', true, NULL, true, 10, 1, 10, 1, '{"city_filter": null}', NULL),
  ('Detty December Season', 'The biggest season of the year', 'cultural', 1.5, 0, '2025-12-01 00:00:00+00', '2025-12-31 23:59:59+00', true, NULL, true, 12, 1, 12, 31, '{"city_filter": null}', NULL),
  ('Valentine Gift Weekend', 'Double XP for gifts sent', 'cultural', 1.0, 0, '2026-02-13 00:00:00+00', '2026-02-15 23:59:59+00', true, NULL, true, 2, 13, 2, 15, '{"gift_xp_multiplier": 2}', NULL),
  ('Easter Celebration Weekend', 'Double gift XP across the platform', 'cultural', 1.0, 0, '2026-04-03 00:00:00+00', '2026-04-05 23:59:59+00', true, NULL, true, 4, 3, 4, 5, '{"gift_xp_multiplier": 2}', NULL),
  ('Africa Freedom Day', 'Pan-African double XP on May 25th', 'cultural', 2.0, 0, '2026-05-25 00:00:00+00', '2026-05-25 23:59:59+00', true, NULL, true, 5, 25, 5, 25, '{"city_filter": null}', NULL),
  ('Labour Day Boost', '1.5x XP on International Workers Day', 'cultural', 1.5, 0, '2026-05-01 00:00:00+00', '2026-05-01 23:59:59+00', true, NULL, true, 5, 1, 5, 1, '{"city_filter": null}', NULL),
  ('African Union Day', 'Cross-continent guild alliance bonus weekend', 'cultural', 1.5, 0, '2026-07-10 00:00:00+00', '2026-07-12 23:59:59+00', true, NULL, true, 7, 10, 7, 12, '{"alliance_bonus": true}', NULL),
  ('Eid al-Adha Celebration', 'Double gifting XP during the feast', 'cultural', 1.0, 0, '2026-06-06 00:00:00+00', '2026-06-08 23:59:59+00', true, NULL, true, 6, 6, 6, 8, '{"gift_xp_multiplier": 2}', NULL),
  ('Eid al-Fitr Celebration', 'Community gifting bonus at end of Ramadan', 'cultural', 1.0, 0, '2026-03-30 00:00:00+00', '2026-03-31 23:59:59+00', true, NULL, true, 3, 30, 3, 31, '{"gift_xp_multiplier": 2}', NULL),
  ('Black History Month', 'All-February 1.25x XP', 'cultural', 1.3, 0, '2026-02-01 00:00:00+00', '2026-02-28 23:59:59+00', true, NULL, true, 2, 1, 2, 28, '{"city_filter": null}', NULL),
  ('Kwanzaa Week', 'Community and culture XP boost Dec 26-Jan 1', 'cultural', 1.5, 0, '2026-12-26 00:00:00+00', '2027-01-01 23:59:59+00', true, NULL, true, 12, 26, 1, 1, '{"city_filter": null}', NULL),
  ('New Year Countdown', 'Triple XP in the final hour of the year', 'cultural', 3.0, 0, '2026-12-31 23:00:00+00', '2027-01-01 00:59:59+00', true, NULL, true, 12, 31, 1, 1, '{"city_filter": null}', NULL),
  ('New Year Hustle Season', 'Bonus XP for the first week of the year', 'cultural', 1.5, 0, '2026-01-01 01:00:00+00', '2026-01-07 23:59:59+00', true, NULL, true, 1, 1, 1, 7, '{"badge": "new_year_hustle_2026", "city_filter": null}', NULL),
  ('AFCON Season', 'Africa Cup of Nations — 1.5x competitor XP', 'cultural', 1.5, 0, '2026-01-10 00:00:00+00', '2026-02-28 23:59:59+00', true, NULL, false, NULL, NULL, NULL, NULL, '{"tracks": ["competitor"], "guild_war_points_multiplier": 1.5}', NULL),
  ('International Women''s Month — Creator Boost Week', 'Female creators earn 1.5x XP in first week of March', 'cultural', 1.5, 0, '2026-03-01 00:00:00+00', '2026-03-07 23:59:59+00', true, NULL, true, 3, 1, 3, 7, '{"boost_tracks": ["creator", "social"], "female_creator_only": true}', NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Daily quest templates
-- ---------------------------------------------------------------------------
INSERT INTO quest_templates (title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active) VALUES
  ('Message Marathon', 'Send 10 messages today', 'messages', 10, 100, 10, 'social', 'free', 'social', '💬', NULL, true),
  ('Room Explorer', 'Join a Room you haven''t visited before', 'room_join', 1, 150, 0, 'explorer', 'free', 'explorer', '🚪', NULL, true),
  ('Be Generous', 'Gift any user today', 'gift', 1, 50, 5, 'generosity', 'free', 'generosity', '🎁', NULL, true),
  ('Streak Keeper', 'Log in for 7 consecutive days', 'login_streak', 7, 200, 50, 'main', 'free', 'general', '⭐', NULL, true),
  ('Guild Quest', 'Complete a Guild Quest contribution', 'guild_quest', 1, 200, 0, 'competitor', 'free', 'general', '⭐', NULL, true),
  ('XP Grinder', 'Earn 500 XP today', 'xp_meta', 500, 100, 20, 'main', 'free', 'general', '⭐', NULL, true),
  ('Social Butterfly', 'Send 25 messages today', 'messages', 25, 200, 20, 'social', 'plus', 'social', '💬', NULL, true),
  ('Room Master', 'Visit 3 different Rooms today', 'room_join', 3, 300, 30, 'explorer', 'pro', 'explorer', '🚪', NULL, true),
  ('Super Gifter', 'Send 3 gifts today', 'gift', 3, 150, 15, 'generosity', 'pro', 'generosity', '🎁', NULL, true),
  ('XP Champion', 'Earn 2000 XP today', 'xp_meta', 2000, 300, 50, 'main', 'max', 'general', '⭐', NULL, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Games-played milestones (gaming track)
-- ---------------------------------------------------------------------------
INSERT INTO game_play_milestones (games_played_threshold, reward_credits, reward_xp, reward_stars, is_active) VALUES
  (10, 100, 200, 0, true),
  (50, 500, 600, 1, true),
  (100, 1200, 1500, 3, true),
  (500, 6000, 8000, 10, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Games catalog
-- ---------------------------------------------------------------------------
INSERT INTO games (slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES
  ('tetris', 'Zobia Tetris', 'Stack, clear, survive.', 'Classic falling-blocks puzzle. Clear lines to score.', NULL, '🧩', NULL, true, true, 0, NULL, 'Puzzle', 'The timeless falling-blocks puzzle. Rotate and drop tetrominoes to complete horizontal lines. The more lines you clear at once, the bigger the score. How long can you last as the blocks speed up?', 'tetris', 1, 50, 40, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('2048', '2048', 'Merge to the magic number.', 'Slide tiles and merge matching numbers to reach 2048.', NULL, '🔢', NULL, true, true, 0, NULL, 'Puzzle', 'Slide numbered tiles on a grid; when two tiles with the same number touch they merge into one. Combine them to reach the 2048 tile — and keep going for a high score.', 'g2048', 2, 50, 40, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('car-racing', 'Speed Dodge', 'Weave through traffic.', 'Dodge oncoming cars and survive as long as you can.', NULL, '🏎️', NULL, true, true, 0, NULL, 'Action', 'A fast lane-dodging racer. Steer left and right to weave through endless oncoming traffic. The longer you survive and the faster you go, the higher your score.', 'carRacing', 1, 60, 50, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('space-shooter', 'Star Blaster', 'Blast the asteroid field.', 'Pilot a ship and shoot down waves of asteroids.', NULL, '🚀', NULL, true, true, 0, NULL, 'Action', 'An arcade space shooter. Pilot your ship through an endless asteroid field, blasting rocks and dodging debris. Chain kills to rack up a high score.', 'spaceShooter', 2, 60, 50, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('snake', 'Zobia Snake', 'Eat, grow, do not bite yourself.', 'Guide the snake to eat and grow without crashing.', NULL, '🐍', NULL, true, true, 0, NULL, 'Arcade', 'The classic snake game. Guide your ever-growing snake to eat food while avoiding the walls and your own tail. Each bite makes you longer — and the game harder.', 'snake', 1, 40, 35, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('breakout', 'Brick Buster', 'Smash every brick.', 'Bounce the ball to break all the bricks.', NULL, '🧱', NULL, true, true, 0, NULL, 'Arcade', 'A brick-breaking arcade classic. Move the paddle to bounce the ball and smash every brick on the screen. Do not let the ball fall — clear the board for the highest score.', 'breakout', 2, 40, 35, 0, 0, 0, 9999999, 5, 0.00, 0, 0),
  ('tap-frenzy', 'Tap Frenzy', 'How fast can you tap?', 'Tap the screen as fast as you can before time runs out.', NULL, '👆', NULL, true, true, 0, NULL, 'Tap', 'Pure speed — tap as many times as you can in 15 seconds. Track your record, challenge your friends, and see who has the fastest fingers on Zobia.', 'tapFrenzy', 1, 30, 25, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('bubble-burst', 'Bubble Burst', 'Pop before they escape!', 'Tap coloured bubbles before they float off the screen.', NULL, '🫧', NULL, true, true, 0, NULL, 'Tap', 'Coloured bubbles rise from below. Tap them to pop them before they escape off the top! Miss too many and it is game over. The bubbles get faster and faster — how long can you keep up?', 'bubbleBurst', 2, 35, 28, 0, 0, 0, 9999999, 10, 0.00, 0, 0),
  ('reaction-rush', 'Reaction Rush', 'Tap the moment you see green!', 'Test your reaction time — tap as soon as the target turns green.', NULL, '⚡', NULL, true, true, 0, NULL, 'Tap', 'A pure reaction-time test. Wait for the circle to flash green and tap as fast as you can. Your reaction time is measured in milliseconds. The average human takes 250 ms — can you beat that?', 'reactionRush', 3, 30, 25, 0, 0, 0, 9999, 5, 0.00, 0, 0),
  ('color-tap', 'Color Tap', 'Tap only the right colour!', 'Tap the matching colour tile as fast as possible.', NULL, '🎨', NULL, true, true, 0, NULL, 'Tap', 'A colour — name is shown at the top. Tap the tile that matches the colour shown, not the colour of the text. Simple to understand, surprisingly tricky to execute fast. How many correct taps before you slip up?', 'colorTap', 4, 35, 28, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('flappy-duck', 'Flappy Duck', 'Flap through the pipes!', 'Tap to flap your wings and weave through pipe gaps.', NULL, '🦆', NULL, true, true, 0, NULL, 'Arcade', 'Guide your cheerful duck through an endless series of pipe gaps. Tap to flap — let go and you fall. Time your taps perfectly to thread each gap. One touch of the pipes and it is all over.', 'flappyDuck', 3, 50, 40, 0, 0, 0, 9999, 5, 0.00, 0, 0),
  ('stack-tower', 'Stack Tower', 'Drop, stack, keep going!', 'Drop falling blocks and stack them as high as you can.', NULL, '🏗️', NULL, true, true, 0, NULL, 'Arcade', 'A block swings back and forth on a platform. Tap to drop it and land it on the stack below. The more accurately you land it, the bigger the block stays. Miss and it shrinks. How high can you build before the block vanishes entirely?', 'stackTower', 4, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('cookie-kingdom', 'Cookie Kingdom', 'Click. Bake. Rule.', 'Click to bake cookies and buy upgrades for your kingdom.', NULL, '🍪', NULL, true, true, 0, NULL, 'Idle', 'Start with a single click to bake a cookie. Earn enough to buy bakeries, farms, factories and eventually entire cookie empires. Watch your cookies multiply while you are busy doing other things — the idle life is sweet.', 'cookieKingdom', 1, 40, 35, 0, 0, 0, 9999999999, 20, 0.00, 0, 0),
  ('galaxy-miner', 'Galaxy Miner', 'Mine the cosmos!', 'Tap to mine space rocks and upgrade your fleet.', NULL, '⛏️', NULL, true, true, 0, NULL, 'Idle', 'Tap asteroids to extract precious minerals. Spend your haul on mining drones, laser rigs and warp drives that mine for you automatically. Build your galactic empire one asteroid at a time.', 'galaxyMiner', 2, 40, 35, 0, 0, 0, 9999999999, 20, 0.00, 0, 0),
  ('memory-match', 'Memory Match', 'Find every pair!', 'Flip cards to reveal matching pairs.', NULL, '🃏', NULL, true, true, 0, NULL, 'Puzzle', 'A grid of face-down cards is shuffled. Flip two at a time — if they match, they stay face up; if not, they flip back. Clear the board in as few moves as possible. Your score is based on speed and how few mismatches you make.', 'memoryMatch', 3, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('slide-puzzle', 'Slide Puzzle', 'Slide the tiles into order!', 'Rearrange the numbered tiles to put them in order.', NULL, '🔢', NULL, true, true, 0, NULL, 'Puzzle', 'A classic 4×4 sliding puzzle. Slide the numbered tiles through the single empty space to arrange them in order from 1–15. Minimal moves, minimal time — the best solvers complete it in seconds.', 'slidePuzzle', 4, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('minesweeper', 'Minesweeper', 'Avoid the mines!', 'Reveal the grid but do not hit any hidden mines.', NULL, '💣', NULL, true, true, 0, NULL, 'Puzzle', 'Reveal the grid square by square using the number clues — each number tells you how many mines touch that square. Flag the mines and clear everything else to win. One wrong click and it is over.', 'minesweeper', 5, 50, 40, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('color-sort', 'Color Sort', 'Sort the colours into their tubes!', 'Move coloured balls to fill each tube with one colour.', NULL, '🎨', NULL, true, true, 0, NULL, 'Puzzle', 'Test tubes contain a mixed jumble of coloured balls. Move balls between tubes (only onto matching colours or into empty tubes) until every tube holds one pure colour. Each solved level reveals a harder arrangement.', 'colorSort', 6, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('blackjack', 'Blackjack', 'Beat the dealer to 21!', 'Play classic Blackjack against the AI dealer.', NULL, '🃏', NULL, true, true, 0, NULL, 'Card', 'The classic casino card game. Try to build a hand closer to 21 than the dealer without going bust. Hit, stand, or double down — make the right call at the right moment and rake in the chips.', 'blackjack', 1, 55, 45, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('whot', 'Whot!', 'Play your cards right!', 'Play the popular African card game against the AI.', NULL, '🎴', NULL, true, true, 0, NULL, 'Card', 'The beloved West African card game. Match cards by number or suit, play special action cards, and race to clear your hand before the AI beats you. Calls of "Whot!" are the sweetest sound on the table.', 'whot', 2, 55, 45, 0, 0, 0, 9999, 15, 0.00, 0, 0),
  ('higher-or-lower', 'Higher or Lower', 'Is the next card higher or lower?', 'Guess whether the next playing card will be higher or lower.', NULL, '🎴', NULL, true, true, 0, NULL, 'Card', 'A card is revealed. Guess whether the next card will be higher or lower. Get it right and keep your streak going. One wrong guess ends the run. Cards do not repeat — use your memory!', 'higherOrLower', 3, 35, 28, 0, 0, 0, 9999, 5, 0.00, 0, 0),
  ('chess', 'Chess', 'The classic game of kings.', 'Play Chess against the AI at your own pace.', NULL, '♟️', NULL, true, true, 0, NULL, 'Board', 'The timeless game of strategy and tactics. Play against the AI — choose Easy for a relaxed game or Hard for a genuine challenge. Capture the opponent''s king to win.', 'chess', 1, 70, 60, 1, 0, 0, 9999, 30, 0.00, 0, 0),
  ('ludo', 'Ludo', 'Race your pieces home!', 'Play Ludo against AI opponents — roll dice and race home.', NULL, '🎲', NULL, true, true, 0, NULL, 'Board', 'The classic race board game. Roll the dice and race all four of your pieces from start to home base before your AI opponents do. Land on an opponent''s piece to send it back to the start!', 'ludo', 2, 65, 55, 0, 0, 0, 9999, 30, 0.00, 0, 0),
  ('word-scramble', 'Word Scramble', 'Unscramble the letters!', 'Unscramble jumbled letters to spell the hidden word.', NULL, '🔤', NULL, true, true, 0, NULL, 'Word', 'A word appears with all its letters scrambled. Rearrange them to reveal the correct word before the timer runs out. Five words per round — the faster and more accurately you solve them, the higher your score.', 'wordScramble', 1, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('simon-says', 'Simon Says', 'Remember the sequence!', 'Watch the colour pattern and repeat it back.', NULL, '🌈', NULL, true, true, 0, NULL, 'Word', 'A sequence of coloured tiles lights up. Watch carefully, then repeat the pattern in the same order. Each successful round adds one more step to the sequence. How far can your memory take you?', 'simonSays', 2, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('rock-paper-scissors', 'Rock Paper Scissors', 'Best of 5 vs the AI!', 'Play Rock Paper Scissors in rapid best-of-5 rounds.', NULL, '✊', NULL, true, true, 0, NULL, 'Casual', 'You already know the rules. Play fast best-of-5 rounds against the AI. The AI has a subtle pattern — can you crack it and outsmart the machine? First to 3 wins takes the match.', 'rockPaperScissors', 1, 30, 25, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('sudoku', 'Sudoku', 'Fill every row, column and box!', 'Classic 9×9 Sudoku. Place the digits 1–9 so every row, column, and 3×3 box holds each digit exactly once.', NULL, '🔢', NULL, true, true, 0, NULL, 'Puzzle', 'The world''s most popular logic puzzle, now on Zobia. Three difficulty levels — Easy for a relaxed solve, Hard for a real brain workout. Your score is based on how fast you complete the puzzle.', 'sudoku', 7, 50, 40, 0, 0, 0, 1000, 30, 0.00, 0, 0),
  ('word-search', 'Word Search', 'Find every hidden word!', 'Scan the letter grid horizontally, vertically and diagonally to find all the hidden words.', NULL, '🔍', NULL, true, true, 0, NULL, 'Puzzle', 'A grid packed with hidden words in every direction. Spot them all to clear the board. Words get longer and grids bigger as difficulty increases — can you find every word before time runs out?', 'wordSearch', 8, 45, 38, 0, 0, 0, 2000, 20, 0.00, 0, 0),
  ('lights-out', 'Lights Out', 'Toggle the lights — turn them all off!', 'Click a cell to toggle it and its neighbours. Your goal: turn every light OFF.', NULL, '💡', NULL, true, true, 0, NULL, 'Puzzle', 'A deceptively simple puzzle. Each click toggles the clicked cell plus its orthogonal neighbours. Start from a scrambled state and work out which toggles to press to switch off every last light.', 'lightsOut', 9, 45, 38, 0, 0, 0, 500, 10, 0.00, 0, 0),
  ('number-match', 'Number Match', 'Clear pairs that sum to 10!', 'Tap two numbers that are equal or sum to 10 to remove them from the grid.', NULL, '🔟', NULL, true, true, 0, NULL, 'Puzzle', 'A satisfying number clearing game. Match adjacent numbers — or numbers in the same row or column with nothing between them — that are equal or add up to 10. Clear the board to win!', 'numberMatch', 10, 40, 35, 0, 0, 0, 9999, 15, 0.00, 0, 0),
  ('nonogram', 'Nonogram', 'Fill the grid from the number clues!', 'Use the row and column number clues to figure out which cells to fill in.', NULL, '🖼️', NULL, true, true, 0, NULL, 'Puzzle', 'Also known as Picross or Hanjie — a pixel-art logic puzzle. The numbers tell you how many consecutive filled cells appear in each row and column. Deduce the pattern and reveal the hidden picture.', 'nonogram', 11, 50, 42, 0, 0, 0, 500, 20, 0.00, 0, 0),
  ('pipe-connect', 'Pipe Connect', 'Connect all the pipe endpoints!', 'Draw pipes between matching colour endpoints so every cell is covered.', NULL, '🔧', NULL, true, true, 0, NULL, 'Puzzle', 'Flow-free style pipe puzzle. Connect each pair of same-coloured endpoints with a continuous pipe, and fill every single cell on the grid. Pipes cannot cross. Think ahead — it gets fiendishly tricky!', 'pipeConnect', 12, 50, 42, 0, 0, 0, 500, 20, 0.00, 0, 0),
  ('sliding-blocks', 'Sliding Blocks', 'Slide the red block to the exit!', 'Slide coloured blocks to clear a path for the red block to escape.', NULL, '🧩', NULL, true, true, 0, NULL, 'Puzzle', 'Inspired by the classic Rush Hour puzzle. A grid of blocks — some horizontal, some vertical — sit between your red block and the exit. Slide them out of the way, one by one, until the red block can slide free.', 'slidingBlocks', 13, 50, 42, 0, 0, 0, 500, 15, 0.00, 0, 0),
  ('mahjong', 'Mahjong Solitaire', 'Match and clear all the tiles!', 'Tap matching free tiles to remove them from the board.', NULL, '🀄', NULL, true, true, 0, NULL, 'Puzzle', 'The beloved tile-matching solitaire. Tap two identical free tiles (not covered and with at least one open side) to remove them. Clear the entire pyramid to win. Strategy matters — remove tiles in the right order!', 'mahjongSolitaire', 14, 55, 45, 0, 0, 0, 5000, 20, 0.00, 0, 0),
  ('whack-a-mole', 'Whack-a-Mole', 'Bonk the moles before they hide!', 'Tap moles the instant they pop up from their holes.', NULL, '🔨', NULL, true, true, 0, NULL, 'Action', 'Classic reaction game. Moles pop up from 9 holes at random intervals — tap them before they duck back underground! Miss too many and your score suffers. The moles get sneakier on harder difficulties.', 'whackAMole', 3, 40, 35, 0, 0, 0, 9999, 20, 0.00, 0, 0),
  ('fruit-slicer', 'Fruit Slicer', 'Slice the fruit, dodge the bombs!', 'Swipe across falling fruit to slice it, but avoid the bombs.', NULL, '🍎', NULL, true, true, 0, NULL, 'Action', 'Fruit falls from the sky — drag your finger across the screen to slice through it and rack up points. But watch out for bombs mixed in on higher difficulties! One wrong swipe and your game is over.', 'fruitSlicer', 4, 45, 38, 0, 0, 0, 9999, 20, 0.00, 0, 0),
  ('ayo', 'Ayo', 'The classic West African strategy game!', 'Play Ayo — the traditional Nigerian mancala board game — against the AI.', NULL, '🏺', NULL, true, true, 0, NULL, 'Board', 'Ayo (Oware) is one of Africa''s oldest and most beloved board games. Two rows of six pits, 48 seeds. Pick up all the seeds from a pit and sow them counter-clockwise, one per pit. Capture seeds when your last drop lands in an opponent''s pit with exactly 2 or 3 seeds. First to 25 seeds wins!', 'ayo', 3, 70, 60, 1, 0, 0, 48, 60, 0.00, 0, 0),
  ('platform-jumper', 'Platform Jumper', 'Jump from platform to platform!', 'Guide your character up an endless series of platforms — how high can you go?', NULL, '🦘', NULL, true, true, 0, NULL, 'Arcade', 'Your bouncy character leaps automatically — tap left or right to steer and land on each platform. Miss a platform and you fall to your doom. The higher you climb, the narrower the platforms get. Can you reach the stars?', 'platformJumper', 5, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0),
  ('pixel-runner', 'Pixel Runner', 'Run and jump over everything!', 'Tap to jump over obstacles in this non-stop side-scrolling runner.', NULL, '🏃', NULL, true, true, 0, NULL, 'Arcade', 'Your pixel hero runs forever — tap to jump over walls, spikes and pits that appear in the path. The longer you survive, the faster the pace. One collision and it is all over. How far can you run?', 'pixelRunner', 6, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0),
  ('asteroid-dodge', 'Asteroid Dodge', 'Dodge the space rocks!', 'Steer your spaceship left and right to dodge incoming asteroids.', NULL, '☄️', NULL, true, true, 0, NULL, 'Arcade', 'Your rocket is hurtling through a dense asteroid field. Tap left or right to dodge the rocks — some small, some massive, some moving at terrifying speed. Every second you survive earns points. One collision and you are space dust.', 'asteroidDodge', 7, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0),
  ('speed-tap', 'Speed Tap', 'Tap targets the instant they appear!', 'React lightning fast — targets shrink and disappear if you miss them.', NULL, '🎯', NULL, true, true, 0, NULL, 'Tap', 'Bright targets flash up on screen and start shrinking. Tap them before they vanish completely! Every hit scores points; every miss deducts them. The targets get smaller and faster on harder settings. How sharp is your reflex?', 'speedTap', 5, 35, 28, 0, 0, 0, 9999, 20, 0.00, 0, 0),
  ('color-rain', 'Color Rain', 'Tap the drops that match your colour!', 'Coloured drops fall — tap only those matching the target colour shown.', NULL, '🌈', NULL, true, true, 0, NULL, 'Tap', 'Drops of four colours rain down the screen. A target colour glows at the top. Tap every drop that matches — and avoid the wrong colours! The rain gets heavier and faster. Stay sharp and keep your score climbing.', 'colorRain', 6, 35, 28, 0, 0, 0, 9999, 20, 0.00, 0, 0),
  ('quick-quiz', 'Quick Quiz', 'How much do you know?', '10 general-knowledge questions — score big by answering fast.', NULL, '🧠', NULL, true, true, 0, NULL, 'Trivia', 'Ten questions, ten chances to prove your knowledge. Pick the right answer from four choices as fast as you can — the quicker you answer correctly, the bigger the time bonus. Wrong answers score zero. Think you know everything? Prove it!', 'quickQuiz', 1, 60, 50, 0, 0, 0, 1750, 30, 0.00, 0, 0),
  ('true-or-false', 'True or False', 'Is it fact or fiction?', 'Rapid-fire true/false statements — answer as many as you can correctly.', NULL, '✅', NULL, true, true, 0, NULL, 'Trivia', 'A bold statement appears on screen. True or false — decide fast! The timer ticks down and every correct answer bangs up your score. Wrong answers cost you nothing but time. Simple to play, surprisingly addictive to master.', 'trueOrFalse', 2, 50, 42, 0, 0, 0, 1125, 20, 0.00, 0, 0),
  ('emoji-quiz', 'Emoji Quiz', 'Guess the word from emojis!', 'Figure out the movie, phrase or word hidden in a sequence of emojis.', NULL, '😎', NULL, true, true, 0, NULL, 'Trivia', 'A cryptic combination of emojis hides a movie title, phrase or concept. Decode the emoji clue and type your answer. Easy puzzles are obvious, hard ones will have you scratching your head. Think you speak emoji fluently?', 'emojiQuiz', 3, 60, 50, 0, 0, 0, 1400, 30, 0.00, 0, 0),
  ('flag-quiz', 'Flag Quiz', 'Which country is that flag?', 'Identify countries from their flag — pick from four options.', NULL, '🚩', NULL, true, true, 0, NULL, 'Trivia', 'A country flag flashes up — can you name it from four choices? Starts with well-known flags and gets tricky on harder settings. Great for travel lovers, geography buffs, and anyone who wants to learn the world one flag at a time.', 'flagQuiz', 4, 50, 42, 0, 0, 0, 750, 15, 0.00, 0, 0),
  ('word-guess', 'Word Guess', 'Guess the 5-letter word in 6 tries!', 'Wordle-style word guessing. Green = right place, yellow = wrong place.', NULL, '💬', NULL, true, true, 0, NULL, 'Word', 'One secret 5-letter word. Six attempts to find it. Every guess tells you which letters are correct and in the right spot (green), which are in the word but misplaced (yellow), and which aren''t in the word at all (grey). Pure vocabulary meets deduction.', 'wordGuess', 3, 55, 45, 0, 0, 0, 600, 15, 0.00, 0, 0),
  ('hangman', 'Hangman', 'Guess the word before the man is hanged!', 'Pick letters one by one to reveal the hidden word before you run out of chances.', NULL, '🎭', NULL, true, true, 0, NULL, 'Word', 'A hidden word waits behind a row of blank spaces. Guess letters — correct ones fill in the blanks; wrong ones bring the stick figure closer to doom. Run out of guesses and it is game over. Can you read the word before you run out of chances?', 'hangman', 4, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0),
  ('anagram-rush', 'Anagram Rush', 'Unscramble the letters against the clock!', 'Scrambled letters — rearrange them to spell the correct word.', NULL, '🔀', NULL, true, true, 0, NULL, 'Word', 'A word has been scrambled into a jumble of letters. Your mission: unscramble them to spell the original word before time runs out. Ten words per round, each harder than the last. How many can you solve under pressure?', 'anagramRush', 5, 50, 42, 0, 0, 0, 1000, 20, 0.00, 0, 0),
  ('tic-tac-toe', 'Tic Tac Toe', 'Get three in a row first!', 'Play classic Tic Tac Toe against an AI opponent.', NULL, '⭕', NULL, true, true, 0, NULL, 'Casual', 'The timeless 3×3 grid game. You are X, the AI is O. Get three of your marks in a row — horizontal, vertical or diagonal — before the AI does. On Hard mode the AI is completely unbeatable. On Easy it makes mistakes. Good luck!', 'ticTacToe', 2, 30, 25, 0, 0, 0, 300, 10, 0.00, 0, 0),
  ('connect-four', 'Connect Four', 'Drop four in a row!', 'Drop discs to connect four of your colour in a row.', NULL, '🔴', NULL, true, true, 0, NULL, 'Casual', 'Drop red discs into the 7×6 grid. Gravity does the rest. Get four in a row — horizontally, vertically or diagonally — before the yellow AI does. Simple rules but deep strategy. Easy AI makes blunders; Hard AI does not.', 'connectFour', 3, 40, 35, 0, 0, 0, 200, 15, 0.00, 0, 0),
  ('gem-swap', 'Gem Swap', 'Swap gems to match three or more!', 'Swap adjacent gems to make rows or columns of three or more matching gems.', NULL, '💎', NULL, true, true, 0, NULL, 'Strategy', 'A glittering grid of gems. Swap two adjacent gems to line up three or more of the same colour. They disappear, gems fall, and new ones appear. Chain combos earn massive points. 60 seconds on the clock — how high can your score go?', 'gemSwap', 1, 55, 45, 0, 0, 0, 99999, 30, 0.00, 0, 0),
  ('dots-and-boxes', 'Dots & Boxes', 'Draw lines — claim the most boxes!', 'Connect dots to complete boxes. The player with the most boxes wins.', NULL, '📦', NULL, true, true, 0, NULL, 'Strategy', 'A grid of dots. Take turns drawing lines between adjacent dots. Complete a box (four sides) and you claim it and get another turn. The one who claims the most boxes when the grid is full wins. Looks simple — feels like chess!', 'dotsAndBoxes', 2, 50, 42, 0, 0, 0, 1250, 30, 0.00, 0, 0),
  ('penalty-kick', 'Penalty Kick', 'Aim and shoot — score the penalty!', 'Time your aim and power to score past the goalkeeper.', NULL, '⚽', NULL, true, true, 0, NULL, 'Sports', 'Step up to the spot. A cursor sweeps across the goal — tap to lock your aim. Then a power bar charges up — tap again to set your power. The goalkeeper dives. GOAL or SAVE? Five kicks to prove your nerve under pressure.', 'penaltyKick', 1, 55, 45, 0, 0, 0, 500, 15, 0.00, 0, 0),
  ('basketball-shot', 'Basketball Shot', 'Perfect timing is everything!', 'Tap at exactly the right moment to sink the basketball.', NULL, '🏀', NULL, true, true, 0, NULL, 'Sports', 'A basketball swings on an arc over the hoop. Tap when the ball aligns with the basket for the perfect shot. The sweet spot shrinks on harder difficulties and the arc speeds up. 10 shots — can you sink them all?', 'basketballShot', 2, 45, 38, 0, 0, 0, 300, 10, 0.00, 0, 0),
  ('beat-tap', 'Beat Tap', 'Hit the notes on the beat!', 'Tap the correct lane when notes reach the hit zone.', NULL, '🎵', NULL, true, true, 0, NULL, 'Music', 'Four lanes of falling note blocks drop toward the hit zone at the bottom of each lane. Tap the lane button the instant a note arrives. Perfect timing earns maximum points; late or early taps score less. 30 seconds of rhythm action — how high can you score?', 'beatTap', 1, 55, 45, 0, 0, 0, 1350, 20, 0.00, 0, 0)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Answers (mini forum / Q&A) categories
-- ---------------------------------------------------------------------------
INSERT INTO forum_categories (id, slug, name, description, icon_emoji, sort_order) VALUES
  ('00000000-0000-0000-0006-000000000001', 'general', 'General', 'Anything and everything — start here if you''re not sure where else it fits.', '💬', 0),
  ('00000000-0000-0000-0006-000000000002', 'relationships', 'Relationships & Dating', 'Love, friendship, family, and everything in between.', '❤️', 1),
  ('00000000-0000-0000-0006-000000000003', 'money-business', 'Money & Business', 'Side hustles, investing, careers, and building something of your own.', '💰', 2),
  ('00000000-0000-0000-0006-000000000004', 'tech', 'Tech & Gadgets', 'Phones, apps, the internet, and everything digital.', '🖥️', 3),
  ('00000000-0000-0000-0006-000000000005', 'school-career', 'School & Career', 'Studying, exams, job hunting, and figuring out what''s next.', '🎓', 4),
  ('00000000-0000-0000-0006-000000000006', 'entertainment', 'Entertainment & Culture', 'Music, movies, celebrity gist, and pop culture.', '🎵', 5),
  ('00000000-0000-0000-0006-000000000007', 'sports', 'Sports', 'Football, basketball, and everything competitive.', '🏆', 6),
  ('00000000-0000-0000-0006-000000000008', 'health', 'Health & Wellness', 'Fitness, mental health, and taking care of yourself.', '🌱', 7)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sticker packs
-- ---------------------------------------------------------------------------
INSERT INTO sticker_packs (name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, slug) VALUES
  ('Naija Vibes', 'Nigerian cultural expressions', '🇳🇬', NULL, 'free', 0, NULL, NULL, true, 'naija-vibes'),
  ('Flex Pack', 'Show off your style', '💎', NULL, 'earnable', 0, NULL, NULL, true, 'flex-pack'),
  ('Boss Moves', 'Premium reactions', '👑', NULL, 'premium', 150, NULL, NULL, true, 'boss-moves'),
  ('Naija Hausa', 'Northern Nigerian Hausa expressions', '🇳🇬', NULL, 'free', 0, NULL, 'ha', true, 'naija-hausa'),
  ('Yoruba Vibes', 'Yoruba cultural stickers', '🌟', NULL, 'free', 0, NULL, 'yo', true, 'yoruba-vibes'),
  ('Igbo Pride', 'Igbo expressions and culture', '🦁', NULL, 'free', 0, NULL, 'ig', true, 'igbo-pride'),
  ('Swahili Soul', 'East African Swahili stickers', '🌍', NULL, 'free', 0, NULL, 'sw', true, 'swahili-soul'),
  ('Arabic Flow', 'Arabic language expressions', '✨', NULL, 'free', 0, NULL, 'ar', true, 'arabic-flow'),
  ('French Touch', 'Francophone African stickers', '🎭', NULL, 'free', 0, NULL, 'fr', true, 'french-touch'),
  ('Lusophone', 'Portuguese-speaking African stickers', '🌊', NULL, 'free', 0, NULL, 'pt', true, 'lusophone'),
  ('Social Butterfly', 'Unlock at Social Level 5', '🦋', NULL, 'earnable', 0, 'Reach Social Level 5', NULL, true, 'social-butterfly'),
  ('Connector', 'Unlock at Social Level 10', '🔗', NULL, 'earnable', 0, 'Reach Social Level 10', NULL, true, 'connector'),
  ('Influencer Pack', 'Unlock at Social Level 20', '💫', NULL, 'earnable', 0, 'Reach Social Level 20', NULL, true, 'influencer-pack'),
  ('Legend Pack', 'Unlock at Social Level 30', '🏆', NULL, 'earnable', 0, 'Reach Social Level 30', NULL, true, 'legend-pack'),
  ('Prestige Pack', 'Unlock on first Prestige', '👑', NULL, 'earnable', 0, 'Achieve Prestige I', NULL, true, 'prestige-pack'),
  ('Elite Reactions', 'Premium high-energy reactions', '⚡', NULL, 'premium', 100, NULL, NULL, true, 'elite-reactions'),
  ('Luxury Flex', 'Show your premium status', '💎', NULL, 'premium', 250, NULL, NULL, true, 'luxury-flex'),
  ('Zobia Exclusive', 'Ultra-rare exclusive stickers', '🌌', NULL, 'premium', 500, NULL, NULL, true, 'zobia-exclusive')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cron scheduling state
-- ---------------------------------------------------------------------------
INSERT INTO cron_state (key, value_ts, updated_at)
VALUES ('next_mystery_drop_at', NOW() + INTERVAL '3 days', NOW())
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Stickers
-- ---------------------------------------------------------------------------
INSERT INTO stickers (pack_id, name, emoji, "position") SELECT sp.id, 'Naija Pride', '🇳🇬', 1 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, "position") SELECT sp.id, 'Oya Now', '😤', 2 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, "position") SELECT sp.id, 'No Cap', '🙅', 3 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, "position") SELECT sp.id, 'Sapa Mode', '😭', 4 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, "position") SELECT sp.id, 'God Don Butter My Bread', '🙏', 5 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
