-- Zobia Social — final PostgreSQL baseline (2026-10-23)
-- Final schema after the forensic hardening review; previous baseline upgrade is separate.
-- Each table is declared once in its final shape. No historical column
-- alterations, data backfills or intermediate schema states are replayed.
-- Reference data contains only the resulting catalog/configuration rows.
--
-- Fresh database only. Execute with psql -v ON_ERROR_STOP=1 -f this-file.sql,
-- or npm run migrate. Existing installations use the runner's verified
-- baseline adoption; this file never drops or rebuilds application tables.
-- PostgreSQL 16+; required extensions: pgcrypto, uuid-ossp, pg_trgm.
-- pg_stat_statements is optional. No Supabase schemas/functions/roles required.
-- Supabase grants and role-specific RLS policies are installed only for roles
-- already present. Ordinary PostgreSQL uses the owning application DB role.
-- Demo users/content remain separate in db/seed.sql.
-- Do not edit an applied baseline; add a new numbered migration for changes.

BEGIN;
SET LOCAL search_path = public;
SET LOCAL check_function_bodies = false;
SET LOCAL standard_conforming_strings = on;

-- Refuse accidental application over an existing app, including partial installs.
DO $preflight$
BEGIN
 IF EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
     AND c.relname NOT IN ('migrations_log','_test_applied_migrations')
     AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
     AND NOT(c.relkind='S' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_class parent ON parent.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND parent.relnamespace=n.oid AND parent.relname IN ('migrations_log','_test_applied_migrations')))
 ) THEN RAISE EXCEPTION 'The consolidated baseline requires an empty application schema. Use the migration runner to adopt an already-current database; never reset existing data to apply this file.';
 END IF;
END
$preflight$;


-- Required PostgreSQL extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Resolve stock extension objects from their actual existing namespaces.
-- Managed providers may already keep these in a separate extension schema.
DO $extension_path$
DECLARE namespaces text;
BEGIN
 SELECT string_agg(quote_ident(name), ', ' ORDER BY name) INTO namespaces
 FROM (SELECT DISTINCT n.nspname AS name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
       WHERE e.extname IN ('pgcrypto','uuid-ossp','pg_trgm') AND n.nspname<>'public') locations;
 PERFORM set_config('search_path', 'public' || CASE WHEN namespaces IS NULL THEN '' ELSE ', ' || namespaces END, true);
END
$extension_path$;

DO $monitoring$
BEGIN
 CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
 RAISE NOTICE 'Optional pg_stat_statements unavailable: %', SQLERRM;
END
$monitoring$;





-- Functions


CREATE FUNCTION public.app_group_member(group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT EXISTS(SELECT FROM public.group_chat_members WHERE group_chat_id=group_id AND user_id::text=current_setting('app.current_user_id',true)) $$;

CREATE FUNCTION public.app_guild_member(target_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$ SELECT EXISTS(SELECT FROM public.guild_members WHERE guild_id=target_id AND user_id::text=current_setting('app.current_user_id',true) AND left_at IS NULL) $$;

CREATE FUNCTION public.automation_official_name() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
 IF EXISTS(SELECT 1 FROM automation_accounts WHERE user_id=NEW.id) THEN
   NEW.display_name := regexp_replace(COALESCE(NEW.display_name,NEW.username),'( Ⓩ)+$','') || ' Ⓩ';
 END IF;
 RETURN NEW;
END $_$;

CREATE FUNCTION public.help_docs_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.body_markdown, '')), 'B');
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.immutable_account_product_base() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
 IF (NEW.slug,NEW.kind,NEW.base_plan,NEW.built_in) IS DISTINCT FROM (OLD.slug,OLD.kind,OLD.base_plan,OLD.built_in) THEN
  RAISE EXCEPTION 'Product identity and entitlement tier cannot be changed; create another account type';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.retain_bookmark_entitlement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE account_id uuid; plan_key text; fallback integer; configured text; slots integer;
BEGIN
 IF TG_TABLE_NAME = 'users' THEN
   account_id := NEW.id; plan_key := NEW.plan;
   IF plan_key NOT IN ('plus','pro','max') THEN RETURN NEW; END IF;
   fallback := CASE plan_key WHEN 'plus' THEN 5 WHEN 'pro' THEN 15 ELSE 30 END;
 ELSE
   account_id := NEW.user_id; plan_key := 'business'; fallback := 30;
   IF NEW.status NOT IN ('active','grace') THEN RETURN NEW; END IF;
 END IF;
 SELECT value INTO configured FROM x_manifest WHERE key='bookmark_folders_' || plan_key;
 slots := CASE WHEN configured ~ '^\d{1,4}$' THEN LEAST(configured::integer,1000) ELSE fallback END;
 INSERT INTO bookmark_entitlements(user_id,included_limit) VALUES(account_id,slots)
 ON CONFLICT(user_id) DO UPDATE SET included_limit=GREATEST(bookmark_entitlements.included_limit,EXCLUDED.included_limit);
 RETURN NEW;
END $_$;

CREATE FUNCTION public.system_alerts_default_priority() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.priority_level IS NULL THEN
    NEW.priority_level := CASE NEW.severity
      WHEN 'critical' THEN 2
      WHEN 'warning'  THEN 4
      ELSE 6
    END;
  END IF;
  IF NEW.title IS NULL THEN
    NEW.title := initcap(replace(NEW.type, '_', ' '));
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_account_product() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE product account_types; expected_kind text; expected_base text;
BEGIN
 IF TG_TABLE_NAME='business_accounts' THEN expected_kind:='business';expected_base:=NEW.tier;
 ELSE expected_kind:='personal';expected_base:=NEW.plan;END IF;
 IF NEW.account_type_slug IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO product FROM account_types WHERE slug=NEW.account_type_slug;
 IF NOT FOUND OR product.kind<>expected_kind OR product.base_plan<>expected_base THEN
  -- A legacy tier change must not retain a different product's identity.
  NEW.account_type_slug:=NULL;
 END IF;
 RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;


-- Tables — final columns, primary keys, unique and check constraints


CREATE TABLE public.account_appeals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    appeal_type text NOT NULL,
    reason text NOT NULL,
    contact_email text,
    status text DEFAULT 'pending'::text NOT NULL,
    refusal_count integer DEFAULT 0 NOT NULL,
    ai_triage_result jsonb,
    admin_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_appeals_appeal_type_check CHECK ((appeal_type = ANY (ARRAY['suspension'::text, 'ban'::text]))),
    CONSTRAINT account_appeals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'approved'::text, 'denied'::text]))),
    CONSTRAINT account_appeals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.account_restore_uses (
    jti text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_restore_uses_pkey PRIMARY KEY (jti)
);

CREATE TABLE public.account_type_play_products (
    product_id text NOT NULL,
    account_type_slug text NOT NULL,
    "interval" text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_type_play_products_interval_check CHECK (("interval" = ANY (ARRAY['monthly'::text, 'annual'::text]))),
    CONSTRAINT account_type_play_products_pkey PRIMARY KEY (product_id)
);

CREATE TABLE public.account_types (
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    kind text NOT NULL,
    base_plan text NOT NULL,
    monthly_price_kobo bigint NOT NULL,
    annual_price_kobo bigint NOT NULL,
    play_monthly_product_id text,
    play_annual_product_id text,
    is_active boolean DEFAULT true NOT NULL,
    built_in boolean DEFAULT false NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_types_annual_price_kobo_check CHECK (((annual_price_kobo >= 0) AND (annual_price_kobo <= '1200000000000'::bigint))),
    CONSTRAINT account_types_check CHECK ((((kind = 'personal'::text) AND (base_plan = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text, 'max'::text]))) OR ((kind = 'business'::text) AND (base_plan = ANY (ARRAY['starter'::text, 'growth'::text, 'enterprise'::text]))))),
    CONSTRAINT account_types_check1 CHECK (((base_plan <> 'free'::text) OR ((monthly_price_kobo = 0) AND (annual_price_kobo = 0)))),
    CONSTRAINT account_types_kind_check CHECK ((kind = ANY (ARRAY['personal'::text, 'business'::text]))),
    CONSTRAINT account_types_monthly_price_kobo_check CHECK (((monthly_price_kobo >= 0) AND (monthly_price_kobo <= '100000000000'::bigint))),
    CONSTRAINT account_types_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
    CONSTRAINT account_types_slug_check CHECK ((slug ~ '^[a-z][a-z0-9_]{1,47}$'::text)),
    CONSTRAINT account_types_pkey PRIMARY KEY (slug),
    CONSTRAINT account_types_play_annual_product_id_key UNIQUE (play_annual_product_id),
    CONSTRAINT account_types_play_monthly_product_id_key UNIQUE (play_monthly_product_id)
);

CREATE TABLE public.ad_ai_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    creative_id uuid,
    image_url text NOT NULL,
    deepseek_result jsonb,
    gemini_result jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_ai_escalations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT ad_ai_escalations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_campaign_daily_stats (
    campaign_id uuid NOT NULL,
    date date NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    spend_credits numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT ad_campaign_daily_stats_pkey PRIMARY KEY (campaign_id, date)
);

CREATE TABLE public.ad_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text DEFAULT 'business'::text NOT NULL,
    business_account_id uuid,
    business_page_id uuid,
    created_by uuid NOT NULL,
    name text NOT NULL,
    objective text DEFAULT 'traffic'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    moderation_status text DEFAULT 'pending'::text NOT NULL,
    moderation_mode text,
    moderation_reason text,
    ai_confidence numeric(4,3),
    moderated_by uuid,
    moderated_at timestamp with time zone,
    cpm_credits numeric(12,2) DEFAULT 500 NOT NULL,
    daily_budget_credits numeric(14,2),
    total_budget_credits numeric(14,2) DEFAULT 0 NOT NULL,
    spent_credits numeric(14,2) DEFAULT 0 NOT NULL,
    target_plans text[],
    target_countries text[],
    frequency_cap_per_user_per_day integer DEFAULT 20 NOT NULL,
    boosted_content_type text,
    boosted_content_id uuid,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    advertiser_type text DEFAULT 'business_account'::text NOT NULL,
    advertiser_user_id uuid,
    advertiser_grace_until timestamp with time zone,
    ai_escalated boolean DEFAULT false NOT NULL,
    CONSTRAINT ad_campaigns_advertiser_type_check CHECK ((advertiser_type = ANY (ARRAY['personal'::text, 'business_account'::text, 'business_page'::text]))),
    CONSTRAINT ad_campaigns_boosted_content_type_check CHECK (((boosted_content_type IS NULL) OR (boosted_content_type = ANY (ARRAY['moment'::text, 'tweet'::text, 'blog_post'::text, 'forum_thread'::text, 'forum_question'::text, 'room'::text, 'wiki_page'::text, 'game'::text, 'classroom'::text, 'business_page_post'::text, 'poll'::text, 'quiz'::text])))),
    CONSTRAINT ad_campaigns_budget_check CHECK (((total_budget_credits >= (0)::numeric) AND (spent_credits >= (0)::numeric))),
    CONSTRAINT ad_campaigns_business_owner_check CHECK (((owner_type = 'admin'::text) OR (business_account_id IS NOT NULL))),
    CONSTRAINT ad_campaigns_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT ad_campaigns_objective_check CHECK ((objective = ANY (ARRAY['awareness'::text, 'traffic'::text, 'boost_post'::text, 'boost_room'::text, 'boost_content'::text]))),
    CONSTRAINT ad_campaigns_owner_type_check CHECK ((owner_type = ANY (ARRAY['business'::text, 'admin'::text]))),
    CONSTRAINT ad_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text, 'active'::text, 'paused'::text, 'completed'::text, 'stopped'::text]))),
    CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_coupon_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coupon_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    user_id uuid NOT NULL,
    credits_applied numeric(12,2) DEFAULT 0 NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_coupon_redemptions_pkey PRIMARY KEY (id),
    CONSTRAINT ad_coupon_redemptions_unique UNIQUE (coupon_id, campaign_id)
);

CREATE TABLE public.ad_coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    discount_type text NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    max_redemptions integer,
    redemptions_count integer DEFAULT 0 NOT NULL,
    min_budget_credits numeric(12,2) DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'flat_credits'::text, 'free_credits'::text]))),
    CONSTRAINT ad_coupons_discount_value_check CHECK ((discount_value > (0)::numeric)),
    CONSTRAINT ad_coupons_code_key UNIQUE (code),
    CONSTRAINT ad_coupons_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_creatives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    placement_key text NOT NULL,
    format text DEFAULT 'text'::text NOT NULL,
    size text NOT NULL,
    title text,
    body text,
    image_url text,
    click_url text,
    third_party_tag text,
    cta_label text,
    is_active boolean DEFAULT true NOT NULL,
    impressions_count bigint DEFAULT 0 NOT NULL,
    clicks_count bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_creatives_format_check CHECK ((format = ANY (ARRAY['html'::text, 'text'::text, 'image'::text, 'native'::text, 'third_party'::text]))),
    CONSTRAINT ad_creatives_size_check CHECK ((size = ANY (ARRAY['300x250'::text, '320x50'::text, 'interstitial'::text, 'rewarded'::text, 'native'::text]))),
    CONSTRAINT ad_creatives_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creative_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    placement_key text NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    cost_credits numeric(12,4) DEFAULT 0 NOT NULL,
    client_event_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_events_type_check CHECK ((event_type = ANY (ARRAY['impression'::text, 'click'::text]))),
    CONSTRAINT ad_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    size text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    base_cpm_credits numeric(12,2) DEFAULT 500 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_placements_size_check CHECK ((size = ANY (ARRAY['300x250'::text, '320x50'::text, 'interstitial'::text, 'rewarded'::text, 'native'::text]))),
    CONSTRAINT ad_placements_key_key UNIQUE (key),
    CONSTRAINT ad_placements_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ad_wallet_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    reference_id text,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ad_wallet_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_actions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    duration_hours integer,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admin_actions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_audit_log (
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
    metadata jsonb,
    CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_data_import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    filename text,
    format text DEFAULT 'ndjson'::text NOT NULL,
    dedupe_strategy text DEFAULT 'skip'::text NOT NULL,
    raw_data text NOT NULL,
    total_rows integer DEFAULT 0 NOT NULL,
    processed_rows integer DEFAULT 0 NOT NULL,
    imported_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_data_import_jobs_dedupe_strategy_check CHECK ((dedupe_strategy = ANY (ARRAY['skip'::text, 'overwrite'::text]))),
    CONSTRAINT admin_data_import_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT admin_data_import_jobs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_message_receipts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    admin_message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_delivered boolean DEFAULT false,
    is_read boolean DEFAULT false,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    CONSTRAINT admin_message_receipts_admin_message_id_user_id_key UNIQUE (admin_message_id, user_id),
    CONSTRAINT admin_message_receipts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_messages (
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
    CONSTRAINT admin_messages_broadcast_type_check CHECK ((broadcast_type = ANY (ARRAY['direct'::text, 'all'::text, 'by_plan'::text, 'by_role'::text]))),
    CONSTRAINT admin_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.admin_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_roles_pkey PRIMARY KEY (id),
    CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role)
);

CREATE TABLE public.ai_call_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    feature text NOT NULL,
    success boolean NOT NULL,
    confidence numeric(5,4),
    latency_ms integer NOT NULL,
    result_preview text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    input_tokens integer,
    output_tokens integer,
    metadata jsonb,
    CONSTRAINT ai_call_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.alert_notification_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    alert_id uuid NOT NULL,
    escalation_stage integer DEFAULT 0 NOT NULL,
    channel text NOT NULL,
    recipient_type text NOT NULL,
    recipient_user_id uuid,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alert_notification_log_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'email'::text, 'telegram'::text, 'push'::text, 'in_app'::text]))),
    CONSTRAINT alert_notification_log_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['admin'::text, 'moderator'::text]))),
    CONSTRAINT alert_notification_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text]))),
    CONSTRAINT alert_notification_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.alliance_wars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alliance_1_id uuid NOT NULL,
    alliance_2_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    winner_alliance_id uuid,
    alliance_1_xp bigint DEFAULT 0 NOT NULL,
    alliance_2_xp bigint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT alliance_wars_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text]))),
    CONSTRAINT alliance_wars_pkey PRIMARY KEY (id)
);

CREATE TABLE public.announcement_banners (
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
    target_genders text[] DEFAULT ARRAY[]::text[],
    CONSTRAINT announcement_banners_content_type_check CHECK ((content_type = ANY (ARRAY['html'::text, 'text'::text]))),
    CONSTRAINT announcement_banners_pkey PRIMARY KEY (id)
);

CREATE TABLE public.announcement_modals (
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
    target_genders text[] DEFAULT ARRAY[]::text[],
    CONSTRAINT announcement_modals_content_type_check CHECK ((content_type = ANY (ARRAY['html'::text, 'text'::text]))),
    CONSTRAINT announcement_modals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT app_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE public.audit_discrepancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    asset_type text NOT NULL,
    ledger_sum bigint NOT NULL,
    wallet_balance bigint NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    notes text,
    CONSTRAINT audit_discrepancies_asset_type_check CHECK ((asset_type = ANY (ARRAY['coins'::text, 'stars'::text, 'xp'::text]))),
    CONSTRAINT audit_discrepancies_pkey PRIMARY KEY (id)
);

CREATE TABLE public.audit_discrepancies_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    asset_type text NOT NULL,
    ledger_sum bigint NOT NULL,
    wallet_balance bigint NOT NULL,
    detected_at timestamp with time zone,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    notes text,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_discrepancies_archive_pkey PRIMARY KEY (id)
)
WITH (fillfactor='100');

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    target_type text,
    target_id text,
    metadata jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.automated_actions_log (
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
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT automated_actions_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.automation_accounts (
    user_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_accounts_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.automation_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    account_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    normalized text NOT NULL,
    fingerprint text NOT NULL,
    status text DEFAULT 'review'::text NOT NULL,
    review_reason text NOT NULL,
    provider text NOT NULL,
    published_content_id uuid,
    published_url text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT automation_generations_status_check CHECK ((status = ANY (ARRAY['review'::text, 'published'::text, 'rejected'::text]))),
    CONSTRAINT automation_generations_fingerprint_key UNIQUE (fingerprint),
    CONSTRAINT automation_generations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.automation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    name text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    providers jsonb DEFAULT '[]'::jsonb NOT NULL,
    interval_hours integer DEFAULT 24 NOT NULL,
    publication_mode text DEFAULT 'review'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_jobs_interval_hours_check CHECK (((interval_hours >= 1) AND (interval_hours <= 8760))),
    CONSTRAINT automation_jobs_publication_mode_check CHECK ((publication_mode = ANY (ARRAY['review'::text, 'auto'::text]))),
    CONSTRAINT automation_jobs_target_type_check CHECK ((target_type = ANY (ARRAY['forum'::text, 'wiki'::text, 'blog'::text, 'room'::text]))),
    CONSTRAINT automation_jobs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.bb_boards (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    parent_id uuid,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    icon_emoji text DEFAULT '💬'::text,
    sort_order integer DEFAULT 0 NOT NULL,
    thread_count integer DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    last_post_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bb_boards_pkey PRIMARY KEY (id),
    CONSTRAINT bb_boards_slug_key UNIQUE (slug)
);

CREATE TABLE public.bb_post_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bb_post_reactions_pkey PRIMARY KEY (id),
    CONSTRAINT bb_post_reactions_post_id_user_id_key UNIQUE (post_id, user_id)
);

CREATE TABLE public.bb_posts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    thread_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    content_format text DEFAULT 'plaintext'::text NOT NULL,
    image_url text,
    quoted_post_id uuid,
    edited_at timestamp with time zone,
    reaction_count integer DEFAULT 0 NOT NULL,
    is_op boolean DEFAULT false NOT NULL,
    CONSTRAINT bb_posts_content_format_check CHECK ((content_format = ANY (ARRAY['plaintext'::text, 'markdown'::text]))),
    CONSTRAINT bb_posts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.bb_pot_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    thread_id uuid NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount_credits integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bb_pot_claims_pkey PRIMARY KEY (id),
    CONSTRAINT bb_pot_claims_thread_id_user_id_key UNIQUE (thread_id, user_id)
);

CREATE TABLE public.bb_threads (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    board_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    last_reply_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    content_format text DEFAULT 'plaintext'::text NOT NULL,
    image_url text,
    edited_at timestamp with time zone,
    pot_total_credits integer DEFAULT 0 NOT NULL,
    pot_per_claim_credits integer DEFAULT 0 NOT NULL,
    pot_max_claims integer DEFAULT 0 NOT NULL,
    pot_claims_count integer DEFAULT 0 NOT NULL,
    pot_refunded_at timestamp with time zone,
    CONSTRAINT bb_threads_content_format_check CHECK ((content_format = ANY (ARRAY['plaintext'::text, 'markdown'::text]))),
    CONSTRAINT bb_threads_pkey PRIMARY KEY (id),
    CONSTRAINT bb_threads_slug_key UNIQUE (slug)
);

CREATE TABLE public.blog_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blog_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_categories_blog_slug_idx UNIQUE (blog_id, slug),
    CONSTRAINT blog_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blog_id uuid NOT NULL,
    sender_user_id uuid,
    sender_name text,
    sender_email text,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_contact_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_gift_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    purchase_id uuid NOT NULL,
    treasury_payout_amount integer,
    text_revealed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_gift_claims_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_gift_purchases (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tier_id uuid NOT NULL,
    blog_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    currency text NOT NULL,
    amount_paid integer NOT NULL,
    benefit_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_gift_purchases_currency_check CHECK ((currency = ANY (ARRAY['credits'::text, 'stars'::text]))),
    CONSTRAINT blog_gift_purchases_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_gift_tiers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    blog_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    credits_price integer,
    stars_price integer,
    benefit_type text NOT NULL,
    benefit_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    max_redemptions integer,
    redemption_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_gift_tiers_benefit_type_check CHECK ((benefit_type = ANY (ARRAY['vip_badge'::text, 'vip_section_access'::text, 'custom_reward'::text]))),
    CONSTRAINT blog_gift_tiers_price_check CHECK (((credits_price IS NOT NULL) OR (stars_price IS NOT NULL))),
    CONSTRAINT blog_gift_tiers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    moderator_id uuid NOT NULL,
    blog_id uuid,
    post_id uuid,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_moderation_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_bundle_purchases (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    blog_id uuid NOT NULL,
    slots integer NOT NULL,
    currency text NOT NULL,
    cost integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_bundle_purchases_cost_check CHECK ((cost > 0)),
    CONSTRAINT blog_post_bundle_purchases_currency_check CHECK ((currency = ANY (ARRAY['credits'::text, 'stars'::text]))),
    CONSTRAINT blog_post_bundle_purchases_slots_check CHECK ((slots > 0)),
    CONSTRAINT blog_post_bundle_purchases_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_comment_id uuid,
    body text NOT NULL,
    status text DEFAULT 'visible'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT blog_post_comments_status_check CHECK ((status = ANY (ARRAY['visible'::text, 'pending'::text, 'removed'::text]))),
    CONSTRAINT blog_post_comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_daily_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    date date NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    likes integer DEFAULT 0 NOT NULL,
    comments integer DEFAULT 0 NOT NULL,
    unlock_count integer DEFAULT 0 NOT NULL,
    unlock_credits integer DEFAULT 0 NOT NULL,
    CONSTRAINT blog_post_daily_stats_pkey PRIMARY KEY (id),
    CONSTRAINT blog_post_daily_stats_post_date_idx UNIQUE (post_id, date)
);

CREATE TABLE public.blog_post_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_likes_pkey PRIMARY KEY (id),
    CONSTRAINT blog_post_likes_post_user_idx UNIQUE (post_id, user_id)
);

CREATE TABLE public.blog_post_shares (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_shares_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_treasuries (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    post_id uuid,
    owner_id uuid NOT NULL,
    funded_amount integer DEFAULT 0 NOT NULL,
    remaining_amount integer DEFAULT 0 NOT NULL,
    max_claimants integer,
    claimant_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    blog_id uuid,
    gift_tier_id uuid,
    generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT blog_post_treasuries_scope_check CHECK ((((post_id IS NOT NULL) AND (gift_tier_id IS NULL)) OR ((post_id IS NULL) AND (gift_tier_id IS NOT NULL) AND (blog_id IS NOT NULL)))),
    CONSTRAINT blog_post_treasuries_status_check CHECK ((status = ANY (ARRAY['active'::text, 'exhausted'::text, 'closed'::text]))),
    CONSTRAINT blog_post_treasuries_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_treasury_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    treasury_id uuid NOT NULL,
    user_id uuid NOT NULL,
    claim_type text NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT blog_post_treasury_claims_type_check CHECK ((claim_type = ANY (ARRAY['comment'::text, 'share'::text]))),
    CONSTRAINT blog_post_treasury_claims_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_post_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    credits_spent integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_unlocks_pkey PRIMARY KEY (id),
    CONSTRAINT blog_post_unlocks_post_user_idx UNIQUE (post_id, user_id)
);

CREATE TABLE public.blog_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blog_id uuid NOT NULL,
    author_id uuid NOT NULL,
    category_id uuid,
    type text DEFAULT 'article'::text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    body_markdown text NOT NULL,
    body_html text NOT NULL,
    featured_image_url text,
    status text DEFAULT 'draft'::text NOT NULL,
    is_paywalled boolean DEFAULT false NOT NULL,
    paywall_credits_cost integer DEFAULT 0 NOT NULL,
    word_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    content_format text DEFAULT 'markdown'::text NOT NULL,
    share_count integer DEFAULT 0 NOT NULL,
    page_key text,
    search_vector tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(excerpt, ''::text)), 'B'::"char"))) STORED,
    draft_content jsonb,
    CONSTRAINT blog_posts_content_format_check CHECK ((content_format = ANY (ARRAY['markdown'::text, 'plaintext'::text]))),
    CONSTRAINT blog_posts_page_key_check CHECK (((page_key IS NULL) OR (page_key = ANY (ARRAY['about'::text, 'privacy'::text, 'contact'::text])))),
    CONSTRAINT blog_posts_paywall_cost_check CHECK ((paywall_credits_cost >= 0)),
    CONSTRAINT blog_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))),
    CONSTRAINT blog_posts_type_check CHECK ((type = ANY (ARRAY['article'::text, 'page'::text]))),
    CONSTRAINT blog_posts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blog_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_subscriptions_blog_user_idx UNIQUE (blog_id, user_id),
    CONSTRAINT blog_subscriptions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_themes (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    layout_variant text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    included_for_plans text[] DEFAULT '{}'::text[] NOT NULL,
    included_for_business_tiers text[] DEFAULT '{}'::text[] NOT NULL,
    is_free_default boolean DEFAULT false NOT NULL,
    store_item_id uuid,
    credits_cost integer,
    stars_cost integer,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_themes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    tagline text,
    description text,
    avatar_url text,
    cover_image_url text,
    theme_store_item_id uuid,
    comments_enabled boolean DEFAULT true NOT NULL,
    comments_moderation_enabled boolean DEFAULT false NOT NULL,
    hide_author_info boolean DEFAULT false NOT NULL,
    show_subscriber_count boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    subscriber_count integer DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    business_account_id uuid,
    slot_source text DEFAULT 'included'::text NOT NULL,
    slot_unlock_currency text,
    slot_unlock_cost integer,
    slot_unlock_reference_id text,
    menu_config jsonb DEFAULT '{"items": [{"id": "home", "type": "url", "label": "Home", "externalUrl": "/"}, {"id": "categories", "type": "url", "label": "Categories", "externalUrl": "#categories"}, {"id": "subscribe", "type": "url", "label": "Subscribe", "externalUrl": "#subscribe"}], "orientation": "horizontal"}'::jsonb NOT NULL,
    active_theme_id text DEFAULT 'classic'::text NOT NULL,
    extra_post_slots integer DEFAULT 0 NOT NULL,
    CONSTRAINT blogs_extra_post_slots_check CHECK ((extra_post_slots >= 0)),
    CONSTRAINT blogs_slot_source_check CHECK ((slot_source = ANY (ARRAY['included'::text, 'purchased'::text]))),
    CONSTRAINT blogs_slot_unlock_currency_check CHECK (((slot_unlock_currency IS NULL) OR (slot_unlock_currency = ANY (ARRAY['credits'::text, 'stars'::text])))),
    CONSTRAINT blogs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'suspended'::text, 'banned'::text, 'deactivated'::text]))),
    CONSTRAINT blogs_pkey PRIMARY KEY (id),
    CONSTRAINT blogs_slug_key UNIQUE (slug)
);

CREATE TABLE public.bookmark_entitlements (
    user_id uuid NOT NULL,
    included_limit integer DEFAULT 0 NOT NULL,
    purchased_slots integer DEFAULT 0 NOT NULL,
    CONSTRAINT bookmark_entitlements_included_limit_check CHECK ((included_limit >= 0)),
    CONSTRAINT bookmark_entitlements_purchased_slots_check CHECK ((purchased_slots >= 0)),
    CONSTRAINT bookmark_entitlements_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.bookmark_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookmark_folders_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))),
    CONSTRAINT bookmark_folders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.bookmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    folder_id uuid,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookmarks_pkey PRIMARY KEY (id),
    CONSTRAINT bookmarks_user_id_content_type_content_id_key UNIQUE (user_id, content_type, content_id)
);

CREATE TABLE public.boost_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    description text,
    multiplier_bp integer DEFAULT 0 NOT NULL,
    duration_hours integer NOT NULL,
    coins_cost integer,
    stars_cost integer,
    iap_product_id text,
    stackable boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT boost_types_duration_positive CHECK ((duration_hours > 0)),
    CONSTRAINT boost_types_key_key UNIQUE (key),
    CONSTRAINT boost_types_pkey PRIMARY KEY (id)
);

CREATE TABLE public.branded_rooms (
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
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT branded_rooms_pkey PRIMARY KEY (id)
);

CREATE TABLE public.business_accounts (
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
    downgrade_to_tier text,
    downgrade_effective_at timestamp with time zone,
    current_period_ends_at timestamp with time zone,
    account_type_slug text,
    pending_account_type_slug text,
    downgrade_account_type_slug text,
    CONSTRAINT business_accounts_pending_tier_check CHECK ((pending_tier = ANY (ARRAY['starter'::text, 'growth'::text, 'enterprise'::text]))),
    CONSTRAINT business_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'grace'::text, 'lapsed'::text, 'suspended'::text, 'cancelled'::text]))),
    CONSTRAINT business_accounts_tier_check CHECK ((tier = ANY (ARRAY['starter'::text, 'growth'::text, 'enterprise'::text]))),
    CONSTRAINT business_accounts_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text]))),
    CONSTRAINT business_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT business_accounts_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.business_page_daily_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_id uuid NOT NULL,
    date date NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    post_views integer DEFAULT 0 NOT NULL,
    ad_impressions integer DEFAULT 0 NOT NULL,
    ad_clicks integer DEFAULT 0 NOT NULL,
    CONSTRAINT business_page_daily_stats_page_date_idx UNIQUE (page_id, date),
    CONSTRAINT business_page_daily_stats_pkey PRIMARY KEY (id)
);

CREATE TABLE public.business_page_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    image_url text,
    status text DEFAULT 'published'::text NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT business_page_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))),
    CONSTRAINT business_page_posts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.business_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_account_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    bio text,
    avatar_url text,
    cover_image_url text,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    view_count integer DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT business_pages_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deactivated'::text, 'suspended'::text, 'banned'::text]))),
    CONSTRAINT business_pages_pkey PRIMARY KEY (id),
    CONSTRAINT business_pages_slug_key UNIQUE (slug)
);

CREATE TABLE public.classroom_daily_stats (
    room_id uuid NOT NULL,
    day date NOT NULL,
    page_views integer DEFAULT 0 NOT NULL,
    shares integer DEFAULT 0 NOT NULL,
    CONSTRAINT classroom_daily_stats_pkey PRIMARY KEY (room_id, day)
);

CREATE TABLE public.classroom_enrolments (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    paid boolean DEFAULT false NOT NULL,
    fee_kobo bigint DEFAULT 0 NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    certificate_issued boolean DEFAULT false,
    certificate_issued_at timestamp with time zone,
    muted_until timestamp with time zone,
    muted_by uuid,
    last_active_at timestamp with time zone,
    CONSTRAINT classroom_enrolments_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_enrolments_room_id_user_id_key UNIQUE (room_id, user_id)
);

CREATE TABLE public.classroom_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    meeting_url text,
    recording_url text,
    recording_added_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_events_time_order CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT classroom_events_title_len CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200))),
    CONSTRAINT classroom_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_lesson_completions (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    module_id text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_lesson_completions_pkey PRIMARY KEY (room_id, user_id, module_id)
);

CREATE TABLE public.classroom_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    post_id uuid,
    comment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_likes_one_target CHECK (((((post_id IS NOT NULL))::integer + ((comment_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT classroom_likes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_member_badges (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    badge_key text NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_member_badges_pkey PRIMARY KEY (room_id, user_id, badge_key)
);

CREATE TABLE public.classroom_member_points (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    points bigint DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_member_points_level_range CHECK (((level >= 1) AND (level <= 9))),
    CONSTRAINT classroom_member_points_points_nonneg CHECK ((points >= 0)),
    CONSTRAINT classroom_member_points_pkey PRIMARY KEY (room_id, user_id)
);

CREATE TABLE public.classroom_moderators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'moderator'::text NOT NULL,
    is_moderator boolean DEFAULT true NOT NULL,
    moderator_granted_by uuid,
    moderator_granted_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_moderators_role_check CHECK ((role = ANY (ARRAY['moderator'::text]))),
    CONSTRAINT classroom_moderators_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text]))),
    CONSTRAINT classroom_moderators_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_moderators_room_user_key UNIQUE (room_id, user_id)
);

CREATE TABLE public.classroom_points_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    source text NOT NULL,
    reference_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_points_ledger_amount_nonzero CHECK ((amount <> 0)),
    CONSTRAINT classroom_points_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    room_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_id uuid,
    body text NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    hidden_by uuid,
    hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_post_comments_body_len CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))),
    CONSTRAINT classroom_post_comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    author_id uuid NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    title text,
    body text NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    hidden_by uuid,
    hidden_at timestamp with time zone,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_posts_body_len CHECK (((char_length(body) >= 1) AND (char_length(body) <= 10000))),
    CONSTRAINT classroom_posts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_quiz_attempts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quiz_id uuid NOT NULL,
    user_id uuid NOT NULL,
    score integer NOT NULL,
    passed boolean NOT NULL,
    answers jsonb NOT NULL,
    xp_awarded integer DEFAULT 0,
    completed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT classroom_quiz_attempts_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_quiz_attempts_quiz_id_user_id_key UNIQUE (quiz_id, user_id)
);

CREATE TABLE public.classroom_quiz_questions (
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
    CONSTRAINT classroom_quiz_questions_correct_option_check CHECK ((correct_option = ANY (ARRAY['a'::text, 'b'::text, 'c'::text, 'd'::text]))),
    CONSTRAINT classroom_quiz_questions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_quizzes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    xp_reward integer DEFAULT 50 NOT NULL,
    pass_score integer DEFAULT 70 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT classroom_quizzes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    post_id uuid,
    comment_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'pending'::text NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_reports_one_target CHECK (((((post_id IS NOT NULL))::integer + ((comment_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT classroom_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate_speech'::text, 'sexual_content'::text, 'misinformation'::text, 'scam'::text, 'off_topic'::text, 'other'::text]))),
    CONSTRAINT classroom_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved_removed'::text, 'resolved_dismissed'::text]))),
    CONSTRAINT classroom_reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.classroom_shares (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    share_count integer DEFAULT 1 NOT NULL,
    first_shared_at timestamp with time zone DEFAULT now() NOT NULL,
    last_shared_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_shares_pkey PRIMARY KEY (room_id, user_id)
);

CREATE TABLE public.classroom_slug_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    old_slug text,
    new_slug text NOT NULL,
    changed_by uuid,
    cost_credits integer DEFAULT 0 NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_slug_history_cost_check CHECK ((cost_credits >= 0)),
    CONSTRAINT classroom_slug_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.coin_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    reference_id text,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT coin_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.coin_ledger_archive (
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

CREATE TABLE public.community_note_votes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    note_id uuid NOT NULL,
    user_id uuid NOT NULL,
    helpful boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT community_note_votes_note_id_user_id_key UNIQUE (note_id, user_id),
    CONSTRAINT community_note_votes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.community_notes (
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
    CONSTRAINT community_notes_target_type_check CHECK ((target_type = ANY (ARRAY['message'::text, 'room'::text, 'user'::text, 'guild'::text]))),
    CONSTRAINT community_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_engagement_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    content_type text NOT NULL,
    interest_tag text,
    event_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_engagement_signals_event_type_check CHECK ((event_type = ANY (ARRAY['view'::text, 'like'::text, 'comment'::text, 'share'::text, 'open'::text]))),
    CONSTRAINT content_engagement_signals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_hashtags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hashtag_id uuid NOT NULL,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_hashtags_type_check CHECK ((content_type = ANY (ARRAY['moment'::text, 'tweet'::text, 'blog_post'::text, 'forum_thread'::text, 'forum_question'::text, 'room'::text, 'classroom'::text, 'wiki_page'::text, 'game'::text, 'poll'::text, 'quiz'::text, 'guild'::text, 'business_page_post'::text]))),
    CONSTRAINT content_hashtags_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_shares (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_shares_type_check CHECK ((content_type = ANY (ARRAY['poll'::text, 'quiz'::text, 'wiki'::text, 'room'::text, 'tale'::text, 'tale_chapter'::text]))),
    CONSTRAINT content_shares_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_treasuries (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    funded_amount integer DEFAULT 0 NOT NULL,
    remaining_amount integer DEFAULT 0 NOT NULL,
    max_claimants integer NOT NULL,
    claimant_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reward_action text DEFAULT 'credits'::text NOT NULL,
    custom_instructions text,
    title text,
    generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT content_treasuries_reward_action_check CHECK ((reward_action = ANY (ARRAY['credits'::text, 'stars'::text, 'custom_text'::text]))),
    CONSTRAINT content_treasuries_status_check CHECK ((status = ANY (ARRAY['active'::text, 'exhausted'::text, 'closed'::text]))),
    CONSTRAINT content_treasuries_type_check CHECK ((content_type = ANY (ARRAY['poll'::text, 'quiz'::text, 'wiki'::text, 'room'::text, 'tale'::text, 'tale_chapter'::text]))),
    CONSTRAINT content_treasuries_pkey PRIMARY KEY (id)
);

CREATE TABLE public.content_treasury_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    treasury_id uuid NOT NULL,
    user_id uuid NOT NULL,
    claim_type text NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    CONSTRAINT content_treasury_claims_type_check CHECK ((claim_type = ANY (ARRAY['vote'::text, 'share'::text, 'pass'::text, 'contribute'::text, 'gift'::text]))),
    CONSTRAINT content_treasury_claims_pkey PRIMARY KEY (id)
);

CREATE TABLE public.conversation_scores (
    user_id_1 uuid NOT NULL,
    user_id_2 uuid NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    streak_days integer DEFAULT 0 NOT NULL,
    last_message_date date,
    has_connection_badge boolean DEFAULT false NOT NULL,
    badge_unlocked_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cs_ordered_pair CHECK ((user_id_1 < user_id_2)),
    CONSTRAINT conversation_scores_pkey PRIMARY KEY (user_id_1, user_id_2)
);

CREATE TABLE public.council_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    legacy_score bigint DEFAULT 0 NOT NULL,
    CONSTRAINT council_invitations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.creator_bank_accounts (
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
    is_encrypted boolean DEFAULT false NOT NULL,
    CONSTRAINT creator_bank_accounts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.creator_broadcasts (
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
    reference_id text,
    business_account_id uuid,
    CONSTRAINT creator_broadcasts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.creator_crypto_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    currency text NOT NULL,
    balance_base_units numeric(40,0) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_crypto_balances_pkey PRIMARY KEY (id)
);

CREATE TABLE public.creator_earnings (
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
    CONSTRAINT creator_earnings_source_type_check CHECK ((source_type = ANY (ARRAY['gift'::text, 'subscription'::text, 'drop_entry'::text, 'classroom_enrolment'::text, 'sponsored_quest'::text, 'merch'::text, 'creator_fund'::text, 'broadcast'::text, 'blog_paywall'::text, 'blog_gift'::text, 'tale_paywall'::text]))),
    CONSTRAINT creator_earnings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.creator_kyc (
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
    CONSTRAINT creator_kyc_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text]))),
    CONSTRAINT creator_kyc_creator_id_key UNIQUE (creator_id),
    CONSTRAINT creator_kyc_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.creator_kyc FORCE ROW LEVEL SECURITY;

CREATE TABLE public.creator_payouts (
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
    crypto_currency text,
    crypto_chain text,
    crypto_amount_base_units numeric(40,0),
    crypto_tx_hash text,
    reservation_version integer DEFAULT 0 NOT NULL CHECK(reservation_version>=0),
    CONSTRAINT creator_payouts_appeal_status_check CHECK ((appeal_status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT creator_payouts_payout_method_check CHECK ((payout_method = ANY (ARRAY['bank_transfer'::text, 'coins'::text, 'crypto'::text]))),
    CONSTRAINT creator_payouts_region_check CHECK ((region = ANY (ARRAY['nigeria'::text, 'global'::text]))),
    CONSTRAINT creator_payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_approval'::text, 'approved'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'rejected'::text, 'reversed'::text, 'cancelled'::text]))),
    CONSTRAINT creator_payouts_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT creator_payouts_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.creator_payouts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.creator_spotlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    month_year text NOT NULL,
    blurb text,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT creator_spotlights_pkey PRIMARY KEY (id),
    CONSTRAINT uq_creator_spotlight_month UNIQUE (month_year)
);

CREATE TABLE public.creator_wallet_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    network text DEFAULT 'tron'::text NOT NULL,
    currency text DEFAULT 'USDT'::text NOT NULL,
    address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_wallet_addresses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.cron_job_runs (
    job_key text NOT NULL,
    run_date date NOT NULL,
    lease_token uuid NOT NULL,
    lease_until timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT cron_job_runs_pkey PRIMARY KEY (job_key, run_date)
);

CREATE TABLE public.cron_job_steps (
    job_key text NOT NULL,
    run_date date NOT NULL,
    step text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cron_job_steps_pkey PRIMARY KEY (job_key, run_date, step)
);

CREATE TABLE public.cron_state (
    key text NOT NULL,
    value_text text,
    value_ts timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cron_state_pkey PRIMARY KEY (key)
);

CREATE TABLE public.crypto_balance_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    currency text NOT NULL,
    amount_base_units numeric(40,0) NOT NULL,
    source_type text NOT NULL,
    reference_id text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crypto_balance_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.crypto_exchange_rate_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_symbol text NOT NULL,
    usd_price numeric(24,10) NOT NULL,
    set_by_admin_id uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crypto_exchange_rate_overrides_usd_price_check CHECK ((usd_price > (0)::numeric)),
    CONSTRAINT crypto_exchange_rate_overrides_pkey PRIMARY KEY (id),
    CONSTRAINT crypto_exchange_rate_overrides_token_symbol_key UNIQUE (token_symbol)
);

CREATE TABLE public.crypto_price_cache (
    token_symbol text NOT NULL,
    usd_price numeric(24,10) NOT NULL,
    source text DEFAULT 'live'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crypto_price_cache_usd_price_check CHECK ((usd_price > (0)::numeric)),
    CONSTRAINT crypto_price_cache_pkey PRIMARY KEY (token_symbol)
);

CREATE TABLE public.crypto_transfer_claims (
    chain text NOT NULL,
    tx_hash text NOT NULL,
    payment_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crypto_transfer_claims_payment_id_key UNIQUE (payment_id),
    CONSTRAINT crypto_transfer_claims_pkey PRIMARY KEY (chain, tx_hash)
);

CREATE TABLE public.data_export_requests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    download_url text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT data_export_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dm_conversation_score_milestones (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id_a uuid NOT NULL,
    user_id_b uuid NOT NULL,
    milestone_score integer NOT NULL,
    awarded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dm_conversation_score_milesto_user_id_a_user_id_b_milestone_key UNIQUE (user_id_a, user_id_b, milestone_score),
    CONSTRAINT dm_conversation_score_milestones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dm_conversation_unlocks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    conversation_key text NOT NULL,
    initiator_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    unlocked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dm_conversation_unlocks_conversation_key_key UNIQUE (conversation_key),
    CONSTRAINT dm_conversation_unlocks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dm_conversations (
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
    CONSTRAINT dm_no_self_chat CHECK ((user_id_1 <> user_id_2)),
    CONSTRAINT dm_conversations_pkey PRIMARY KEY (id),
    CONSTRAINT dm_conversations_user_id_1_user_id_2_key UNIQUE (user_id_1, user_id_2)
);

CREATE TABLE public.dm_score_sticker_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id_1 uuid NOT NULL,
    user_id_2 uuid NOT NULL,
    pack_name text NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dm_score_sticker_unlocks_pkey PRIMARY KEY (id),
    CONSTRAINT dm_score_sticker_unlocks_user_id_1_user_id_2_pack_name_key UNIQUE (user_id_1, user_id_2, pack_name)
);

CREATE TABLE public.drop_room_replays (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title text NOT NULL,
    highlights jsonb NOT NULL,
    replay_fee_kobo bigint DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT false,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT drop_room_replays_pkey PRIMARY KEY (id),
    CONSTRAINT drop_room_replays_room_id_key UNIQUE (room_id)
);

CREATE TABLE public.elder_mentorships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    elder_id uuid NOT NULL,
    mentee_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    CONSTRAINT elder_mentorships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'terminated'::text]))),
    CONSTRAINT elder_mentorships_elder_id_mentee_id_key UNIQUE (elder_id, mentee_id),
    CONSTRAINT elder_mentorships_pkey PRIMARY KEY (id)
);

CREATE TABLE public.elder_requests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    mentee_id uuid NOT NULL,
    elder_id uuid NOT NULL,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT elder_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))),
    CONSTRAINT elder_requests_mentee_id_elder_id_key UNIQUE (mentee_id, elder_id),
    CONSTRAINT elder_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.failed_commissions (
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT failed_commissions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.failed_webhooks (
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
    updated_at timestamp with time zone DEFAULT now(),
    max_attempts integer DEFAULT 5 NOT NULL,
    event_key text,
    processing_token uuid,
    CONSTRAINT failed_webhooks_event_key_key UNIQUE (event_key),
    CONSTRAINT failed_webhooks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.failed_xp_awards (
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
    CONSTRAINT failed_xp_awards_amount_check CHECK ((amount > 0)),
    CONSTRAINT failed_xp_awards_pkey PRIMARY KEY (id)
);

CREATE TABLE public.feature_flags (
    key text NOT NULL,
    available_from timestamp with time zone,
    early_access_plans text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_flags_pkey PRIMARY KEY (key)
);

CREATE TABLE public.flash_xp_events (
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
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT flash_xp_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.follows (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id),
    CONSTRAINT follows_pkey PRIMARY KEY (id)
);

CREATE TABLE public.footer_scripts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    is_active boolean DEFAULT true,
    "position" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT footer_scripts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.forum_answers (
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
    deleted_at timestamp with time zone,
    CONSTRAINT forum_answers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.forum_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    icon_emoji text DEFAULT '💬'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public.forum_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_favorites_pkey PRIMARY KEY (id),
    CONSTRAINT forum_favorites_user_id_question_id_key UNIQUE (user_id, question_id)
);

CREATE TABLE public.forum_moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    moderator_id uuid NOT NULL,
    question_id uuid,
    answer_id uuid,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_moderation_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.forum_questions (
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
    slug text,
    search_vector tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(body, ''::text)), 'B'::"char"))) STORED,
    CONSTRAINT forum_questions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.forum_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    user_id uuid NOT NULL,
    value smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_votes_target_type_check CHECK ((target_type = ANY (ARRAY['question'::text, 'answer'::text]))),
    CONSTRAINT forum_votes_value_check CHECK ((value = ANY (ARRAY['-1'::integer, 1]))),
    CONSTRAINT forum_votes_pkey PRIMARY KEY (id),
    CONSTRAINT forum_votes_target_type_target_id_user_id_key UNIQUE (target_type, target_id, user_id)
);

CREATE TABLE public.friendships (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    requester_id uuid NOT NULL,
    addressee_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT friendships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'blocked'::text]))),
    CONSTRAINT friendships_pkey PRIMARY KEY (id),
    CONSTRAINT friendships_requester_id_addressee_id_key UNIQUE (requester_id, addressee_id)
);

CREATE TABLE public.game_best_scores (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    best_score bigint DEFAULT 0 NOT NULL,
    plays integer DEFAULT 0 NOT NULL,
    wins integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_best_scores_pkey PRIMARY KEY (game_id, user_id)
);

CREATE TABLE public.game_challenge_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    round_no integer NOT NULL,
    challenger_play_id uuid,
    opponent_play_id uuid,
    challenger_score bigint,
    opponent_score bigint,
    round_winner_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT game_challenge_rounds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text]))),
    CONSTRAINT game_challenge_rounds_challenge_id_round_no_key UNIQUE (challenge_id, round_no),
    CONSTRAINT game_challenge_rounds_pkey PRIMARY KEY (id)
);

CREATE TABLE public.game_challenges (
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
    challenger_archived_at timestamp with time zone,
    opponent_archived_at timestamp with time zone,
    CONSTRAINT game_challenges_rounds_check CHECK ((rounds = ANY (ARRAY[1, 3]))),
    CONSTRAINT game_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'active'::text, 'completed'::text, 'cancelled'::text, 'expired'::text]))),
    CONSTRAINT game_challenges_wager_credits_check CHECK ((wager_credits >= 0)),
    CONSTRAINT game_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE public.game_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_favorites_pkey PRIMARY KEY (id),
    CONSTRAINT game_favorites_user_id_game_id_key UNIQUE (user_id, game_id)
);

CREATE TABLE public.game_milestone_claims (
    user_id uuid NOT NULL,
    threshold integer NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_milestone_claims_pkey PRIMARY KEY (user_id, threshold)
);

CREATE TABLE public.game_play_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    games_played_threshold integer NOT NULL,
    reward_credits integer DEFAULT 0 NOT NULL,
    reward_xp integer DEFAULT 0 NOT NULL,
    reward_stars integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_play_milestones_games_played_threshold_key UNIQUE (games_played_threshold),
    CONSTRAINT game_play_milestones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.game_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    score bigint DEFAULT 0 NOT NULL,
    session_nonce text NOT NULL,
    counted boolean DEFAULT false NOT NULL,
    challenge_round_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT game_plays_pkey PRIMARY KEY (id)
);

CREATE TABLE public.game_progress_tasks (
    play_id uuid NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    completed_at timestamp with time zone,
    CONSTRAINT game_progress_tasks_pkey PRIMARY KEY (play_id)
);

CREATE TABLE public.game_ratings (
    game_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT game_ratings_pkey PRIMARY KEY (game_id, user_id)
);

CREATE TABLE public.game_saves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    game_id uuid NOT NULL,
    label text,
    state jsonb NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_saves_pkey PRIMARY KEY (id)
);

CREATE TABLE public.game_score_attestations (
    play_id uuid NOT NULL,
    score bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_score_attestations_score_check CHECK ((score >= 0)),
    CONSTRAINT game_score_attestations_pkey PRIMARY KEY (play_id)
);

CREATE TABLE public.games (
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
    favorite_count integer DEFAULT 0 NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(tagline, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'C'::"char"))) STORED,
    score_verification text DEFAULT 'practice'::text NOT NULL,
    CONSTRAINT games_score_verification_check CHECK ((score_verification = ANY (ARRAY['practice'::text, 'server'::text]))),
    CONSTRAINT games_pkey PRIMARY KEY (id)
);

CREATE TABLE public.gift_items (
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
    is_rewarded boolean DEFAULT false NOT NULL,
    reward_config jsonb,
    CONSTRAINT gift_items_tier_check CHECK (((tier >= 1) AND (tier <= 5))),
    CONSTRAINT gift_items_name_key UNIQUE (name),
    CONSTRAINT gift_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.gift_reward_grants (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    gift_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    benefit_type text NOT NULL,
    label text NOT NULL,
    description text,
    custom_text text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT gift_reward_grants_benefit_type_check CHECK ((benefit_type = ANY (ARRAY['sender_badge'::text, 'room_privilege'::text, 'blog_privilege'::text, 'custom_text'::text]))),
    CONSTRAINT gift_reward_grants_context_type_check CHECK ((context_type = ANY (ARRAY['room'::text, 'blog'::text]))),
    CONSTRAINT gift_reward_grants_pkey PRIMARY KEY (id)
);

CREATE TABLE public.gift_types (
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
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gift_types_name_key UNIQUE (name),
    CONSTRAINT gift_types_pkey PRIMARY KEY (id)
);

CREATE TABLE public.gifts (
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
    message text,
    message_word_count integer,
    CONSTRAINT gifts_message_length_check CHECK (((message IS NULL) OR (char_length(message) <= 4000))),
    CONSTRAINT gifts_status_check CHECK ((status = ANY (ARRAY['delivered'::text, 'failed'::text, 'refunded'::text]))),
    CONSTRAINT gifts_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.gifts FORCE ROW LEVEL SECURITY;

CREATE TABLE public.group_chat_blocks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    group_chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_chat_blocks_pkey PRIMARY KEY (id),
    CONSTRAINT group_chat_blocks_unique UNIQUE (group_chat_id, user_id)
);

CREATE TABLE public.group_chat_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    group_chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    can_invite boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    muted_by uuid,
    muted_reason text,
    credited_message_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT group_chat_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text]))),
    CONSTRAINT group_chat_members_group_chat_id_user_id_key UNIQUE (group_chat_id, user_id),
    CONSTRAINT group_chat_members_pkey PRIMARY KEY (id)
);

CREATE TABLE public.group_chat_reactivation_choices (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    group_chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reactivated boolean NOT NULL,
    decided_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_chat_reactivation_choices_pkey PRIMARY KEY (id),
    CONSTRAINT group_chat_reactivation_choices_unique UNIQUE (group_chat_id, user_id)
);

CREATE TABLE public.group_chats (
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
    creator_plan_at_creation text,
    creator_business_tier_at_creation text,
    concurrent_cap integer,
    is_business boolean DEFAULT false NOT NULL,
    business_join_credit_enabled boolean DEFAULT false NOT NULL,
    business_join_credit_amount integer,
    business_message_credit_enabled boolean DEFAULT false NOT NULL,
    business_message_credit_amount integer,
    business_message_credit_threshold integer,
    allow_any_member_invite boolean,
    is_deactivated boolean DEFAULT false NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_reason text,
    CONSTRAINT group_chats_tag_check CHECK ((tag = ANY (ARRAY['Study Group'::text, 'Crew'::text, 'Business'::text]))),
    CONSTRAINT group_chats_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_alliance_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    alliance_id uuid NOT NULL,
    guild_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_alliance_members_alliance_id_guild_id_key UNIQUE (alliance_id, guild_id),
    CONSTRAINT guild_alliance_members_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_alliances (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    founded_by uuid NOT NULL,
    is_active boolean DEFAULT true,
    wars_won integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    wars_drawn integer DEFAULT 0 NOT NULL,
    CONSTRAINT guild_alliances_name_key UNIQUE (name),
    CONSTRAINT guild_alliances_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_applications (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT guild_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT guild_applications_guild_id_user_id_key UNIQUE (guild_id, user_id),
    CONSTRAINT guild_applications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_contribution_alerts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weeks_below integer DEFAULT 1 NOT NULL,
    alerted_at timestamp with time zone DEFAULT now(),
    resolved boolean DEFAULT false,
    CONSTRAINT guild_contribution_alerts_guild_id_user_id_key UNIQUE (guild_id, user_id),
    CONSTRAINT guild_contribution_alerts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_invites (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    token text NOT NULL,
    invited_user_id uuid,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_invites_pkey PRIMARY KEY (id),
    CONSTRAINT guild_invites_token_key UNIQUE (token)
);

CREATE TABLE public.guild_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    contribution_score integer DEFAULT 0 NOT NULL,
    war_points_total integer DEFAULT 0 NOT NULL,
    contribution_below_average_weeks integer DEFAULT 0 NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone,
    is_moderator boolean DEFAULT false NOT NULL,
    moderator_granted_by uuid,
    moderator_granted_at timestamp with time zone,
    is_muted boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    CONSTRAINT guild_members_role_check CHECK ((role = ANY (ARRAY['captain'::text, 'veteran'::text, 'recruiter'::text, 'member'::text]))),
    CONSTRAINT guild_members_guild_id_user_id_key UNIQUE (guild_id, user_id),
    CONSTRAINT guild_members_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_messages (
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
    deleted_by uuid,
    CONSTRAINT guild_messages_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 1000))),
    CONSTRAINT guild_messages_type_check CHECK ((type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text]))),
    CONSTRAINT guild_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_quest_contributions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_quest_contributions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_quests (
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
    CONSTRAINT guild_quests_week_start_is_monday CHECK ((EXTRACT(isodow FROM (week_start AT TIME ZONE 'UTC'::text)) = (1)::numeric)),
    CONSTRAINT guild_quests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_id uuid NOT NULL,
    room_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guild_rooms_guild_id_room_id_key UNIQUE (guild_id, room_id),
    CONSTRAINT guild_rooms_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_tier_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_id uuid NOT NULL,
    from_tier text NOT NULL,
    to_tier text NOT NULL,
    guild_xp_at bigint NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    war_id uuid,
    CONSTRAINT guild_tier_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_treasury_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    user_id uuid,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    transaction_type text NOT NULL,
    description text,
    reference_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_treasury_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_war_rematch_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    guild_id uuid NOT NULL,
    war_id uuid NOT NULL,
    discount_percent integer DEFAULT 50 NOT NULL,
    is_used boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT guild_war_rematch_tokens_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guild_wars (
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
    resolved_at timestamp with time zone,
    CONSTRAINT guild_wars_status_check CHECK ((status = ANY (ARRAY['active'::text, 'final_hour'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT guild_wars_pkey PRIMARY KEY (id)
);

CREATE TABLE public.guilds (
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
    is_suspended boolean DEFAULT false NOT NULL,
    suspended_at timestamp with time zone,
    suspended_by uuid,
    suspension_reason text,
    is_banned boolean DEFAULT false NOT NULL,
    banned_at timestamp with time zone,
    banned_by uuid,
    admin_notes text,
    below_minimum_days integer DEFAULT 0 NOT NULL,
    CONSTRAINT guilds_recruitment_type_check CHECK ((recruitment_type = ANY (ARRAY['open'::text, 'approval'::text, 'invite_only'::text]))),
    CONSTRAINT guilds_tier_check CHECK ((tier = ANY (ARRAY['bronze_1'::text, 'bronze_2'::text, 'bronze_3'::text, 'silver_1'::text, 'silver_2'::text, 'silver_3'::text, 'gold_1'::text, 'gold_2'::text, 'gold_3'::text, 'platinum_1'::text, 'platinum_2'::text, 'platinum_3'::text, 'legend'::text]))),
    CONSTRAINT guilds_treasury_balance_max CHECK ((treasury_balance <= '1000000000000'::bigint)),
    CONSTRAINT guilds_treasury_cap_max CHECK ((treasury_cap <= '1000000000000'::bigint)),
    CONSTRAINT guilds_name_key UNIQUE (name),
    CONSTRAINT guilds_pkey PRIMARY KEY (id)
);

CREATE TABLE public.hall_of_fame (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    prestige_count integer NOT NULL,
    legacy_score bigint DEFAULT 0 NOT NULL,
    inducted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hall_of_fame_pkey PRIMARY KEY (id),
    CONSTRAINT hall_of_fame_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.hashtags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    display text NOT NULL,
    alias_of uuid,
    is_blocked boolean DEFAULT false NOT NULL,
    use_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hashtags_not_self_alias CHECK (((alias_of IS NULL) OR (alias_of <> id))),
    CONSTRAINT hashtags_slug_format CHECK (((slug = lower(slug)) AND ((char_length(slug) >= 2) AND (char_length(slug) <= 50)))),
    CONSTRAINT hashtags_pkey PRIMARY KEY (id)
);

CREATE TABLE public.help_ai_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    question text NOT NULL,
    doc_id uuid,
    week_start timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    answer text,
    cost_credits integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT help_ai_requests_cost_credits_check CHECK ((cost_credits >= 0)),
    CONSTRAINT help_ai_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text, 'failed'::text]))),
    CONSTRAINT help_ai_requests_pkey PRIMARY KEY (id),
    CONSTRAINT help_ai_requests_user_id_request_id_key UNIQUE (user_id, request_id)
);

CREATE TABLE public.help_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT help_categories_pkey PRIMARY KEY (id),
    CONSTRAINT help_categories_slug_key UNIQUE (slug)
);

CREATE TABLE public.help_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    body_markdown text NOT NULL,
    body_html text NOT NULL,
    difficulty text DEFAULT 'first_time'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    seo_title text,
    seo_description text,
    published boolean DEFAULT false NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    author_id uuid,
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT help_docs_difficulty_check CHECK ((difficulty = ANY (ARRAY['first_time'::text, 'beginner'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT help_docs_category_slug_idx UNIQUE (category_id, slug),
    CONSTRAINT help_docs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.kyc_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    user_id uuid NOT NULL,
    doc_type text NOT NULL,
    storage_key text NOT NULL,
    content_type text,
    size_bytes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    upload_state text DEFAULT 'ready'::text NOT NULL,
    CONSTRAINT kyc_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['govt_id_front'::text, 'govt_id_back'::text, 'proof_of_address'::text, 'selfie'::text, 'nin_slip'::text, 'liveness_selfie'::text]))),
    CONSTRAINT kyc_documents_upload_state_check CHECK ((upload_state = ANY (ARRAY['uploading'::text, 'ready'::text]))),
    CONSTRAINT kyc_documents_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.kyc_documents FORCE ROW LEVEL SECURITY;

CREATE TABLE public.kyc_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tier integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    account_type text DEFAULT 'individual'::text NOT NULL,
    citizenship_country text,
    review_mode text DEFAULT 'manual'::text NOT NULL,
    bvn_last4 text,
    paystack_customer_code text,
    paystack_verification_status text,
    bvn_matched_name_encrypted text,
    id_type text,
    id_number_encrypted text,
    submitted_full_name text,
    ai_name_match_score numeric(4,3),
    ai_document_confidence numeric(4,3),
    ai_provider text,
    ai_notes text,
    ai_escalated boolean DEFAULT false NOT NULL,
    video_url text,
    liveness_status text,
    liveness_score numeric(4,3),
    liveness_notes text,
    reuse_previous_address boolean,
    updated_address jsonb,
    physical_verification_scheduled_at timestamp with time zone,
    physical_verification_notes text,
    credits_charged integer DEFAULT 0 NOT NULL,
    credit_ledger_reference_id text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kyc_submissions_account_type_check CHECK ((account_type = ANY (ARRAY['individual'::text, 'business'::text]))),
    CONSTRAINT kyc_submissions_review_mode_check CHECK ((review_mode = ANY (ARRAY['ai'::text, 'manual'::text]))),
    CONSTRAINT kyc_submissions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ai_review'::text, 'manual_review'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT kyc_submissions_tier_check CHECK ((tier = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT kyc_submissions_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.kyc_submissions FORCE ROW LEVEL SECURITY;

CREATE TABLE public.leaderboard_rank_snapshots (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    rank integer NOT NULL,
    xp bigint DEFAULT 0 NOT NULL,
    snapped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leaderboard_rank_snapshots_pkey PRIMARY KEY (id),
    CONSTRAINT leaderboard_rank_snapshots_user_id_scope_key UNIQUE (user_id, scope)
);

CREATE TABLE public.leaderboard_snapshots (
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
    rank integer,
    CONSTRAINT leaderboard_snapshots_pkey PRIMARY KEY (id),
    CONSTRAINT leaderboard_snapshots_user_id_track_scope_city_season_id_key UNIQUE (user_id, track, scope, city, season_id)
);

CREATE TABLE public.learning_certificates (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    certificate_url text,
    metadata jsonb,
    room_id uuid,
    recipient_user_id uuid,
    issuer_user_id uuid,
    title text,
    note text,
    CONSTRAINT learning_certificates_pkey PRIMARY KEY (id)
);

CREATE TABLE public.merch_orders (
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
    CONSTRAINT merch_orders_status_check CHECK ((status = ANY (ARRAY['awaiting_payment'::text, 'pending'::text, 'shipped'::text, 'in_transit'::text, 'delivered'::text, 'completed'::text, 'refunded'::text]))),
    CONSTRAINT merch_orders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.merch_product_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    order_id uuid,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merch_product_reviews_rating_range CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT merch_product_reviews_one_per_buyer UNIQUE (product_id, buyer_id),
    CONSTRAINT merch_product_reviews_pkey PRIMARY KEY (id)
);

CREATE TABLE public.merch_products (
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
    referral_enabled boolean DEFAULT false NOT NULL,
    referral_commission_pct numeric(5,2),
    is_sponsored boolean DEFAULT false NOT NULL,
    sponsored_until timestamp with time zone,
    is_admin_featured boolean DEFAULT false NOT NULL,
    CONSTRAINT merch_products_product_type_check CHECK ((product_type = ANY (ARRAY['digital'::text, 'physical'::text, 'course_material'::text]))),
    CONSTRAINT merch_products_referral_pct_min CHECK (((referral_commission_pct IS NULL) OR (referral_commission_pct >= 1.00))),
    CONSTRAINT merch_products_pkey PRIMARY KEY (id)
);

CREATE TABLE public.merch_stores (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    physical_goods_enabled boolean DEFAULT false,
    default_fulfillment_method text DEFAULT 'manual'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT merch_stores_default_fulfillment_method_check CHECK ((default_fulfillment_method = ANY (ARRAY['manual'::text, 'partner'::text]))),
    CONSTRAINT merch_stores_creator_id_key UNIQUE (creator_id),
    CONSTRAINT merch_stores_pkey PRIMARY KEY (id)
);

CREATE TABLE public.message_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    is_custom boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji),
    CONSTRAINT message_reactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.messages (
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
    CONSTRAINT messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text, 'gift'::text, 'moment'::text, 'system'::text, 'broadcast'::text]))),
    CONSTRAINT messages_pkey PRIMARY KEY (id)
);

ALTER TABLE ONLY public.messages FORCE ROW LEVEL SECURITY;

CREATE TABLE public.moderation_actions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    target_user_id uuid,
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
    CONSTRAINT moderation_actions_action_type_check CHECK ((action_type = ANY (ARRAY['warn'::text, 'suspend'::text, 'ban'::text, 'remove_content'::text, 'escalate'::text, 'dismiss'::text, 'suspend_user'::text, 'ban_user'::text, 'escalate_ai'::text, 'mute_member'::text, 'kick_member'::text]))),
    CONSTRAINT moderation_actions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.moderation_ai_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    provider text NOT NULL,
    verdict text NOT NULL,
    confidence numeric(4,3) NOT NULL,
    reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_ai_escalations_verdict_check CHECK ((verdict = ANY (ARRAY['violation'::text, 'borderline'::text, 'no_violation'::text]))),
    CONSTRAINT moderation_ai_escalations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.moderation_report_reporters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    is_first boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT moderation_report_reporters_pkey PRIMARY KEY (id),
    CONSTRAINT moderation_report_reporters_report_id_reporter_id_key UNIQUE (report_id, reporter_id)
);

CREATE TABLE public.moderation_reports (
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
    reported_bb_thread_id uuid,
    reported_bb_post_id uuid,
    deleted_at timestamp with time zone,
    reported_guild_message_id uuid,
    cluster_key text,
    duplicate_count integer DEFAULT 1 NOT NULL,
    is_malicious boolean DEFAULT false NOT NULL,
    reward_applied boolean DEFAULT false NOT NULL,
    auto_quarantined boolean DEFAULT false NOT NULL,
    reported_poll_id uuid,
    reported_quiz_id uuid,
    reported_tweet_id uuid,
    reported_wiki_id uuid,
    reported_wiki_page_id uuid,
    reported_tale_id uuid,
    reported_tale_chapter_id uuid,
    CONSTRAINT moderation_reports_pipeline_status_check CHECK ((pipeline_status = ANY (ARRAY['ai_auto_actioned'::text, 'community_review'::text, 'manual_queue'::text, 'resolved'::text]))),
    CONSTRAINT moderation_reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.moment_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    moment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT moment_reactions_moment_id_user_id_key UNIQUE (moment_id, user_id),
    CONSTRAINT moment_reactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.moment_views (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    moment_id uuid NOT NULL,
    viewer_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT moment_views_moment_id_viewer_id_key UNIQUE (moment_id, viewer_id),
    CONSTRAINT moment_views_pkey PRIMARY KEY (id)
);

CREATE TABLE public.moments (
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
    CONSTRAINT moments_content_type_check CHECK ((content_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text]))),
    CONSTRAINT moments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.monthly_gift_drops (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    gift_item_id uuid,
    title text NOT NULL,
    available_from timestamp with time zone NOT NULL,
    available_until timestamp with time zone NOT NULL,
    announced_at timestamp with time zone,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT monthly_gift_drops_pkey PRIMARY KEY (id)
);

CREATE TABLE public.nemesis_assignments (
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
    last_notified_at timestamp with time zone,
    CONSTRAINT nemesis_assignments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.nemesis_challenges (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    challenger_id uuid NOT NULL,
    challenged_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nemesis_challenges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'completed'::text, 'expired'::text]))),
    CONSTRAINT nemesis_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE public.new_member_quest_dismissals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    dismiss_count integer DEFAULT 0 NOT NULL,
    last_dismissed_at timestamp with time zone,
    dont_remind_again boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT new_member_quest_dismissals_pkey PRIMARY KEY (id),
    CONSTRAINT new_member_quest_dismissals_user_unique UNIQUE (user_id)
);

CREATE TABLE public.new_member_quests (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    quest_type text DEFAULT 'new_member'::text NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    reward_claimed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT new_member_quests_pkey PRIMARY KEY (id),
    CONSTRAINT new_member_quests_user_id_quest_type_key UNIQUE (user_id, quest_type)
);

CREATE TABLE public.notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notice_type text DEFAULT 'custom'::text NOT NULL,
    title text NOT NULL,
    body text,
    icon text,
    image_url text,
    cta_label text,
    cta_url text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notices_notice_type_check CHECK ((notice_type = ANY (ARRAY['season'::text, 'event'::text, 'admin_news'::text, 'custom'::text]))),
    CONSTRAINT notices_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notifications (
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
    reference_id text,
    CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.object_deletion_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    storage_key text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT object_deletion_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT object_deletion_tasks_storage_key_key UNIQUE (storage_key)
);

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE public.payment_context_settings (
    context_key text NOT NULL,
    paystack_enabled boolean DEFAULT true NOT NULL,
    crypto_enabled_currencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_free boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_context_settings_pkey PRIMARY KEY (context_key)
);

CREATE TABLE public.payments (
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
    chain text,
    token_symbol text,
    tx_hash text,
    wallet_address text,
    expected_token_amount numeric(38,0),
    sender_address text,
    CONSTRAINT payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['coin_purchase'::text, 'star_purchase'::text, 'subscription'::text, 'season_pass'::text, 'booster_pack'::text, 'room_entry'::text, 'room_subscription'::text, 'business_upgrade'::text, 'merch_purchase'::text]))),
    CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['paystack'::text, 'dodopayments'::text, 'google_play'::text, 'crypto'::text, 'free'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text, 'underpaid'::text]))),
    CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT payments_pkey PRIMARY KEY (id),
    CONSTRAINT payments_provider_reference_key UNIQUE (provider_reference)
);

ALTER TABLE ONLY public.payments FORCE ROW LEVEL SECURITY;

CREATE TABLE public.payout_dead_letter_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    failure_reason text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_attempted_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payout_dead_letter_queue_pkey PRIMARY KEY (id),
    CONSTRAINT uq_pdlq_payout_id UNIQUE (payout_id)
);

CREATE TABLE public.phone_verification_codes (
    user_id uuid NOT NULL,
    phone_number text NOT NULL,
    code_hash text NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT phone_verification_codes_pkey PRIMARY KEY (user_id)
);

ALTER TABLE ONLY public.phone_verification_codes FORCE ROW LEVEL SECURITY;

CREATE TABLE public.platform_council_ideas (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    votes integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    CONSTRAINT platform_council_ideas_status_check CHECK ((status = ANY (ARRAY['open'::text, 'selected'::text, 'implemented'::text, 'rejected'::text]))),
    CONSTRAINT platform_council_ideas_pkey PRIMARY KEY (id)
);

CREATE TABLE public.platform_council_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    cycle_month text NOT NULL,
    legacy_score bigint NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone,
    CONSTRAINT platform_council_members_pkey PRIMARY KEY (id),
    CONSTRAINT platform_council_members_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.platform_events (
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
    recurrence_interval text DEFAULT 'none'::text NOT NULL,
    CONSTRAINT platform_events_event_type_check CHECK ((event_type = ANY (ARRAY['cultural'::text, 'season_launch'::text, 'flash_xp'::text, 'guild_war_event'::text, 'mystery_drop'::text, 'platform'::text]))),
    CONSTRAINT platform_events_recurrence_interval_check CHECK ((recurrence_interval = ANY (ARRAY['none'::text, 'monthly'::text, 'yearly'::text]))),
    CONSTRAINT platform_events_name_key UNIQUE (name),
    CONSTRAINT platform_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.play_purchase_receipts (
    token_hash text NOT NULL,
    user_id uuid,
    product_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT play_purchase_receipts_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT play_purchase_receipts_pkey PRIMARY KEY (token_hash)
);

CREATE TABLE public.poll_options (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    poll_id uuid NOT NULL,
    label text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    vote_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT poll_options_pkey PRIMARY KEY (id)
);

CREATE TABLE public.poll_votes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    poll_id uuid NOT NULL,
    option_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT poll_votes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.polls (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    allow_multiple boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    closes_at timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    voter_count integer DEFAULT 0 NOT NULL,
    share_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT polls_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'disabled'::text]))),
    CONSTRAINT polls_pkey PRIMARY KEY (id)
);

CREATE TABLE public.portal_follows (
    portal_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_follows_pkey PRIMARY KEY (portal_id, user_id)
);

CREATE TABLE public.portal_stats_daily (
    portal_id uuid NOT NULL,
    day date DEFAULT CURRENT_DATE NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    follows integer DEFAULT 0 NOT NULL,
    CONSTRAINT portal_stats_daily_pkey PRIMARY KEY (portal_id, day)
);

CREATE TABLE public.portals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    hashtag_id uuid NOT NULL,
    title text NOT NULL,
    tagline text,
    description text,
    cover_image_url text,
    accent_color text,
    status text DEFAULT 'auto'::text NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    bb_board_id uuid,
    city text,
    is_pinned boolean DEFAULT false NOT NULL,
    boost_weight smallint DEFAULT 0 NOT NULL,
    boost_starts_at timestamp with time zone,
    boost_ends_at timestamp with time zone,
    sponsored_until timestamp with time zone,
    sponsor_name text,
    follower_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portals_accent_color_check CHECK (((accent_color IS NULL) OR (accent_color ~ '^#[0-9a-fA-F]{6}$'::text))),
    CONSTRAINT portals_boost_weight_check CHECK (((boost_weight >= 0) AND (boost_weight <= 100))),
    CONSTRAINT portals_slug_format CHECK (((slug = lower(slug)) AND ((char_length(slug) >= 2) AND (char_length(slug) <= 50)))),
    CONSTRAINT portals_status_check CHECK ((status = ANY (ARRAY['official'::text, 'auto'::text, 'archived'::text, 'suppressed'::text]))),
    CONSTRAINT portals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.profile_themes (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    included_for_plans text[] DEFAULT '{}'::text[] NOT NULL,
    included_for_business_tiers text[] DEFAULT '{}'::text[] NOT NULL,
    is_free_default boolean DEFAULT false NOT NULL,
    store_item_id uuid,
    credits_cost integer,
    stars_cost integer,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profile_themes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.push_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ticket_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    receipt_id text,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_at timestamp with time zone,
    resolved_at timestamp with time zone,
    token text,
    CONSTRAINT push_tickets_pkey PRIMARY KEY (id),
    CONSTRAINT push_tickets_ticket_id_key UNIQUE (ticket_id)
);

CREATE TABLE public.quest_feature_boosts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature_key text NOT NULL,
    weight_multiplier numeric(6,2) DEFAULT 2.0 NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quest_feature_boosts_range_check CHECK ((ends_at > starts_at)),
    CONSTRAINT quest_feature_boosts_weight_check CHECK ((weight_multiplier > (0)::numeric)),
    CONSTRAINT quest_feature_boosts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.quest_templates (
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
    created_at timestamp with time zone DEFAULT now(),
    feature_key text,
    sponsored_quest_id uuid,
    CONSTRAINT quest_templates_pkey PRIMARY KEY (id),
    CONSTRAINT quest_templates_title_key UNIQUE (title)
);

CREATE TABLE public.quiz_attempt_answers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    attempt_id uuid NOT NULL,
    question_id uuid NOT NULL,
    selected_option_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    CONSTRAINT quiz_attempt_answers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.quiz_attempts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quiz_id uuid NOT NULL,
    user_id uuid NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    total_points integer DEFAULT 0 NOT NULL,
    score_percent integer DEFAULT 0 NOT NULL,
    passed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT quiz_attempts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.quiz_question_options (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    question_id uuid NOT NULL,
    label text NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT quiz_question_options_pkey PRIMARY KEY (id)
);

CREATE TABLE public.quiz_questions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    quiz_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    prompt text NOT NULL,
    type text DEFAULT 'single'::text NOT NULL,
    points integer DEFAULT 1 NOT NULL,
    CONSTRAINT quiz_questions_type_check CHECK ((type = ANY (ARRAY['single'::text, 'multiple'::text, 'true_false'::text]))),
    CONSTRAINT quiz_questions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.quizzes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    creator_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    passing_score_percent integer DEFAULT 60 NOT NULL,
    max_attempts_per_user integer DEFAULT 1 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    share_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT quizzes_passing_score_check CHECK (((passing_score_percent >= 0) AND (passing_score_percent <= 100))),
    CONSTRAINT quizzes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'disabled'::text]))),
    CONSTRAINT quizzes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.rank_up_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    rank_from text NOT NULL,
    rank_to text NOT NULL,
    xp_at_event bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rank_up_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.rank_up_events_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    rank_from text,
    rank_to text,
    xp_at_event bigint,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rank_up_events_archive_pkey PRIMARY KEY (id)
)
WITH (fillfactor='100');

CREATE TABLE public.reaction_set_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_id uuid NOT NULL,
    emoji text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT reaction_set_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reaction_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    coin_price integer DEFAULT 100 NOT NULL,
    preview_emoji text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reaction_sets_pkey PRIMARY KEY (id)
);

CREATE TABLE public.referral_commissions (
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
    tier integer DEFAULT 1 NOT NULL,
    source_type text DEFAULT 'coin_purchase'::text NOT NULL,
    reference_order_id uuid,
    CONSTRAINT referral_commissions_pkey PRIMARY KEY (id),
    CONSTRAINT referral_commissions_trigger_event_id_key UNIQUE (trigger_event_id)
);

CREATE TABLE public.referral_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    code text NOT NULL,
    path text NOT NULL,
    visitor_key text NOT NULL,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    visited_date date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT referral_visits_pkey PRIMARY KEY (id)
);

CREATE TABLE public.referrals (
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
    CONSTRAINT referrals_tier_check CHECK ((tier = ANY (ARRAY[1, 2]))),
    CONSTRAINT referrals_pkey PRIMARY KEY (id),
    CONSTRAINT referrals_referrer_id_referred_id_key UNIQUE (referrer_id, referred_id)
);

CREATE UNIQUE INDEX referrals_one_direct_referrer ON public.referrals (referred_id) WHERE tier=1;

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount_coins bigint NOT NULL,
    reason text,
    reference_id text,
    status text DEFAULT 'processed'::text NOT NULL,
    processed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT refunds_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reports (
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
    reported_poll_id uuid,
    reported_quiz_id uuid,
    reported_tweet_id uuid,
    reported_wiki_id uuid,
    reported_wiki_page_id uuid,
    CONSTRAINT reports_report_type_check CHECK ((report_type = ANY (ARRAY['harassment'::text, 'spam'::text, 'fraud'::text, 'sexual_content'::text, 'impersonation'::text, 'hate_speech'::text, 'other'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'resolved_action'::text, 'resolved_dismissed'::text, 'escalated'::text]))),
    CONSTRAINT reports_pkey PRIMARY KEY (id)
);

CREATE TABLE public.restore_email_tasks (
    user_id uuid NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    delivered_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT restore_email_tasks_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.room_member_highlights (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    highlighted_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_member_highlights_pkey PRIMARY KEY (id),
    CONSTRAINT room_member_highlights_room_id_user_id_key UNIQUE (room_id, user_id)
);

CREATE TABLE public.room_members (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    is_muted boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    left_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_members_role_check CHECK ((role = ANY (ARRAY['creator'::text, 'admin'::text, 'co_moderator'::text, 'member'::text]))),
    CONSTRAINT room_members_pkey PRIMARY KEY (id),
    CONSTRAINT room_members_room_id_user_id_key UNIQUE (room_id, user_id)
);

CREATE TABLE public.room_message_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji),
    CONSTRAINT room_message_reactions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.room_messages (
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
    CONSTRAINT room_messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'sticker'::text, 'gif'::text, 'gift'::text, 'moment'::text, 'system'::text, 'broadcast'::text]))),
    CONSTRAINT room_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.room_moderation_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    moderator_id uuid NOT NULL,
    target_user_id uuid,
    action text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_moderation_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.room_monthly_active_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    month date NOT NULL,
    mau_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_monthly_active_users_pkey PRIMARY KEY (id),
    CONSTRAINT room_monthly_active_users_room_id_month_key UNIQUE (room_id, month)
);

CREATE TABLE public.room_pins (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_pins_pkey PRIMARY KEY (id),
    CONSTRAINT room_pins_user_id_room_id_key UNIQUE (user_id, room_id)
);

CREATE TABLE public.room_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    promoted_by uuid,
    coin_cost integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_promotions_pkey PRIMARY KEY (id),
    CONSTRAINT room_promotions_room_id_key UNIQUE (room_id)
);

CREATE TABLE public.room_subscriptions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    amount_kobo bigint,
    started_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT room_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text]))),
    CONSTRAINT room_subscriptions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.room_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    room_id uuid NOT NULL,
    last_visited_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_visits_pkey PRIMARY KEY (id),
    CONSTRAINT room_visits_user_id_room_id_key UNIQUE (user_id, room_id)
);

CREATE TABLE public.rooms (
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
    classroom_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_in_creator_listing boolean DEFAULT true NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT rooms_enrolment_fee_ngn_max CHECK (((enrolment_fee_ngn IS NULL) OR (enrolment_fee_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_entry_fee_kobo_max CHECK (((entry_fee_kobo IS NULL) OR (entry_fee_kobo <= '1000000000000'::bigint))),
    CONSTRAINT rooms_entry_fee_ngn_max CHECK (((entry_fee_ngn IS NULL) OR (entry_fee_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_public_requires_slug CHECK ((NOT ((is_public = true) AND (slug IS NULL)))),
    CONSTRAINT rooms_subscription_price_kobo_max CHECK (((subscription_price_kobo IS NULL) OR (subscription_price_kobo <= '1000000000000'::bigint))),
    CONSTRAINT rooms_subscription_price_ngn_max CHECK (((subscription_price_ngn IS NULL) OR (subscription_price_ngn <= '1000000000000'::bigint))),
    CONSTRAINT rooms_type_check CHECK ((type = ANY (ARRAY['free_open'::text, 'vip'::text, 'drop'::text, 'tipping'::text, 'classroom'::text, 'guild'::text, 'limited'::text]))),
    CONSTRAINT rooms_pkey PRIMARY KEY (id)
);

CREATE TABLE public.season_pass_milestones (
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
    CONSTRAINT season_pass_milestones_required_plan_check CHECK ((required_plan = ANY (ARRAY['pro'::text, 'max'::text]))),
    CONSTRAINT season_pass_milestones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.season_rank_archives (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    season_id uuid NOT NULL,
    user_id uuid NOT NULL,
    final_rank integer,
    final_season_xp bigint DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone DEFAULT now(),
    CONSTRAINT season_rank_archives_pkey PRIMARY KEY (id),
    CONSTRAINT season_rank_archives_season_id_user_id_key UNIQUE (season_id, user_id)
);

CREATE TABLE public.seasons (
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
    rankings_reset_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT seasons_pkey PRIMARY KEY (id)
);

CREATE TABLE public.site_contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_user_id uuid,
    sender_name text,
    sender_email text,
    subject text,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT site_contact_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.slug_redirects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    old_slug text NOT NULL,
    entity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slug_redirects_entity_type_check CHECK ((entity_type = ANY (ARRAY['room'::text, 'game'::text, 'forum_question'::text, 'help_doc'::text, 'help_category'::text]))),
    CONSTRAINT slug_redirects_entity_type_old_slug_key UNIQUE (entity_type, old_slug),
    CONSTRAINT slug_redirects_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sponsored_leaderboard_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sponsor_name text NOT NULL,
    sponsor_logo_url text,
    cta_text text NOT NULL,
    cta_url text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sponsored_leaderboard_banners_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sponsored_quest_applications (
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
    CONSTRAINT sponsored_quest_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'accepted'::text, 'completed'::text, 'approved'::text, 'rejected'::text, 'paid'::text]))),
    CONSTRAINT sponsored_quest_applications_pkey PRIMARY KEY (id),
    CONSTRAINT sponsored_quest_applications_quest_id_creator_id_key UNIQUE (quest_id, creator_id)
);

CREATE TABLE public.sponsored_quest_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quest_id uuid NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    cost_credits numeric(18,6) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sponsored_quest_events_type_check CHECK ((event_type = ANY (ARRAY['impression'::text, 'completion'::text]))),
    CONSTRAINT sponsored_quest_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sponsored_quests (
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
    deadline timestamp with time zone,
    business_account_id uuid,
    business_page_id uuid,
    submitted_by uuid,
    moderation_status text DEFAULT 'approved'::text NOT NULL,
    moderation_reason text,
    deleted_at timestamp with time zone,
    owner_user_id uuid,
    pause_reason text,
    paused_by uuid,
    paused_at timestamp with time zone,
    auto_paused boolean DEFAULT false NOT NULL,
    flag_status text DEFAULT 'none'::text NOT NULL,
    flag_category text,
    flag_reason text,
    flagged_by uuid,
    flagged_at timestamp with time zone,
    pricing_model text DEFAULT 'duration'::text NOT NULL,
    total_budget_credits numeric(18,6) DEFAULT 0 NOT NULL,
    spent_credits numeric(18,6) DEFAULT 0 NOT NULL,
    daily_budget_credits numeric(18,6),
    cpm_credits numeric(12,2) DEFAULT 500 NOT NULL,
    estimated_reach integer,
    impressions_count bigint DEFAULT 0 NOT NULL,
    completions_count bigint DEFAULT 0 NOT NULL,
    funded_by_user_id uuid,
    is_daily_quest_eligible boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sponsored_quests_budget_check CHECK (((total_budget_credits >= (0)::numeric) AND (spent_credits >= (0)::numeric))),
    CONSTRAINT sponsored_quests_flag_category_check CHECK (((flag_category IS NULL) OR (flag_category = ANY (ARRAY['spam'::text, 'scam'::text, 'other'::text])))),
    CONSTRAINT sponsored_quests_flag_status_check CHECK ((flag_status = ANY (ARRAY['none'::text, 'flagged'::text]))),
    CONSTRAINT sponsored_quests_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT sponsored_quests_pricing_model_check CHECK ((pricing_model = ANY (ARRAY['duration'::text, 'impression'::text, 'hybrid'::text]))),
    CONSTRAINT sponsored_quests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.staff_alert_contacts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    phone_number text,
    sms_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_alert_contacts_pkey PRIMARY KEY (id),
    CONSTRAINT staff_alert_contacts_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.star_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint DEFAULT 0 NOT NULL,
    balance_after bigint DEFAULT 0 NOT NULL,
    transaction_type text NOT NULL,
    description text,
    reference_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT star_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.star_ledger_archive (
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

CREATE TABLE public.sticker_packs (
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
    CONSTRAINT sticker_packs_pack_type_check CHECK ((pack_type = ANY (ARRAY['free'::text, 'earnable'::text, 'premium'::text]))),
    CONSTRAINT sticker_packs_name_key UNIQUE (name),
    CONSTRAINT sticker_packs_pkey PRIMARY KEY (id),
    CONSTRAINT sticker_packs_slug_key UNIQUE (slug)
);

CREATE TABLE public.stickers (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    pack_id uuid NOT NULL,
    name text NOT NULL,
    emoji text NOT NULL,
    image_url text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT stickers_pack_id_name_key UNIQUE (pack_id, name),
    CONSTRAINT stickers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.store_items (
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
    slug text,
    CONSTRAINT store_items_item_type_check CHECK ((item_type = ANY (ARRAY['coin_pack'::text, 'star_pack'::text, 'booster'::text, 'cosmetic'::text]))),
    CONSTRAINT store_items_name_key UNIQUE (name),
    CONSTRAINT store_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.subscription_cancellation_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan text,
    reasons text[] DEFAULT '{}'::text[] NOT NULL,
    follow_ups jsonb,
    general_feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_cancellation_feedback_pkey PRIMARY KEY (id)
);

CREATE TABLE public.subscription_plans (
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
    CONSTRAINT subscription_plans_interval_check CHECK (("interval" = ANY (ARRAY['monthly'::text, 'annual'::text]))),
    CONSTRAINT subscription_plans_pkey PRIMARY KEY (id),
    CONSTRAINT subscription_plans_plan_interval_uq UNIQUE (plan, "interval")
);

CREATE TABLE public.subscriptions (
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
    account_type_slug text,
    CONSTRAINT subscriptions_billing_period_check CHECK ((billing_period = ANY (ARRAY['monthly'::text, 'annual'::text]))),
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['plus'::text, 'pro'::text, 'max'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'expired'::text, 'paused'::text, 'trialing'::text, 'grace'::text, 'lapsed'::text]))),
    CONSTRAINT subscriptions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.support_ticket_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    actor_id uuid,
    event_type text NOT NULL,
    from_value text,
    to_value text,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_ticket_events_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'status_changed'::text, 'assigned'::text, 'escalated'::text, 'ai_response'::text, 'ai_rejected'::text, 'message_added'::text, 'charged'::text]))),
    CONSTRAINT support_ticket_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.support_ticket_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid,
    sender_type text DEFAULT 'user'::text NOT NULL,
    body text NOT NULL,
    charged boolean DEFAULT false NOT NULL,
    charged_credits integer DEFAULT 0 NOT NULL,
    charged_stars integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_ticket_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['user'::text, 'staff'::text, 'ai'::text]))),
    CONSTRAINT support_ticket_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subject text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    assigned_to uuid,
    is_ai_handled boolean DEFAULT false NOT NULL,
    ai_resolved boolean DEFAULT false NOT NULL,
    source text DEFAULT 'ticket'::text NOT NULL,
    source_help_doc_id uuid,
    charged_credits integer DEFAULT 0 NOT NULL,
    charged_stars integer DEFAULT 0 NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT support_tickets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT support_tickets_source_check CHECK ((source = ANY (ARRAY['ticket'::text, 'help_center_ai'::text]))),
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending'::text, 'escalated'::text, 'resolved'::text, 'closed'::text]))),
    CONSTRAINT support_tickets_pkey PRIMARY KEY (id)
);

CREATE TABLE public.system_alerts (
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
    title text NOT NULL,
    priority_level smallint NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    notify_admin boolean DEFAULT true NOT NULL,
    notify_mods boolean DEFAULT false NOT NULL,
    channels_sent jsonb DEFAULT '[]'::jsonb NOT NULL,
    escalation_stage integer DEFAULT 0 NOT NULL,
    escalation_cycle integer DEFAULT 0 NOT NULL,
    escalation_phase text DEFAULT 'backoff'::text NOT NULL,
    escalation_complete boolean DEFAULT false NOT NULL,
    next_escalation_at timestamp with time zone,
    first_notified_at timestamp with time zone,
    last_notified_at timestamp with time zone,
    sms_sent_count integer DEFAULT 0 NOT NULL,
    dedupe_key text,
    CONSTRAINT system_alerts_category_check CHECK ((category = ANY (ARRAY['site'::text, 'security'::text, 'financial'::text, 'moderation'::text, 'infra'::text, 'other'::text]))),
    CONSTRAINT system_alerts_escalation_phase_check CHECK ((escalation_phase = ANY (ARRAY['backoff'::text, 'daily'::text, 'weekly'::text, 'stopped'::text]))),
    CONSTRAINT system_alerts_priority_level_check CHECK (((priority_level IS NULL) OR ((priority_level >= 1) AND (priority_level <= 6)))),
    CONSTRAINT system_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT system_alerts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tale_account_restrictions (
    user_id uuid NOT NULL,
    state text NOT NULL,
    reason text NOT NULL,
    expires_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_account_restrictions_state_check CHECK ((state = ANY (ARRAY['active'::text, 'suspended'::text, 'banned'::text, 'demonetized'::text]))),
    CONSTRAINT tale_account_restrictions_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.tale_appeals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    target_version integer NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decision_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_appeals_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 4000))),
    CONSTRAINT tale_appeals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))),
    CONSTRAINT tale_appeals_target_type_check CHECK ((target_type = ANY (ARRAY['story'::text, 'chapter'::text, 'account'::text]))),
    CONSTRAINT tale_appeals_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tale_author_subscriptions (
    user_id uuid NOT NULL,
    author_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_author_subscriptions_check CHECK ((user_id <> author_id)),
    CONSTRAINT tale_author_subscriptions_pkey PRIMARY KEY (user_id, author_id)
);

CREATE TABLE public.tale_chapters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tale_id uuid NOT NULL,
    ordinal integer NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    price integer,
    status text DEFAULT 'draft'::text NOT NULL,
    publish_at timestamp with time zone,
    moderation text DEFAULT 'pending'::text NOT NULL,
    moderation_reason text,
    version integer DEFAULT 1 NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_chapters_check CHECK (((ordinal <> 1) OR (price IS NULL) OR (price = 0))),
    CONSTRAINT tale_chapters_moderation_check CHECK ((moderation = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT tale_chapters_ordinal_check CHECK ((ordinal > 0)),
    CONSTRAINT tale_chapters_price_check CHECK (((price >= 0) AND (price <= 1000000))),
    CONSTRAINT tale_chapters_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'scheduled'::text]))),
    CONSTRAINT tale_chapters_pkey PRIMARY KEY (id),
    CONSTRAINT tale_chapters_tale_id_ordinal_key UNIQUE (tale_id, ordinal)
);

CREATE TABLE public.tale_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tale_id uuid NOT NULL,
    chapter_id uuid,
    body text NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_comments_body_check CHECK (((length(body) >= 1) AND (length(body) <= 2000))),
    CONSTRAINT tale_comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tale_moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_moderation_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tale_unlocks (
    user_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    cost integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tale_unlocks_cost_check CHECK ((cost >= 0)),
    CONSTRAINT tale_unlocks_pkey PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE public.tale_votes (
    user_id uuid NOT NULL,
    tale_id uuid NOT NULL,
    CONSTRAINT tale_votes_pkey PRIMARY KEY (user_id, tale_id)
);

CREATE TABLE public.tales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    synopsis text DEFAULT ''::text NOT NULL,
    cover_url text,
    status text DEFAULT 'draft'::text NOT NULL,
    moderation text DEFAULT 'pending'::text NOT NULL,
    moderation_reason text,
    version integer DEFAULT 1 NOT NULL,
    comments_enabled boolean DEFAULT true NOT NULL,
    default_price integer DEFAULT 0 NOT NULL,
    notify_subscribers boolean DEFAULT false NOT NULL,
    votes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT tales_default_price_check CHECK (((default_price >= 0) AND (default_price <= 1000000))),
    CONSTRAINT tales_moderation_check CHECK ((moderation = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT tales_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'removed'::text]))),
    CONSTRAINT tales_pkey PRIMARY KEY (id),
    CONSTRAINT tales_slug_key UNIQUE (slug)
);

CREATE TABLE public.telegram_delivery_queue (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    broadcast_id uuid,
    telegram_ids jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    delivered_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT telegram_delivery_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text]))),
    CONSTRAINT telegram_delivery_queue_pkey PRIMARY KEY (id)
);

CREATE TABLE public.telegram_login_states (
    state text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    token text,
    user_payload text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL,
    CONSTRAINT telegram_login_states_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'expired'::text]))),
    CONSTRAINT telegram_login_states_pkey PRIMARY KEY (state)
);

CREATE TABLE public.track_milestone_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    track text NOT NULL,
    milestone_level integer NOT NULL,
    unlock_key text,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT track_milestone_unlocks_pkey PRIMARY KEY (id),
    CONSTRAINT track_milestone_unlocks_user_id_track_milestone_level_key UNIQUE (user_id, track, milestone_level)
);

CREATE TABLE public.tweet_likes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tweet_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tweet_likes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tweet_mentions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tweet_id uuid NOT NULL,
    mentioned_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tweet_mentions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tweet_retweets (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tweet_id uuid NOT NULL,
    user_id uuid NOT NULL,
    quote_content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tweet_retweets_quote_length CHECK (((quote_content IS NULL) OR (char_length(quote_content) <= 7000))),
    CONSTRAINT tweet_retweets_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tweets (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    parent_tweet_id uuid,
    content text,
    image_url text,
    video_provider text,
    video_url text,
    video_embed_id text,
    is_pinned boolean DEFAULT false NOT NULL,
    likes_count integer DEFAULT 0 NOT NULL,
    replies_count integer DEFAULT 0 NOT NULL,
    retweets_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT tweets_content_length CHECK (((content IS NULL) OR (char_length(content) <= 7000))),
    CONSTRAINT tweets_content_required CHECK (((content IS NOT NULL) OR (image_url IS NOT NULL) OR (video_provider IS NOT NULL))),
    CONSTRAINT tweets_video_fields_consistent CHECK (((video_provider IS NULL) = (video_embed_id IS NULL))),
    CONSTRAINT tweets_video_provider_check CHECK (((video_provider IS NULL) OR (video_provider = ANY (ARRAY['youtube'::text, 'tiktok'::text])))),
    CONSTRAINT tweets_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_announcement_rotation (
    user_id uuid NOT NULL,
    content_type text NOT NULL,
    last_shown_id uuid NOT NULL,
    last_shown_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_announcement_rotation_content_type_check CHECK ((content_type = ANY (ARRAY['modal'::text, 'banner'::text]))),
    CONSTRAINT user_announcement_rotation_pkey PRIMARY KEY (user_id, content_type)
);

CREATE TABLE public.user_badges (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    badge_type text,
    badge_key text,
    reference_id text,
    metadata jsonb,
    awarded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_badges_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_banner_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    banner_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_banner_views_pkey PRIMARY KEY (id),
    CONSTRAINT user_banner_views_user_id_banner_id_key UNIQUE (user_id, banner_id)
);

CREATE TABLE public.user_blocks (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id)),
    CONSTRAINT user_blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id),
    CONSTRAINT user_blocks_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_cosmetics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    store_item_id uuid NOT NULL,
    cosmetic_type text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    metadata jsonb,
    CONSTRAINT user_cosmetics_pkey PRIMARY KEY (id),
    CONSTRAINT user_cosmetics_user_id_store_item_id_key UNIQUE (user_id, store_item_id)
);

CREATE TABLE public.user_crypto_wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_crypto_wallets_pkey PRIMARY KEY (id),
    CONSTRAINT user_crypto_wallets_user_id_chain_key UNIQUE (user_id, chain)
);

CREATE TABLE public.user_daily_logins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    login_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_daily_logins_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_email_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_email_preferences_pkey PRIMARY KEY (id),
    CONSTRAINT user_email_preferences_user_id_notification_type_key UNIQUE (user_id, notification_type)
);

CREATE TABLE public.user_inactivity_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    inactive_days integer NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    push_email_notified boolean DEFAULT false NOT NULL,
    telegram_notified boolean DEFAULT false NOT NULL,
    CONSTRAINT user_inactivity_events_pkey PRIMARY KEY (id),
    CONSTRAINT user_inactivity_events_user_id_inactive_days_created_at_key UNIQUE (user_id, inactive_days, created_at)
);

CREATE TABLE public.user_interests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    interest_tag text NOT NULL,
    source text NOT NULL,
    weight numeric(10,4) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_interests_source_check CHECK ((source = ANY (ARRAY['onboarding'::text, 'implicit'::text]))),
    CONSTRAINT user_interests_pkey PRIMARY KEY (id),
    CONSTRAINT user_interests_user_tag_source_unique UNIQUE (user_id, interest_tag, source)
);

CREATE TABLE public.user_messages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    sender_id uuid,
    recipient_id uuid NOT NULL,
    content text NOT NULL,
    message_type text DEFAULT 'direct'::text NOT NULL,
    reference_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_messages_message_type_check CHECK ((message_type = ANY (ARRAY['direct'::text, 'broadcast'::text, 'admin'::text, 'system'::text]))),
    CONSTRAINT user_messages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_modal_views (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    modal_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_modal_views_pkey PRIMARY KEY (id),
    CONSTRAINT user_modal_views_user_id_modal_id_key UNIQUE (user_id, modal_id)
);

CREATE TABLE public.user_pins (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    pin_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_pins_pkey PRIMARY KEY (id),
    CONSTRAINT user_pins_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.user_push_tokens (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    device_id character varying(255),
    ownership_key character varying(64) NOT NULL,
    CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_quest_decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quest_id uuid NOT NULL,
    assigned_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_quest_decks_pkey PRIMARY KEY (id),
    CONSTRAINT user_quest_decks_user_id_quest_id_assigned_date_key UNIQUE (user_id, quest_id, assigned_date)
);

CREATE TABLE public.user_quest_progress (
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
    CONSTRAINT chk_progress_nonneg CHECK ((progress_count >= 0)),
    CONSTRAINT user_quest_progress_pkey PRIMARY KEY (id),
    CONSTRAINT user_quest_progress_user_id_quest_id_quest_date_key UNIQUE (user_id, quest_id, quest_date)
);

CREATE TABLE public.user_reaction_sets (
    user_id uuid NOT NULL,
    set_id uuid NOT NULL,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_reaction_sets_pkey PRIMARY KEY (user_id, set_id)
);

CREATE TABLE public.user_season_milestone_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    milestone_id uuid NOT NULL,
    claimed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_season_milestone_claims_pkey PRIMARY KEY (id),
    CONSTRAINT user_season_milestone_claims_user_id_season_id_milestone_id_key UNIQUE (user_id, season_id, milestone_id)
);

CREATE TABLE public.user_season_passes (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    is_paid boolean DEFAULT false NOT NULL,
    season_xp bigint DEFAULT 0 NOT NULL,
    season_rank integer,
    purchased_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_season_passes_pkey PRIMARY KEY (id),
    CONSTRAINT user_season_passes_user_id_season_id_key UNIQUE (user_id, season_id)
);

CREATE TABLE public.user_sticker_packs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    pack_id uuid NOT NULL,
    acquired_at timestamp with time zone DEFAULT now(),
    unlocked_at timestamp with time zone,
    CONSTRAINT user_sticker_packs_pkey PRIMARY KEY (id),
    CONSTRAINT user_sticker_packs_user_id_pack_id_key UNIQUE (user_id, pack_id)
);

CREATE TABLE public.user_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'paystack'::text NOT NULL,
    provider_subscription_id text,
    status text DEFAULT 'active'::text NOT NULL,
    next_renewal_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT user_subscriptions_user_id_key UNIQUE (user_id)
);

CREATE TABLE public.user_titles (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    source text,
    is_active boolean DEFAULT false NOT NULL,
    awarded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_titles_pkey PRIMARY KEY (id),
    CONSTRAINT user_titles_user_id_title_key UNIQUE (user_id, title)
);

CREATE TABLE public.user_xp_boosters (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    multiplier integer DEFAULT 200 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    booster_type text,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT user_xp_boosters_pkey PRIMARY KEY (id)
);

CREATE TABLE public.username_change_history (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    old_username text NOT NULL,
    new_username text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    redirect_enabled boolean NOT NULL,
    reserved_until timestamp with time zone,
    cost_paid_credits integer DEFAULT 0 NOT NULL,
    cost_paid_stars integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT username_change_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.username_reservations (
    old_username text NOT NULL,
    previous_user_id uuid NOT NULL,
    redirect_to_username text,
    reserved_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT username_reservations_redirect_or_expiry_chk CHECK ((((redirect_to_username IS NOT NULL) AND (reserved_until IS NULL)) OR ((redirect_to_username IS NULL) AND (reserved_until IS NOT NULL)))),
    CONSTRAINT username_reservations_pkey PRIMARY KEY (old_username)
);

CREATE TABLE public.users (
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
    kyc_tier integer DEFAULT 0 NOT NULL,
    admin_magic_word_hash text,
    ad_wallet_balance bigint DEFAULT 0 NOT NULL,
    is_support boolean DEFAULT false NOT NULL,
    is_senior_support boolean DEFAULT false NOT NULL,
    group_invite_privacy text DEFAULT 'friends'::text NOT NULL,
    nemesis_opt_out boolean DEFAULT false NOT NULL,
    tweet_max_length integer,
    avatar_changed_at timestamp with time zone,
    active_profile_theme_id text DEFAULT 'classic'::text NOT NULL,
    is_ad_moderator boolean DEFAULT false NOT NULL,
    country_source text DEFAULT 'default'::text NOT NULL,
    currency_preference text,
    phone_number text,
    phone_verified_at timestamp with time zone,
    search_vector tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(username, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(display_name, ''::text)), 'A'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(bio, ''::text)), 'B'::"char"))) STORED,
    hide_from_leaderboards boolean DEFAULT false NOT NULL,
    account_type_slug text,
    contact_discovery_enabled boolean DEFAULT false NOT NULL,
    contact_discovery_consented_at timestamp with time zone,
    purged_at timestamp with time zone,
    session_valid_after timestamp with time zone DEFAULT '1970-01-01 00:00:00+00' NOT NULL,
    CONSTRAINT users_ban_type_check CHECK ((ban_type = ANY (ARRAY['temporary'::text, 'permanent'::text]))),
    CONSTRAINT users_coin_balance_max CHECK ((coin_balance <= '1000000000000'::bigint)),
    CONSTRAINT users_creator_tier_check CHECK ((creator_tier = ANY (ARRAY['rookie'::text, 'rising'::text, 'verified'::text, 'elite'::text, 'icon'::text]))),
    CONSTRAINT users_custom_crest_check CHECK ((char_length(custom_crest) <= 500)),
    CONSTRAINT users_dm_privacy_check CHECK ((dm_privacy = ANY (ARRAY['everyone'::text, 'friends_only'::text, 'nobody'::text]))),
    CONSTRAINT users_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'non_binary'::text, 'prefer_not_to_say'::text]))),
    CONSTRAINT users_group_invite_privacy_check CHECK ((group_invite_privacy = ANY (ARRAY['anybody'::text, 'friends'::text, 'nobody'::text]))),
    CONSTRAINT users_no_self_referral CHECK (((referred_by IS NULL) OR (referred_by <> id))),
    CONSTRAINT users_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text, 'max'::text]))),
    CONSTRAINT users_star_balance_max CHECK ((star_balance <= '1000000000000'::bigint)),
    CONSTRAINT users_trust_score_check CHECK (((trust_score >= 0) AND (trust_score <= 100))),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_google_id_key UNIQUE (google_id),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_referral_code_key UNIQUE (referral_code),
    CONSTRAINT users_telegram_id_key UNIQUE (telegram_id),
    CONSTRAINT users_username_key UNIQUE (username)
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;

CREATE TABLE public.war_contributions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    war_id uuid NOT NULL,
    user_id uuid NOT NULL,
    guild_id uuid NOT NULL,
    war_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT war_contributions_pkey PRIMARY KEY (id),
    CONSTRAINT war_contributions_war_id_user_id_key UNIQUE (war_id, user_id)
);

CREATE TABLE public.wiki_collaborators (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    wiki_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'contributor'::text NOT NULL,
    is_moderator boolean DEFAULT false NOT NULL,
    moderator_granted_by uuid,
    moderator_granted_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by uuid,
    page_edit_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_collaborators_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'moderator'::text, 'contributor'::text]))),
    CONSTRAINT wiki_collaborators_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text]))),
    CONSTRAINT wiki_collaborators_pkey PRIMARY KEY (id)
);

CREATE TABLE public.wiki_invites (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    wiki_id uuid NOT NULL,
    token text NOT NULL,
    invited_user_id uuid,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_invites_pkey PRIMARY KEY (id),
    CONSTRAINT wiki_invites_token_key UNIQUE (token)
);

CREATE TABLE public.wiki_moderation_log (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    moderator_id uuid NOT NULL,
    wiki_id uuid,
    page_id uuid,
    target_user_id uuid,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_moderation_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.wiki_page_revisions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    page_id uuid NOT NULL,
    revision_number integer NOT NULL,
    title text NOT NULL,
    content_markdown text NOT NULL,
    content_format text DEFAULT 'markdown'::text NOT NULL,
    edit_summary text,
    edited_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wiki_page_revisions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.wiki_pages (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    wiki_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    content_markdown text NOT NULL,
    content_html text NOT NULL,
    content_format text DEFAULT 'markdown'::text NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    revision_count integer DEFAULT 1 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    last_edited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char")) STORED,
    CONSTRAINT wiki_pages_content_format_check CHECK ((content_format = ANY (ARRAY['markdown'::text, 'plaintext'::text]))),
    CONSTRAINT wiki_pages_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'locked'::text]))),
    CONSTRAINT wiki_pages_pkey PRIMARY KEY (id)
);

CREATE TABLE public.wikis (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    owner_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    avatar_url text,
    cover_image_url text,
    contribute_policy text DEFAULT 'everyone'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    page_count integer DEFAULT 0 NOT NULL,
    contributor_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    edit_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT wikis_contribute_policy_check CHECK ((contribute_policy = ANY (ARRAY['everyone'::text, 'friends'::text, 'selected'::text]))),
    CONSTRAINT wikis_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'suspended'::text, 'banned'::text, 'deactivated'::text]))),
    CONSTRAINT wikis_pkey PRIMARY KEY (id)
);

CREATE TABLE public.x_manifest (
    key text NOT NULL,
    value text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT x_manifest_pkey PRIMARY KEY (key)
);

CREATE TABLE public.xp_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    xp_awarded integer NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xp_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.xp_events_archive (
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

CREATE TABLE public.xp_ledger (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    source text NOT NULL,
    reference_id text,
    base_amount bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT xp_ledger_pkey PRIMARY KEY (id)
);

CREATE TABLE public.xp_ledger_archive (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount bigint NOT NULL,
    track text DEFAULT 'main'::text NOT NULL,
    source text NOT NULL,
    reference_id text,
    base_amount bigint NOT NULL,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='100');

CREATE TABLE public.zobian_of_month (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    month date NOT NULL,
    user_id uuid NOT NULL,
    score numeric(18,4),
    is_admin_override boolean DEFAULT false NOT NULL,
    overridden_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT zobian_of_month_month_unique UNIQUE (month),
    CONSTRAINT zobian_of_month_pkey PRIMARY KEY (id)
);


-- Accounting history views


CREATE VIEW public.coin_ledger_history WITH (security_invoker='true') AS
 SELECT coin_ledger.id,
    coin_ledger.user_id,
    coin_ledger.amount
   FROM public.coin_ledger
UNION ALL
 SELECT coin_ledger_archive.id,
    coin_ledger_archive.user_id,
    coin_ledger_archive.amount
   FROM public.coin_ledger_archive;

CREATE VIEW public.star_ledger_history WITH (security_invoker='true') AS
 SELECT star_ledger.id,
    star_ledger.user_id,
    star_ledger.amount
   FROM public.star_ledger
UNION ALL
 SELECT star_ledger_archive.id,
    star_ledger_archive.user_id,
    star_ledger_archive.amount
   FROM public.star_ledger_archive;

CREATE VIEW public.xp_ledger_history WITH (security_invoker='true') AS
 SELECT xp_ledger.id,
    xp_ledger.user_id,
    xp_ledger.amount
   FROM public.xp_ledger
UNION ALL
 SELECT xp_ledger_archive.id,
    xp_ledger_archive.user_id,
    xp_ledger_archive.amount
   FROM public.xp_ledger_archive;


-- Object comments


COMMENT ON SCHEMA public IS 'standard public schema';

COMMENT ON COLUMN public.group_chat_members.credited_message_count IS 'Messages counted toward business_message_credit_threshold for this member in this group. Stops incrementing once the threshold is reached (one-time credit).';

COMMENT ON COLUMN public.group_chats.concurrent_cap IS 'Soft concurrent-presence cap override (mirrors rooms.max_members). NULL = use manifest groupChatCaps.concurrentDefault. Raised via paid capacity upgrade (POST /api/messages/group/[groupId]/capacity).';

COMMENT ON COLUMN public.group_chats.allow_any_member_invite IS 'Per-group override of manifest groupChatInvite.anyMemberCanInvite. NULL = use manifest default.';

COMMENT ON COLUMN public.guild_members.is_moderator IS 'Forum Mod (guild-scoped moderator) — assigned by the guild captain (or platform admin) at POST /api/guilds/[guildId]/moderators. No sitewide jurisdiction; capabilities are admin-configured at /gate44/moderation/settings (guildModActions.*).';

COMMENT ON COLUMN public.guilds.admin_notes IS 'Internal admin-only notes, not shown to guild members.';

COMMENT ON COLUMN public.system_alerts.priority_level IS 'ZB-ALERT-01: 1=Critical .. 6=Low. See lib/alerts/types.ts ALERT_PRIORITY_LEVELS. Defaults from legacy severity via trigger below.';

COMMENT ON COLUMN public.system_alerts.category IS 'Routing category: site, security, financial, moderation, infra, other. Financial alerts are admin-only regardless of level.';

COMMENT ON COLUMN public.system_alerts.escalation_phase IS 'backoff (hour-based schedule) -> daily -> weekly -> stopped.';

COMMENT ON COLUMN public.system_alerts.dedupe_key IS 'Optional caller-supplied key (e.g. cluster key for report spikes) used to fold repeat triggers into the same open alert instead of creating duplicates.';


-- Final reference/configuration rows (no demo accounts or historical UPDATEs).


INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('free', 'Free', '', 'personal', 'free', 0, 0, NULL, NULL, true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('plus', 'Plus', '', 'personal', 'plus', 50000, 500000, 'sub_plus_monthly', 'sub_plus_annual', true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('pro', 'Pro', '', 'personal', 'pro', 150000, 1500000, 'sub_pro_monthly', 'sub_pro_annual', true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('max', 'Max', '', 'personal', 'max', 350000, 3500000, 'sub_max_monthly', 'sub_max_annual', true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('business_starter', 'Business Starter', '', 'business', 'starter', 500000, 5000000, 'biz_starter_monthly', NULL, true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('business_growth', 'Business Growth', '', 'business', 'growth', 1500000, 15000000, 'biz_growth_monthly', NULL, true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_types (slug, name, description, kind, base_plan, monthly_price_kobo, annual_price_kobo, play_monthly_product_id, play_annual_product_id, is_active, built_in, revision, created_at, updated_at) VALUES ('business_enterprise', 'Business Enterprise', '', 'business', 'enterprise', 5000000, 50000000, 'biz_enterprise_monthly', NULL, true, true, 1, '2026-10-23 11:26:33.002753+00', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.profile_themes (id, name, description, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('classic', 'Classic', 'The original Zobia profile look.', '{"bg": "#0a0a0a", "card": "#171717", "text": "#fafafa", "muted": "#a3a3a3", "accent": "#14b8a6"}', '{}', '{}', true, NULL, NULL, NULL, true, 1, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.profile_themes (id, name, description, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('midnight', 'Midnight', 'A deep-blue skin with cool accents.', '{"bg": "#050912", "card": "#0f1a2e", "text": "#f1f5f9", "muted": "#93a3b8", "accent": "#3b82f6"}', '{plus,pro,max}', '{growth,enterprise}', false, 'b575f1af-f0c9-48fb-ae1b-be668ac9b477', 500, NULL, true, 2, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.profile_themes (id, name, description, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('sunset', 'Sunset', 'Warm oranges and pinks for a bold profile.', '{"bg": "#1a0f0a", "card": "#2a1810", "text": "#fef3e2", "muted": "#c9a68c", "accent": "#f97316"}', '{pro,max}', '{growth,enterprise}', false, '4b587f71-f7e2-4099-82f9-91bbbea403c6', 800, NULL, true, 3, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.profile_themes (id, name, description, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('emerald', 'Emerald', 'A rich green skin with gold highlights.', '{"bg": "#06120c", "card": "#0e2018", "text": "#ecfdf5", "muted": "#8fb8a5", "accent": "#10b981"}', '{max}', '{enterprise}', false, 'c9eb879b-60f9-4a63-a5ed-9ac4760353fe', 1200, NULL, true, 4, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('e0dd8f5f-5464-48b2-9b6c-aa850dad0ae4', 'Starter Pack', NULL, 'coin_pack', 20000, 'NGN', NULL, NULL, 100, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 1, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('75f06c03-cab5-4d3b-bcac-8d64857a6905', 'Regular Pack', NULL, 'coin_pack', 50000, 'NGN', NULL, NULL, 350, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 2, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('42ac3721-cf13-46b6-b2fe-1017dd189a25', 'Big Pack', NULL, 'coin_pack', 100000, 'NGN', NULL, NULL, 800, NULL, NULL, '+14% BONUS', true, true, false, NULL, NULL, NULL, 3, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('0d96a82e-4a14-494e-96fb-44d37fe2c8fb', 'Baller Pack', NULL, 'coin_pack', 200000, 'NGN', NULL, NULL, 1800, NULL, NULL, '+29% BONUS', false, true, false, NULL, NULL, NULL, 4, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('fd8549b5-c864-4849-a2d9-196a1dc4308b', 'Boss Pack', NULL, 'coin_pack', 500000, 'NGN', NULL, NULL, 5000, NULL, NULL, '+67% BONUS', false, true, false, NULL, NULL, NULL, 5, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('3bc42e2b-b5fd-42b3-a785-8194909cedbc', 'Legend Pack', NULL, 'coin_pack', 1000000, 'NGN', NULL, NULL, 11500, NULL, NULL, '+92% BONUS', false, true, false, NULL, NULL, NULL, 6, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('64006190-d9eb-4c62-a2f0-b3989c26b1d0', 'Starter Stars', NULL, 'star_pack', 200000, 'NGN', NULL, NULL, NULL, 5, NULL, NULL, false, true, false, NULL, NULL, NULL, 1, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('e467c29c-329e-4901-8ade-46940c4a43a9', 'Rising Stars', NULL, 'star_pack', 500000, 'NGN', NULL, NULL, NULL, 15, NULL, '+20% BONUS', true, true, false, NULL, NULL, NULL, 2, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('0bf9c8ad-c574-4bb2-9e87-809ed8da5d82', 'Star Bundle', NULL, 'star_pack', 1000000, 'NGN', NULL, NULL, NULL, 35, NULL, '+40% BONUS', false, true, false, NULL, NULL, NULL, 3, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('454e7f98-04c6-4b36-95a9-1985065cd043', 'Mega Stars', NULL, 'star_pack', 2500000, 'NGN', NULL, NULL, NULL, 100, NULL, '+67% BONUS', false, true, false, NULL, NULL, NULL, 4, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('1b8fc01c-a9cc-46f2-9113-1f303b62c85c', 'Prestige Flame Frame', 'Animated flame frame for Prestige users.', 'cosmetic', NULL, 'NGN', NULL, 5, NULL, NULL, 'profile_frame', NULL, true, true, true, NULL, NULL, NULL, 10, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('9d03b821-8cee-4633-afdb-82f0cba815dc', 'Golden Galaxy Frame', 'Rare animated gold particles around the avatar.', 'cosmetic', NULL, 'NGN', NULL, 10, NULL, NULL, 'profile_frame', NULL, false, true, true, NULL, NULL, NULL, 11, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('5bc28c5d-c054-4029-87b7-479d33cb4e4d', 'Phoenix Wings Border', 'Animated phoenix wings for Prestige holders.', 'cosmetic', NULL, 'NGN', NULL, 15, NULL, NULL, 'profile_frame', NULL, false, true, true, NULL, NULL, NULL, 12, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('5c27ed37-88f4-4708-a1dc-87af75502fc4', 'Diamond Glow Border', 'Pulsing diamond border animation.', 'cosmetic', NULL, 'NGN', NULL, 3, NULL, NULL, 'avatar_border', NULL, true, true, false, NULL, NULL, NULL, 20, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('829c93cf-47c0-4e27-9cd1-7d9d9b8feb8d', 'Neon Lagos Border', 'Neon-lit Lagos skyline avatar border.', 'cosmetic', NULL, 'NGN', NULL, 5, NULL, NULL, 'avatar_border', NULL, false, true, false, NULL, NULL, NULL, 21, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('c2cef152-d231-416e-9cdf-6e1032694ed4', 'First in the City', 'Display "First in the City" beneath your name.', 'cosmetic', NULL, 'NGN', NULL, 8, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 30, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('848d8c3b-d2da-4145-87ac-d6ceb291f84f', 'War Machine', 'Title for winning 10 Guild Wars.', 'cosmetic', NULL, 'NGN', NULL, 12, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 31, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('595981ee-9719-4cd7-88e0-8f36e5a1d608', 'The Patron', 'Top Gifter in 3+ Rooms — exclusive title.', 'cosmetic', NULL, 'NGN', NULL, 10, NULL, NULL, 'title', NULL, false, true, true, NULL, NULL, NULL, 32, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('6b10c966-f688-4b6b-ad86-cd7c9fa4ba81', 'Zobia Confetti Burst', 'Animated confetti when you send a message.', 'cosmetic', NULL, 'NGN', NULL, 2, NULL, NULL, 'animated_item', NULL, true, true, false, NULL, NULL, NULL, 40, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('280f7b6d-01b5-4dfa-98dd-328564b302cf', 'Gold Coin Rain', 'Gold coin shower on profile card.', 'cosmetic', NULL, 'NGN', NULL, 7, NULL, NULL, 'animated_item', NULL, false, true, false, NULL, NULL, NULL, 41, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('e8f8e288-c615-447a-8b84-6b759557e6af', 'Premium Send', 'Premium animation on your next message.', 'booster', NULL, 'NGN', 50, NULL, NULL, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 90, '{"subtype": "premium_send", "animation": "gold_shimmer", "duration_type": "one_shot"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('c3ef2e00-c20a-4e14-bd80-664c55b2758c', 'Premium Send — 7 Day Pass', 'Premium Send for 7 days.', 'booster', NULL, 'NGN', 250, NULL, NULL, NULL, NULL, NULL, false, true, false, NULL, NULL, NULL, 91, '{"subtype": "premium_send", "animation": "gold_shimmer", "duration_days": 7, "duration_type": "subscription"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('d565ecec-9a71-4370-acc1-866e346d990c', 'Editorial', 'A clean, magazine-style theme with a bold serif headline and generous whitespace.', 'cosmetic', 0, 'NGN', 500, NULL, NULL, NULL, 'blog_theme', NULL, true, true, false, NULL, NULL, NULL, 1, '{"accent": "#1f2937", "themeKey": "editorial"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('1b6d4a69-e72a-48b1-8c19-9ed3d43fc29f', 'Noir', 'A moody dark theme with a high-contrast accent, built for long-form storytelling.', 'cosmetic', 0, 'NGN', 800, NULL, NULL, NULL, 'blog_theme', NULL, true, true, false, NULL, NULL, NULL, 2, '{"accent": "#f59e0b", "themeKey": "noir"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('5772a517-b26f-4a4f-b3a4-42883883ffc7', 'Botanical', 'A warm, airy theme with soft greens and rounded cards — friendly for lifestyle blogs.', 'cosmetic', 0, 'NGN', 1200, NULL, NULL, NULL, 'blog_theme', NULL, false, true, false, NULL, NULL, NULL, 3, '{"accent": "#059669", "themeKey": "botanical"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('b575f1af-f0c9-48fb-ae1b-be668ac9b477', 'Midnight Profile Theme', 'A deep-blue profile skin with cool accents.', 'cosmetic', 0, 'NGN', 500, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, NULL, NULL, NULL, 60, '{"themeKey": "midnight"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('4b587f71-f7e2-4099-82f9-91bbbea403c6', 'Sunset Profile Theme', 'A warm orange/pink profile skin.', 'cosmetic', 0, 'NGN', 800, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, NULL, NULL, NULL, 61, '{"themeKey": "sunset"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.store_items (id, name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, season_id, prestige_required, valid_until, sort_order, metadata, created_at, updated_at, iap_product_id) VALUES ('c9eb879b-60f9-4a63-a5ed-9ac4760353fe', 'Emerald Profile Theme', 'A rich green profile skin with gold highlights.', 'cosmetic', 0, 'NGN', 1200, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, NULL, NULL, NULL, 62, '{"themeKey": "emerald"}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_plus_monthly', 'plus', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_pro_monthly', 'pro', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_max_monthly', 'max', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('biz_starter_monthly', 'business_starter', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('biz_growth_monthly', 'business_growth', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('biz_enterprise_monthly', 'business_enterprise', 'monthly', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_plus_annual', 'plus', 'annual', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_pro_annual', 'pro', 'annual', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.account_type_play_products (product_id, account_type_slug, "interval", created_at) VALUES ('sub_max_annual', 'max', 'annual', '2026-10-23 11:26:33.002753+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('11d9d648-7409-477c-9deb-7f1054cd53b7', 'room_instream', 'Room in-stream', 'native', 'Interleaved every N messages in free Room chat streams', true, 400.00, 10, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('e210ab2c-db05-4e8d-8d8a-97636e7bd447', 'feed_banner', 'Feed banner', '300x250', 'Home/Moments feed banner', true, 500.00, 20, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('5e899b4f-1c58-44ca-8779-c5c016118090', 'messages_banner', 'Messages banner', '320x50', 'Messages/DM list banner', true, 350.00, 30, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('25713bd7-700b-4d6e-9090-7f531a1b3cc1', 'games_banner', 'Games banner', '300x250', 'Games directory banner', true, 450.00, 40, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('bd258c57-3ce6-4224-91d6-d367d317b3c6', 'blog_inline', 'Blog inline native', 'native', 'Inline native ad inside Blog article body', true, 450.00, 50, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('44b61f63-6194-41bf-a91a-8f3ed3119be5', 'business_page_native', 'Business Page native', 'native', 'Native ad on Business Page feeds', true, 400.00, 60, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('6a1403f5-cbb1-4430-b76c-56a9292dce65', 'interstitial_global', 'Interstitial', 'interstitial', 'Full-screen interstitial shown between screens', true, 1500.00, 70, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('43d2ae13-3e76-4028-8382-6f26f36bf34d', 'rewarded_global', 'Rewarded video', 'rewarded', 'Opt-in rewarded video, pays the viewer in Credits', true, 1200.00, 80, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('5f03757b-102e-4af1-b89d-47a7c2f0c70a', 'content_boost', 'Content boost (native)', 'native', 'Generic sponsored-post placement for boosting any boostable content type inline in the Home Feed', true, 500.00, 15, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('29c1aa5d-25d2-4704-9c94-dc53fdbeef26', 'home_top', 'Home top banner', '300x250', 'Home Dashboard — above the notices carousel', true, 500.00, 90, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('44fb4433-e2bb-4217-bfed-57afd7bdf4eb', 'home_mid', 'Home mid banner', '300x250', 'Home Dashboard — between the notices carousel and the feed tabs', true, 500.00, 100, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('905cf144-cf8f-442e-b848-43bafc5db5ec', 'home_feed_native', 'Home feed native', 'native', 'Home Dashboard — interleaved every ~5-6 items inside each feed tab', true, 450.00, 110, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('169745d0-245f-41f5-aedd-7f2b9f408cd3', 'search_top', 'Search — top banner', '320x50', 'Shown above sitewide search results.', true, 500.00, 100, '2026-10-23 11:26:32.790958+00', '2026-10-23 11:26:32.790958+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('a4869b58-feda-4768-bdbd-a63accf10e05', 'search_after_3', 'Search — after 3rd result', 'native', 'Shown after the 3rd sitewide search result.', true, 500.00, 101, '2026-10-23 11:26:32.790958+00', '2026-10-23 11:26:32.790958+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('0fa9b295-1c8b-4fc1-9cf9-33850fce0084', 'search_after_8', 'Search — after 8th result', 'native', 'Shown after the 8th sitewide search result.', true, 500.00, 102, '2026-10-23 11:26:32.790958+00', '2026-10-23 11:26:32.790958+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('aed3b276-50a0-4052-adf5-1e5c5291da81', 'search_bottom', 'Search — bottom banner', '320x50', 'Shown below the last loaded sitewide search result.', true, 500.00, 103, '2026-10-23 11:26:32.790958+00', '2026-10-23 11:26:32.790958+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('04f5c9a1-64fa-4562-9ec0-c4f0eea2b16e', 'portal_top', 'Portal — top banner', '320x50', 'Shown under the header of a /h/<slug> portal page.', true, 500.00, 110, '2026-10-23 11:26:32.874734+00', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('1f758ac6-ca78-4b34-8d94-13c909bba65d', 'portal_after_3', 'Portal — after 3rd feed item', 'native', 'Shown after the 3rd item of a portal''s mini discovery feed.', true, 500.00, 111, '2026-10-23 11:26:32.874734+00', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.ad_placements (id, key, label, size, description, is_active, base_cpm_credits, sort_order, created_at, updated_at) VALUES ('5f892306-74f9-4feb-8e60-9509a90a205d', 'portal_bottom', 'Portal — bottom banner', '320x50', 'Shown at the bottom of a portal page.', true, 500.00, 112, '2026-10-23 11:26:32.874734+00', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.bb_boards (id, parent_id, slug, name, description, icon_emoji, sort_order, thread_count, post_count, last_post_at, is_active, created_at, updated_at) VALUES ('e7cf0e78-573f-46df-aae4-13bbdb259e61', NULL, 'general', 'General Discussion', 'Anything goes — introduce yourself, chat about the platform.', '💬', 1, 0, 0, NULL, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.bb_boards (id, parent_id, slug, name, description, icon_emoji, sort_order, thread_count, post_count, last_post_at, is_active, created_at, updated_at) VALUES ('5bea1e9a-11d8-4f35-b17f-e78e29718b61', NULL, 'help-support', 'Help & Support', 'Questions about using Zobia.', '🆘', 2, 0, 0, NULL, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.bb_boards (id, parent_id, slug, name, description, icon_emoji, sort_order, thread_count, post_count, last_post_at, is_active, created_at, updated_at) VALUES ('5467dbfd-e9f7-42fc-b27d-be93424da032', NULL, 'off-topic', 'Off-Topic', 'Everything else.', '🎲', 3, 0, 0, NULL, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('classic', 'Classic', 'The original single-column layout — clean and familiar.', 'classic', '{"bg": "#0a0a0a", "card": "#171717", "text": "#fafafa", "muted": "#a3a3a3", "accent": "#14b8a6"}', '{}', '{}', true, NULL, NULL, NULL, true, 1, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('minimal', 'Minimal Cards', 'A compact card grid with less metadata per post — quiet and fast to scan.', 'minimal-cards', '{"bg": "#0a0a0a", "card": "#171717", "text": "#fafafa", "muted": "#a3a3a3", "accent": "#e5e5e5"}', '{}', '{}', true, NULL, NULL, NULL, true, 2, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('editorial', 'Editorial', 'A magazine-style layout: a featured-post hero above a grid of post cards.', 'magazine', '{"bg": "#0a0a0a", "card": "#171717", "text": "#fafafa", "muted": "#a3a3a3", "accent": "#1f2937"}', '{pro,max}', '{growth,enterprise}', false, 'd565ecec-9a71-4370-acc1-866e346d990c', 500, NULL, true, 3, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('sidebar', 'Noir Sidebar', 'A moody dark theme with a left sidebar of categories and recent posts.', 'sidebar-left', '{"bg": "#000000", "card": "#111111", "text": "#fafafa", "muted": "#8a8a8a", "accent": "#f59e0b"}', '{max}', '{enterprise}', false, '1b6d4a69-e72a-48b1-8c19-9ed3d43fc29f', 800, NULL, true, 4, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order, created_at, updated_at) VALUES ('botanical', 'Botanical', 'A warm, airy card grid with soft greens — friendly for lifestyle blogs.', 'minimal-cards', '{"bg": "#0c1210", "card": "#132018", "text": "#f0fdf4", "muted": "#86a893", "accent": "#059669"}', '{}', '{}', false, '5772a517-b26f-4a4f-b3a4-42883883ffc7', 1200, NULL, true, 5, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.boost_types (id, key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_by, created_at, updated_at) VALUES ('17646fde-f325-4ab7-a205-519efb0a0e1d', 'xp_booster', 'XP Booster', '2x XP for 24 hours.', 200, 24, 200, NULL, NULL, false, true, 1, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.boost_types (id, key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_by, created_at, updated_at) VALUES ('65b87d7f-cd39-4313-9160-ad0fc594bc1c', 'quest_accelerator', 'Quest Accelerator', '1.5x XP for 7 days.', 150, 168, 800, NULL, NULL, false, true, 2, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.boost_types (id, key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_by, created_at, updated_at) VALUES ('a653ed02-dc0d-4127-baeb-cba54ada3277', 'guild_war_boost', 'Guild War Boost', '2x XP for the current Guild War (up to 30 days).', 200, 720, 1500, NULL, NULL, false, true, 3, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.boost_types (id, key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_by, created_at, updated_at) VALUES ('bcbe67a1-d416-4f7e-922c-bd4ddb2f009d', 'premium_send', 'Premium Send', 'One premium message send.', 0, 8760, 50, NULL, NULL, true, true, 4, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.boost_types (id, key, label, description, multiplier_bp, duration_hours, coins_cost, stars_cost, iap_product_id, stackable, is_active, sort_order, created_by, created_at, updated_at) VALUES ('50cf1271-f00d-41b3-8523-2d39ef2e242a', 'premium_send_7day', 'Premium Send Pass', '7-day premium send subscription.', 0, 168, 300, NULL, NULL, false, true, 5, NULL, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('3c327f35-217b-44a1-9a6b-3dccb00dc2ff', 'lagos', 'lagos', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('5ed3be35-4b1f-4592-8642-4f560411cf1c', 'abuja', 'abuja', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('8fb6af05-07de-4a3a-9846-b2e15622c33b', 'edo', 'edo', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('63fcd542-eb13-41bb-ba90-9319f3bd6be2', 'portharcourt', 'portharcourt', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('da8f40cb-48bf-4e61-a908-356fba58b764', 'ibadan', 'ibadan', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('816ccb54-c0b2-4bc5-ab7f-36b3d935806c', 'kano', 'kano', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('17e04548-60ef-4d81-916e-1839e09b60a2', 'accra', 'accra', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('4ac80a73-6196-41fd-b143-e565dc29e604', 'nairobi', 'nairobi', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('39afe8df-e051-4f62-933f-45b3f3087323', 'detroit', 'detroit', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('a21e54b6-e21c-4e98-845d-11da8d854f66', 'london', 'london', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('e6fe88eb-022f-49fd-a77d-85f71fc06602', 'uniben', 'uniben', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('e2bab237-ce1e-42c8-8915-042e42c4464a', 'unilag', 'unilag', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('dff74236-dfa0-490e-8a97-f71e733530a6', 'oau', 'oau', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('cf8b3c66-2872-469a-87b9-08294081df24', 'ui', 'ui', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('08dcfa2e-f800-4619-a0ef-a66a53c27dbd', 'abu', 'abu', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('08f0e460-6ff7-439a-ab42-d654cfba9fbe', 'unn', 'unn', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('49c4ef16-0adf-4327-9325-071de4e5776f', 'naija', 'naija', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('845fa9a4-8df1-4f7a-9707-14a1141902ef', 'afrobeats', 'afrobeats', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('da51b0e8-fe2e-498f-9836-030f772e3bd1', 'football', 'football', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('8c6a27fc-87c6-4ddf-84c6-d2ac98eb1631', 'food', 'food', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('d9e9edc1-2cdc-4e14-a946-a31a165f6eb5', 'jollof', 'jollof', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.hashtags (id, slug, display, alias_of, is_blocked, use_count, last_used_at, created_at) VALUES ('2a98d944-2930-4cfe-9a13-1c3f5b48ba8b', 'tech', 'tech', NULL, false, 0, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.cron_state (key, value_text, value_ts, updated_at) VALUES ('next_mystery_drop_at', NULL, '2026-09-20 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000001', 'general', 'General', 'Anything and everything — start here if you''re not sure where else it fits.', '💬', 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000002', 'relationships', 'Relationships & Dating', 'Love, friendship, family, and everything in between.', '❤️', 1, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000003', 'money-business', 'Money & Business', 'Side hustles, investing, careers, and building something of your own.', '💰', 2, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000004', 'tech', 'Tech & Gadgets', 'Phones, apps, the internet, and everything digital.', '🖥️', 3, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000006', 'entertainment', 'Entertainment & Culture', 'Music, movies, celebrity gist, and pop culture.', '🎵', 5, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000007', 'sports', 'Sports', 'Football, basketball, and everything competitive.', '🏆', 6, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000008', 'health', 'Health & Wellness', 'Fitness, mental health, and taking care of yourself.', '🌱', 7, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('00000000-0000-0000-0006-000000000005', 'schools-education', 'Schools and Education', 'Studying, exams, and school life.', '🎓', 4, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('e91db07d-0f94-4da6-9903-313b406a4c18', 'career-jobs', 'Career and Jobs', 'Job hunting, interviews, workplace advice, and figuring out what''s next.', '💼', 4, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.forum_categories (id, slug, name, description, icon_emoji, sort_order, created_at, updated_at) VALUES ('cf405674-c47a-4b30-9c05-cae5e194b0b7', 'religion-spirituality', 'Religion and Spirituality', 'Faith, belief, spiritual growth, and religious discussion.', '🙏', 8, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('0e332355-d3d2-4670-9692-632d1e06ac97', 'tetris', 'Zobia Tetris', 'Stack, clear, survive.', 'Classic falling-blocks puzzle. Clear lines to score.', NULL, '🧩', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'The timeless falling-blocks puzzle. Rotate and drop tetrominoes to complete horizontal lines. The more lines you clear at once, the bigger the score. How long can you last as the blocks speed up?', 'tetris', 1, 50, 40, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('cc3c8872-955a-407b-a86f-adb7aae53124', '2048', '2048', 'Merge to the magic number.', 'Slide tiles and merge matching numbers to reach 2048.', NULL, '🔢', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Slide numbered tiles on a grid; when two tiles with the same number touch they merge into one. Combine them to reach the 2048 tile — and keep going for a high score.', 'g2048', 2, 50, 40, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('031215ef-8ee0-4182-9e16-5b7d23ebe4c3', 'car-racing', 'Speed Dodge', 'Weave through traffic.', 'Dodge oncoming cars and survive as long as you can.', NULL, '🏎️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Action', 'A fast lane-dodging racer. Steer left and right to weave through endless oncoming traffic. The longer you survive and the faster you go, the higher your score.', 'carRacing', 1, 60, 50, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('f62ab63a-35eb-4031-a85a-3834a56de707', 'space-shooter', 'Star Blaster', 'Blast the asteroid field.', 'Pilot a ship and shoot down waves of asteroids.', NULL, '🚀', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Action', 'An arcade space shooter. Pilot your ship through an endless asteroid field, blasting rocks and dodging debris. Chain kills to rack up a high score.', 'spaceShooter', 2, 60, 50, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('b6f1aecc-5b44-4dc2-a846-10a3954be607', 'snake', 'Zobia Snake', 'Eat, grow, do not bite yourself.', 'Guide the snake to eat and grow without crashing.', NULL, '🐍', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'The classic snake game. Guide your ever-growing snake to eat food while avoiding the walls and your own tail. Each bite makes you longer — and the game harder.', 'snake', 1, 40, 35, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('42b0c649-fde0-4335-9eb3-027554153ba9', 'breakout', 'Brick Buster', 'Smash every brick.', 'Bounce the ball to break all the bricks.', NULL, '🧱', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'A brick-breaking arcade classic. Move the paddle to bounce the ball and smash every brick on the screen. Do not let the ball fall — clear the board for the highest score.', 'breakout', 2, 40, 35, 0, 0, 0, 9999999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('fbe7dfbf-7d90-4975-a6a9-e5c2680f2a84', 'tap-frenzy', 'Tap Frenzy', 'How fast can you tap?', 'Tap the screen as fast as you can before time runs out.', NULL, '👆', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'Pure speed — tap as many times as you can in 15 seconds. Track your record, challenge your friends, and see who has the fastest fingers on Zobia.', 'tapFrenzy', 1, 30, 25, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('b86396f4-d076-465c-80a3-87fdd1b2650f', 'bubble-burst', 'Bubble Burst', 'Pop before they escape!', 'Tap coloured bubbles before they float off the screen.', NULL, '🫧', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'Coloured bubbles rise from below. Tap them to pop them before they escape off the top! Miss too many and it is game over. The bubbles get faster and faster — how long can you keep up?', 'bubbleBurst', 2, 35, 28, 0, 0, 0, 9999999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('3f160aa6-70b9-40cb-bc61-6316b886ddb4', 'reaction-rush', 'Reaction Rush', 'Tap the moment you see green!', 'Test your reaction time — tap as soon as the target turns green.', NULL, '⚡', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'A pure reaction-time test. Wait for the circle to flash green and tap as fast as you can. Your reaction time is measured in milliseconds. The average human takes 250 ms — can you beat that?', 'reactionRush', 3, 30, 25, 0, 0, 0, 9999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('bfd48961-525e-4657-aa92-2eccd395985d', 'color-tap', 'Color Tap', 'Tap only the right colour!', 'Tap the matching colour tile as fast as possible.', NULL, '🎨', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'A colour — name is shown at the top. Tap the tile that matches the colour shown, not the colour of the text. Simple to understand, surprisingly tricky to execute fast. How many correct taps before you slip up?', 'colorTap', 4, 35, 28, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('43931972-9fec-4280-8b39-b843697a1ed7', 'flappy-duck', 'Flappy Duck', 'Flap through the pipes!', 'Tap to flap your wings and weave through pipe gaps.', NULL, '🦆', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'Guide your cheerful duck through an endless series of pipe gaps. Tap to flap — let go and you fall. Time your taps perfectly to thread each gap. One touch of the pipes and it is all over.', 'flappyDuck', 3, 50, 40, 0, 0, 0, 9999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('ae4b9422-9f71-4e23-9712-2f3a49217c2a', 'stack-tower', 'Stack Tower', 'Drop, stack, keep going!', 'Drop falling blocks and stack them as high as you can.', NULL, '🏗️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'A block swings back and forth on a platform. Tap to drop it and land it on the stack below. The more accurately you land it, the bigger the block stays. Miss and it shrinks. How high can you build before the block vanishes entirely?', 'stackTower', 4, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('4fccc17e-b0b7-4357-b271-306c91bba621', 'cookie-kingdom', 'Cookie Kingdom', 'Click. Bake. Rule.', 'Click to bake cookies and buy upgrades for your kingdom.', NULL, '🍪', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Idle', 'Start with a single click to bake a cookie. Earn enough to buy bakeries, farms, factories and eventually entire cookie empires. Watch your cookies multiply while you are busy doing other things — the idle life is sweet.', 'cookieKingdom', 1, 40, 35, 0, 0, 0, 9999999999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('cb50fc37-278f-4920-a09f-dc72b18aa36e', 'galaxy-miner', 'Galaxy Miner', 'Mine the cosmos!', 'Tap to mine space rocks and upgrade your fleet.', NULL, '⛏️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Idle', 'Tap asteroids to extract precious minerals. Spend your haul on mining drones, laser rigs and warp drives that mine for you automatically. Build your galactic empire one asteroid at a time.', 'galaxyMiner', 2, 40, 35, 0, 0, 0, 9999999999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('8e6cdcd1-2cca-4f0c-8733-bffb8d75b41d', 'memory-match', 'Memory Match', 'Find every pair!', 'Flip cards to reveal matching pairs.', NULL, '🃏', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'A grid of face-down cards is shuffled. Flip two at a time — if they match, they stay face up; if not, they flip back. Clear the board in as few moves as possible. Your score is based on speed and how few mismatches you make.', 'memoryMatch', 3, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('8c260ac9-378c-4810-89cb-ca3d9ea77e07', 'slide-puzzle', 'Slide Puzzle', 'Slide the tiles into order!', 'Rearrange the numbered tiles to put them in order.', NULL, '🔢', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'A classic 4×4 sliding puzzle. Slide the numbered tiles through the single empty space to arrange them in order from 1–15. Minimal moves, minimal time — the best solvers complete it in seconds.', 'slidePuzzle', 4, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('e573dd4b-993d-407e-a33b-4562f88b11c8', 'minesweeper', 'Minesweeper', 'Avoid the mines!', 'Reveal the grid but do not hit any hidden mines.', NULL, '💣', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Reveal the grid square by square using the number clues — each number tells you how many mines touch that square. Flag the mines and clear everything else to win. One wrong click and it is over.', 'minesweeper', 5, 50, 40, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('32344d26-4877-4cb1-b328-a722ba97291f', 'color-sort', 'Color Sort', 'Sort the colours into their tubes!', 'Move coloured balls to fill each tube with one colour.', NULL, '🎨', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Test tubes contain a mixed jumble of coloured balls. Move balls between tubes (only onto matching colours or into empty tubes) until every tube holds one pure colour. Each solved level reveals a harder arrangement.', 'colorSort', 6, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('f7354101-bdca-4d6b-804f-c53c33d52db1', 'blackjack', 'Blackjack', 'Beat the dealer to 21!', 'Play classic Blackjack against the AI dealer.', NULL, '🃏', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Card', 'The classic casino card game. Try to build a hand closer to 21 than the dealer without going bust. Hit, stand, or double down — make the right call at the right moment and rake in the chips.', 'blackjack', 1, 55, 45, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('238430d5-2bde-4a2d-9dc9-b3632a5ec969', 'whot', 'Whot!', 'Play your cards right!', 'Play the popular African card game against the AI.', NULL, '🎴', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Card', 'The beloved West African card game. Match cards by number or suit, play special action cards, and race to clear your hand before the AI beats you. Calls of "Whot!" are the sweetest sound on the table.', 'whot', 2, 55, 45, 0, 0, 0, 9999, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('aee62a0e-56eb-487c-b88e-e87242ceabf6', 'higher-or-lower', 'Higher or Lower', 'Is the next card higher or lower?', 'Guess whether the next playing card will be higher or lower.', NULL, '🎴', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Card', 'A card is revealed. Guess whether the next card will be higher or lower. Get it right and keep your streak going. One wrong guess ends the run. Cards do not repeat — use your memory!', 'higherOrLower', 3, 35, 28, 0, 0, 0, 9999, 5, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('da097909-6de9-4e1f-bc56-ee501f57dc90', 'chess', 'Chess', 'The classic game of kings.', 'Play Chess against the AI at your own pace.', NULL, '♟️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Board', 'The timeless game of strategy and tactics. Play against the AI — choose Easy for a relaxed game or Hard for a genuine challenge. Capture the opponent''s king to win.', 'chess', 1, 70, 60, 1, 0, 0, 9999, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('fc27b853-37b9-495d-97af-f9f1a932a49a', 'ludo', 'Ludo', 'Race your pieces home!', 'Play Ludo against AI opponents — roll dice and race home.', NULL, '🎲', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Board', 'The classic race board game. Roll the dice and race all four of your pieces from start to home base before your AI opponents do. Land on an opponent''s piece to send it back to the start!', 'ludo', 2, 65, 55, 0, 0, 0, 9999, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('05ccfcf1-1027-4d35-97dc-c7eabf16c3ec', 'word-scramble', 'Word Scramble', 'Unscramble the letters!', 'Unscramble jumbled letters to spell the hidden word.', NULL, '🔤', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Word', 'A word appears with all its letters scrambled. Rearrange them to reveal the correct word before the timer runs out. Five words per round — the faster and more accurately you solve them, the higher your score.', 'wordScramble', 1, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('c82609fe-dc2c-4163-afc6-ba67d6e26129', 'simon-says', 'Simon Says', 'Remember the sequence!', 'Watch the colour pattern and repeat it back.', NULL, '🌈', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Word', 'A sequence of coloured tiles lights up. Watch carefully, then repeat the pattern in the same order. Each successful round adds one more step to the sequence. How far can your memory take you?', 'simonSays', 2, 40, 35, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('6716d6cf-d3c5-4c65-8949-cd00048b314a', 'rock-paper-scissors', 'Rock Paper Scissors', 'Best of 5 vs the AI!', 'Play Rock Paper Scissors in rapid best-of-5 rounds.', NULL, '✊', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Casual', 'You already know the rules. Play fast best-of-5 rounds against the AI. The AI has a subtle pattern — can you crack it and outsmart the machine? First to 3 wins takes the match.', 'rockPaperScissors', 1, 30, 25, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('4d03b25f-cde6-4429-852c-e6105e84d972', 'sudoku', 'Sudoku', 'Fill every row, column and box!', 'Classic 9×9 Sudoku. Place the digits 1–9 so every row, column, and 3×3 box holds each digit exactly once.', NULL, '🔢', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'The world''s most popular logic puzzle, now on Zobia. Three difficulty levels — Easy for a relaxed solve, Hard for a real brain workout. Your score is based on how fast you complete the puzzle.', 'sudoku', 7, 50, 40, 0, 0, 0, 1000, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('75c4ceaa-6269-4a03-a5d9-648f9efa1e60', 'word-search', 'Word Search', 'Find every hidden word!', 'Scan the letter grid horizontally, vertically and diagonally to find all the hidden words.', NULL, '🔍', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'A grid packed with hidden words in every direction. Spot them all to clear the board. Words get longer and grids bigger as difficulty increases — can you find every word before time runs out?', 'wordSearch', 8, 45, 38, 0, 0, 0, 2000, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('8c42b270-1225-42dd-94a6-695e4a7691d1', 'lights-out', 'Lights Out', 'Toggle the lights — turn them all off!', 'Click a cell to toggle it and its neighbours. Your goal: turn every light OFF.', NULL, '💡', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'A deceptively simple puzzle. Each click toggles the clicked cell plus its orthogonal neighbours. Start from a scrambled state and work out which toggles to press to switch off every last light.', 'lightsOut', 9, 45, 38, 0, 0, 0, 500, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('d10c64af-b465-455f-b03a-15e663468257', 'number-match', 'Number Match', 'Clear pairs that sum to 10!', 'Tap two numbers that are equal or sum to 10 to remove them from the grid.', NULL, '🔟', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'A satisfying number clearing game. Match adjacent numbers — or numbers in the same row or column with nothing between them — that are equal or add up to 10. Clear the board to win!', 'numberMatch', 10, 40, 35, 0, 0, 0, 9999, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('f9cb6ec0-2d2a-416e-8ddc-f23b32c52f72', 'nonogram', 'Nonogram', 'Fill the grid from the number clues!', 'Use the row and column number clues to figure out which cells to fill in.', NULL, '🖼️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Also known as Picross or Hanjie — a pixel-art logic puzzle. The numbers tell you how many consecutive filled cells appear in each row and column. Deduce the pattern and reveal the hidden picture.', 'nonogram', 11, 50, 42, 0, 0, 0, 500, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('fe035fec-8c09-44d2-9660-f79759efb961', 'pipe-connect', 'Pipe Connect', 'Connect all the pipe endpoints!', 'Draw pipes between matching colour endpoints so every cell is covered.', NULL, '🔧', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Flow-free style pipe puzzle. Connect each pair of same-coloured endpoints with a continuous pipe, and fill every single cell on the grid. Pipes cannot cross. Think ahead — it gets fiendishly tricky!', 'pipeConnect', 12, 50, 42, 0, 0, 0, 500, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('3f87e897-c2c3-4fb7-9d99-9b549d96fa5b', 'sliding-blocks', 'Sliding Blocks', 'Slide the red block to the exit!', 'Slide coloured blocks to clear a path for the red block to escape.', NULL, '🧩', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'Inspired by the classic Rush Hour puzzle. A grid of blocks — some horizontal, some vertical — sit between your red block and the exit. Slide them out of the way, one by one, until the red block can slide free.', 'slidingBlocks', 13, 50, 42, 0, 0, 0, 500, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('9e644c3c-cede-492b-82dd-a29bcc991879', 'mahjong', 'Mahjong Solitaire', 'Match and clear all the tiles!', 'Tap matching free tiles to remove them from the board.', NULL, '🀄', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Puzzle', 'The beloved tile-matching solitaire. Tap two identical free tiles (not covered and with at least one open side) to remove them. Clear the entire pyramid to win. Strategy matters — remove tiles in the right order!', 'mahjongSolitaire', 14, 55, 45, 0, 0, 0, 5000, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('76384a1e-09eb-4a2a-b67b-8730291bafb0', 'whack-a-mole', 'Whack-a-Mole', 'Bonk the moles before they hide!', 'Tap moles the instant they pop up from their holes.', NULL, '🔨', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Action', 'Classic reaction game. Moles pop up from 9 holes at random intervals — tap them before they duck back underground! Miss too many and your score suffers. The moles get sneakier on harder difficulties.', 'whackAMole', 3, 40, 35, 0, 0, 0, 9999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('af02d2f5-6391-465d-9303-8bcb6587bb77', 'fruit-slicer', 'Fruit Slicer', 'Slice the fruit, dodge the bombs!', 'Swipe across falling fruit to slice it, but avoid the bombs.', NULL, '🍎', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Action', 'Fruit falls from the sky — drag your finger across the screen to slice through it and rack up points. But watch out for bombs mixed in on higher difficulties! One wrong swipe and your game is over.', 'fruitSlicer', 4, 45, 38, 0, 0, 0, 9999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('33885230-76c0-4c13-a03a-b1ec79eef8c2', 'ayo', 'Ayo', 'The classic West African strategy game!', 'Play Ayo — the traditional Nigerian mancala board game — against the AI.', NULL, '🏺', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Board', 'Ayo (Oware) is one of Africa''s oldest and most beloved board games. Two rows of six pits, 48 seeds. Pick up all the seeds from a pit and sow them counter-clockwise, one per pit. Capture seeds when your last drop lands in an opponent''s pit with exactly 2 or 3 seeds. First to 25 seeds wins!', 'ayo', 3, 70, 60, 1, 0, 0, 48, 60, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('dfdb2264-bd26-454a-81d3-28ce3fa96e5a', 'platform-jumper', 'Platform Jumper', 'Jump from platform to platform!', 'Guide your character up an endless series of platforms — how high can you go?', NULL, '🦘', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'Your bouncy character leaps automatically — tap left or right to steer and land on each platform. Miss a platform and you fall to your doom. The higher you climb, the narrower the platforms get. Can you reach the stars?', 'platformJumper', 5, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('403aae0b-d322-4be6-b2d9-8b1e342527b9', 'pixel-runner', 'Pixel Runner', 'Run and jump over everything!', 'Tap to jump over obstacles in this non-stop side-scrolling runner.', NULL, '🏃', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'Your pixel hero runs forever — tap to jump over walls, spikes and pits that appear in the path. The longer you survive, the faster the pace. One collision and it is all over. How far can you run?', 'pixelRunner', 6, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('c54908f4-d208-485d-8080-3a39ece853ad', 'asteroid-dodge', 'Asteroid Dodge', 'Dodge the space rocks!', 'Steer your spaceship left and right to dodge incoming asteroids.', NULL, '☄️', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Arcade', 'Your rocket is hurtling through a dense asteroid field. Tap left or right to dodge the rocks — some small, some massive, some moving at terrifying speed. Every second you survive earns points. One collision and you are space dust.', 'asteroidDodge', 7, 40, 35, 0, 0, 0, 9999999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('0c8c721a-8aad-46c9-bc05-82840f685649', 'speed-tap', 'Speed Tap', 'Tap targets the instant they appear!', 'React lightning fast — targets shrink and disappear if you miss them.', NULL, '🎯', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'Bright targets flash up on screen and start shrinking. Tap them before they vanish completely! Every hit scores points; every miss deducts them. The targets get smaller and faster on harder settings. How sharp is your reflex?', 'speedTap', 5, 35, 28, 0, 0, 0, 9999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('e046b83b-4689-437e-930d-311519253efc', 'color-rain', 'Color Rain', 'Tap the drops that match your colour!', 'Coloured drops fall — tap only those matching the target colour shown.', NULL, '🌈', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Tap', 'Drops of four colours rain down the screen. A target colour glows at the top. Tap every drop that matches — and avoid the wrong colours! The rain gets heavier and faster. Stay sharp and keep your score climbing.', 'colorRain', 6, 35, 28, 0, 0, 0, 9999, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('6cdcbb11-9f1c-4e97-892a-d76e63547ce2', 'quick-quiz', 'Quick Quiz', 'How much do you know?', '10 general-knowledge questions — score big by answering fast.', NULL, '🧠', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Trivia', 'Ten questions, ten chances to prove your knowledge. Pick the right answer from four choices as fast as you can — the quicker you answer correctly, the bigger the time bonus. Wrong answers score zero. Think you know everything? Prove it!', 'quickQuiz', 1, 60, 50, 0, 0, 0, 1750, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('208d26ac-d400-4857-9d9b-b4e0c3cdcdde', 'true-or-false', 'True or False', 'Is it fact or fiction?', 'Rapid-fire true/false statements — answer as many as you can correctly.', NULL, '✅', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Trivia', 'A bold statement appears on screen. True or false — decide fast! The timer ticks down and every correct answer bangs up your score. Wrong answers cost you nothing but time. Simple to play, surprisingly addictive to master.', 'trueOrFalse', 2, 50, 42, 0, 0, 0, 1125, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('00260a5a-7af9-4394-bc13-b77c9de1b35b', 'emoji-quiz', 'Emoji Quiz', 'Guess the word from emojis!', 'Figure out the movie, phrase or word hidden in a sequence of emojis.', NULL, '😎', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Trivia', 'A cryptic combination of emojis hides a movie title, phrase or concept. Decode the emoji clue and type your answer. Easy puzzles are obvious, hard ones will have you scratching your head. Think you speak emoji fluently?', 'emojiQuiz', 3, 60, 50, 0, 0, 0, 1400, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('508343cc-eb0b-4c3d-8d00-7d6ce5d0eddf', 'flag-quiz', 'Flag Quiz', 'Which country is that flag?', 'Identify countries from their flag — pick from four options.', NULL, '🚩', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Trivia', 'A country flag flashes up — can you name it from four choices? Starts with well-known flags and gets tricky on harder settings. Great for travel lovers, geography buffs, and anyone who wants to learn the world one flag at a time.', 'flagQuiz', 4, 50, 42, 0, 0, 0, 750, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('885642a6-3232-4816-ba21-cad6ea20bc8d', 'word-guess', 'Word Guess', 'Guess the 5-letter word in 6 tries!', 'Wordle-style word guessing. Green = right place, yellow = wrong place.', NULL, '💬', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Word', 'One secret 5-letter word. Six attempts to find it. Every guess tells you which letters are correct and in the right spot (green), which are in the word but misplaced (yellow), and which aren''t in the word at all (grey). Pure vocabulary meets deduction.', 'wordGuess', 3, 55, 45, 0, 0, 0, 600, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('8cf315e4-d73d-426e-b7cb-03243ca081d8', 'hangman', 'Hangman', 'Guess the word before the man is hanged!', 'Pick letters one by one to reveal the hidden word before you run out of chances.', NULL, '🎭', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Word', 'A hidden word waits behind a row of blank spaces. Guess letters — correct ones fill in the blanks; wrong ones bring the stick figure closer to doom. Run out of guesses and it is game over. Can you read the word before you run out of chances?', 'hangman', 4, 45, 38, 0, 0, 0, 9999, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('f76fba27-4b48-4b36-8651-2d237585e4ec', 'anagram-rush', 'Anagram Rush', 'Unscramble the letters against the clock!', 'Scrambled letters — rearrange them to spell the correct word.', NULL, '🔀', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Word', 'A word has been scrambled into a jumble of letters. Your mission: unscramble them to spell the original word before time runs out. Ten words per round, each harder than the last. How many can you solve under pressure?', 'anagramRush', 5, 50, 42, 0, 0, 0, 1000, 20, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('ca90e000-257e-49f4-a033-1b067663c7c4', 'tic-tac-toe', 'Tic Tac Toe', 'Get three in a row first!', 'Play classic Tic Tac Toe against an AI opponent.', NULL, '⭕', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Casual', 'The timeless 3×3 grid game. You are X, the AI is O. Get three of your marks in a row — horizontal, vertical or diagonal — before the AI does. On Hard mode the AI is completely unbeatable. On Easy it makes mistakes. Good luck!', 'ticTacToe', 2, 30, 25, 0, 0, 0, 300, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('34a4a58a-3881-47db-aed9-b0a2b75cd3e1', 'connect-four', 'Connect Four', 'Drop four in a row!', 'Drop discs to connect four of your colour in a row.', NULL, '🔴', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Casual', 'Drop red discs into the 7×6 grid. Gravity does the rest. Get four in a row — horizontally, vertically or diagonally — before the yellow AI does. Simple rules but deep strategy. Easy AI makes blunders; Hard AI does not.', 'connectFour', 3, 40, 35, 0, 0, 0, 200, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('08efa4e0-eef5-4329-aa83-7f1381d134af', 'gem-swap', 'Gem Swap', 'Swap gems to match three or more!', 'Swap adjacent gems to make rows or columns of three or more matching gems.', NULL, '💎', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Strategy', 'A glittering grid of gems. Swap two adjacent gems to line up three or more of the same colour. They disappear, gems fall, and new ones appear. Chain combos earn massive points. 60 seconds on the clock — how high can your score go?', 'gemSwap', 1, 55, 45, 0, 0, 0, 99999, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('a8d64512-bc9f-48ee-80b8-90d2e77faa13', 'dots-and-boxes', 'Dots & Boxes', 'Draw lines — claim the most boxes!', 'Connect dots to complete boxes. The player with the most boxes wins.', NULL, '📦', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Strategy', 'A grid of dots. Take turns drawing lines between adjacent dots. Complete a box (four sides) and you claim it and get another turn. The one who claims the most boxes when the grid is full wins. Looks simple — feels like chess!', 'dotsAndBoxes', 2, 50, 42, 0, 0, 0, 1250, 30, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('cebe60af-dc3d-4bbb-a4f7-393163da54d1', 'penalty-kick', 'Penalty Kick', 'Aim and shoot — score the penalty!', 'Time your aim and power to score past the goalkeeper.', NULL, '⚽', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Sports', 'Step up to the spot. A cursor sweeps across the goal — tap to lock your aim. Then a power bar charges up — tap again to set your power. The goalkeeper dives. GOAL or SAVE? Five kicks to prove your nerve under pressure.', 'penaltyKick', 1, 55, 45, 0, 0, 0, 500, 15, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('1611c4c4-311c-43aa-8052-98fff41d7d42', 'basketball-shot', 'Basketball Shot', 'Perfect timing is everything!', 'Tap at exactly the right moment to sink the basketball.', NULL, '🏀', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Sports', 'A basketball swings on an arc over the hoop. Tap when the ball aligns with the basket for the perfect shot. The sweet spot shrinks on harder difficulties and the arc speeds up. 10 shots — can you sink them all?', 'basketballShot', 2, 45, 38, 0, 0, 0, 300, 10, 0.00, 0, 0);

INSERT INTO public.games (id, slug, name, tagline, description, cover_image_url, cover_emoji, creator_id, is_public, is_active, play_count, created_at, updated_at, deleted_at, category, long_description, engine_key, sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win, play_cost_credits, play_cost_stars, max_score, min_play_seconds, avg_rating, rating_count, favorite_count) VALUES ('6973d1e0-ced6-4023-97c3-424a353f4975', 'beat-tap', 'Beat Tap', 'Hit the notes on the beat!', 'Tap the correct lane when notes reach the hit zone.', NULL, '🎵', NULL, true, true, 0, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'Music', 'Four lanes of falling note blocks drop toward the hit zone at the bottom of each lane. Tap the lane button the instant a note arrives. Perfect timing earns maximum points; late or early taps score less. 30 seconds of rhythm action — how high can you score?', 'beatTap', 1, 55, 45, 0, 0, 0, 1350, 20, 0.00, 0, 0);

INSERT INTO public.game_play_milestones (id, games_played_threshold, reward_credits, reward_xp, reward_stars, is_active, created_at) VALUES ('c8e6f908-c471-43a4-83af-9f3cd12c3649', 10, 100, 200, 0, true, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.game_play_milestones (id, games_played_threshold, reward_credits, reward_xp, reward_stars, is_active, created_at) VALUES ('14edd2f6-1c1e-48c5-9c2c-76a8d09386f2', 50, 500, 600, 1, true, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.game_play_milestones (id, games_played_threshold, reward_credits, reward_xp, reward_stars, is_active, created_at) VALUES ('1483ade8-323d-4f38-9443-7b9d94566bda', 100, 1200, 1500, 3, true, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.game_play_milestones (id, games_played_threshold, reward_credits, reward_xp, reward_stars, is_active, created_at) VALUES ('3ab126c2-39e0-46fa-a71d-dceaee2ff728', 500, 6000, 8000, 10, true, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('928a2742-0ef0-4023-a60f-5a6584fa1ab9', 'Flower', '🌸', 5, 1, NULL, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('eb29f61d-9af8-4cbb-b383-e67642396f55', 'Cold One', '🍺', 10, 1, NULL, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('2a1b3b41-8d28-4b04-b11b-298a424c60e8', 'Respect', '🤝', 15, 1, NULL, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('ac259b7c-68bf-44a9-aff6-d7f01c4f15aa', 'Fire', '🔥', 25, 1, NULL, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('9f2c725b-f864-4874-a5fc-177f04a7a321', 'Big Brain', '🧠', 40, 1, NULL, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('9092341f-db2c-439c-8625-6681c64cfc23', 'Trophy', '🏆', 80, 2, 150, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('fb4f2af0-6418-4cc5-b9ab-085f206d4490', 'Diamond', '💎', 150, 2, 150, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('8b48554a-bbb5-4565-a1cd-73ae8798c7dc', 'Crown', '👑', 300, 2, 150, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('a887620e-47d8-4100-8690-7b53c2110dbe', 'Rocket', '🚀', 400, 2, 150, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('0494d12d-1d12-4de7-b3b1-0d5489ef7b15', 'Lion', '🦁', 500, 2, 150, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('96286f5b-8476-4c04-a6c2-b5cea90cad43', 'Money Bag', '💰', 800, 3, 800, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('318ed4b9-3d9c-48dd-80b7-9658fd0622ea', 'City Night', '🌃', 1500, 3, 800, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('e1d2fb7d-63ac-4a32-8e63-19e780f4afc1', 'Stadium Roar', '🏟️', 2000, 3, 800, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.gift_items (id, name, emoji, coin_cost, tier, spectacle_threshold_coins, animation_url, is_limited_edition, season_id, is_retired, is_active, created_at, updated_at, is_rewarded, reward_config) VALUES ('7560d526-0516-49dc-8eac-f9472c4ff1f3', 'Legendary Crown', '✨', 5000, 3, 800, NULL, false, NULL, false, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', false, NULL);

INSERT INTO public.help_categories (id, slug, name, description, sort_order, published, created_at, updated_at) VALUES ('46371b37-7b86-493f-add7-0291b7872b7d', 'payments', 'Payments & Wallets', 'Paying with Paystack or crypto, coins, stars, and your wallet.', 10, true, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.help_categories (id, slug, name, description, sort_order, published, created_at, updated_at) VALUES ('42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'getting-started', 'Getting started', 'Find your way around Zobia and set up your account.', 0, true, '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00');

INSERT INTO public.help_categories (id, slug, name, description, sort_order, published, created_at, updated_at) VALUES ('577d584f-770b-4735-8233-f1fe78ee7a46', 'wallet-and-plans', 'Wallet and plans', 'Understand credits, purchases, subscriptions, and your history.', 0, true, '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00');

INSERT INTO public.help_categories (id, slug, name, description, sort_order, published, created_at, updated_at) VALUES ('8975cf71-f982-4067-bc4c-d1b42d4b65e1', 'safety-and-privacy', 'Safety and privacy', 'Control your privacy, report problems, and keep your account safe.', 0, true, '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00');

INSERT INTO public.help_categories (id, slug, name, description, sort_order, published, created_at, updated_at) VALUES ('ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'creating-and-sharing', 'Creating and sharing', 'Publish, chat, learn, save, and play.', 0, true, '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00');

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('75ad3ff6-790d-46e4-b94c-274cf58d09bd', '46371b37-7b86-493f-add7-0291b7872b7d', 'how-to-buy-crypto', 'How to buy crypto (JAGA, BNB, SOL)', '## Before you start

You only need this if you chose **Pay with Crypto** at checkout. If Paystack works for you, you don''t need any of this.

You''ll need a **wallet app** — this is like a bank app, except you (not Zobia, not any company) hold the keys, and only you can move the money out of it. Never share your wallet''s recovery phrase (usually 12-24 words) with anyone, including someone claiming to be Zobia support — we will never ask for it.

## 1. Install a wallet app

- **For JAGA or BNB** (both run on BNB Smart Chain): install **MetaMask** or **Trust Wallet** from your phone''s app store (or the MetaMask browser extension on desktop).
- **For SOL** (Solana): install **Phantom** from your phone''s app store (or the browser extension on desktop).

Open the app and follow its setup — it will create a new wallet and show you a recovery phrase. Write that phrase down on paper and keep it somewhere safe. Do not screenshot it or save it in a notes app.

## 2. Buy BNB (if you''re paying with JAGA or BNB)

1. Inside MetaMask or Trust Wallet, tap **Buy** (or **Buy Crypto**).
2. Pick **BNB** as the coin, and pick a payment method the app offers (card, bank transfer, or a local option depending on your country).
3. Follow the on-screen steps for that provider — you may need to verify your ID the first time.
4. Once it completes, you''ll see a BNB balance in your wallet within a few minutes.

If you only need **BNB** (not JAGA), you''re done — go back to Zobia''s checkout, connect this same wallet, and send the payment.

## 3. Swap BNB for JAGA on PancakeSwap (only if paying with JAGA)

1. Open your wallet app''s built-in browser (MetaMask and Trust Wallet both have one) and go to **pancakeswap.finance**.
2. Tap **Connect Wallet** on PancakeSwap and approve the connection from your wallet app.
3. On the **Swap** screen, set "From" to **BNB** and "To" to **JAGA**. If JAGA doesn''t show up automatically, paste in its contract address (Zobia''s checkout screen shows this, or ask in Support).
4. Enter how much BNB you want to swap — leave a small amount of BNB unswapped, since you''ll need a little for the network fee when you actually send your payment.
5. Tap **Swap**, review the amount, and confirm in your wallet app when it pops up.
6. Wait about 10-30 seconds — your wallet will now show a JAGA balance.

## 4. Buy SOL (if you''re paying with SOL)

1. Inside Phantom, tap **Buy**.
2. Pick **SOL** and a payment method the app offers (card, bank transfer, or a local option).
3. Follow the provider''s steps — again, you may need to verify your ID the first time.
4. Your SOL balance appears in Phantom within a few minutes.

## 5. Come back and pay

Go back to Zobia''s checkout, choose your currency, and connect the same wallet you just funded (MetaMask/Trust Wallet for JAGA or BNB, Phantom for SOL). Zobia will show you the exact amount to send — approve it in your wallet app, and the payment confirms automatically once it''s seen on the blockchain.

## Troubleshooting

- **"Insufficient funds for gas"** — you need a small amount of BNB (for JAGA/BNB) or SOL (for SOL) left over to cover the network fee, even if you have enough of the token itself.
- **Payment stuck on "pending"** — blockchain confirmations can take a minute or two, especially on busy days. Leave the checkout screen open; it checks automatically.
- **Sent to the wrong address / wrong amount** — crypto transactions cannot be reversed by Zobia or anyone else. Always double-check the address and amount your wallet shows before confirming.
', '<h2>Before you start</h2><p>You only need this if you chose <strong>Pay with Crypto</strong> at checkout. If Paystack works for you, you don''t need any of this.</p><p>You''ll need a <strong>wallet app</strong> — this is like a bank app, except you (not Zobia, not any company) hold the keys, and only you can move the money out of it. Never share your wallet''s recovery phrase (usually 12-24 words) with anyone, including someone claiming to be Zobia support — we will never ask for it.</p><h2>1. Install a wallet app</h2><ul><li><strong>For JAGA or BNB</strong> (both run on BNB Smart Chain): install <strong>MetaMask</strong> or <strong>Trust Wallet</strong> from your phone''s app store (or the MetaMask browser extension on desktop).</li><li><strong>For SOL</strong> (Solana): install <strong>Phantom</strong> from your phone''s app store (or the browser extension on desktop).</li></ul><p>Open the app and follow its setup — it will create a new wallet and show you a recovery phrase. Write that phrase down on paper and keep it somewhere safe. Do not screenshot it or save it in a notes app.</p><h2>2. Buy BNB (if you''re paying with JAGA or BNB)</h2><ol><li>Inside MetaMask or Trust Wallet, tap <strong>Buy</strong> (or <strong>Buy Crypto</strong>).</li><li>Pick <strong>BNB</strong> as the coin, and pick a payment method the app offers (card, bank transfer, or a local option depending on your country).</li><li>Follow the on-screen steps for that provider — you may need to verify your ID the first time.</li><li>Once it completes, you''ll see a BNB balance in your wallet within a few minutes.</li></ol><p>If you only need <strong>BNB</strong> (not JAGA), you''re done — go back to Zobia''s checkout, connect this same wallet, and send the payment.</p><h2>3. Swap BNB for JAGA on PancakeSwap (only if paying with JAGA)</h2><ol><li>Open your wallet app''s built-in browser (MetaMask and Trust Wallet both have one) and go to <strong>pancakeswap.finance</strong>.</li><li>Tap <strong>Connect Wallet</strong> on PancakeSwap and approve the connection from your wallet app.</li><li>On the <strong>Swap</strong> screen, set "From" to <strong>BNB</strong> and "To" to <strong>JAGA</strong>. If JAGA doesn''t show up automatically, paste in its contract address (Zobia''s checkout screen shows this, or ask in Support).</li><li>Enter how much BNB you want to swap — leave a small amount of BNB unswapped, since you''ll need a little for the network fee when you actually send your payment.</li><li>Tap <strong>Swap</strong>, review the amount, and confirm in your wallet app when it pops up.</li><li>Wait about 10-30 seconds — your wallet will now show a JAGA balance.</li></ol><h2>4. Buy SOL (if you''re paying with SOL)</h2><ol><li>Inside Phantom, tap <strong>Buy</strong>.</li><li>Pick <strong>SOL</strong> and a payment method the app offers (card, bank transfer, or a local option).</li><li>Follow the provider''s steps — again, you may need to verify your ID the first time.</li><li>Your SOL balance appears in Phantom within a few minutes.</li></ol><h2>5. Come back and pay</h2><p>Go back to Zobia''s checkout, choose your currency, and connect the same wallet you just funded (MetaMask/Trust Wallet for JAGA or BNB, Phantom for SOL). Zobia will show you the exact amount to send — approve it in your wallet app, and the payment confirms automatically once it''s seen on the blockchain.</p><h2>Troubleshooting</h2><ul><li><strong>"Insufficient funds for gas"</strong> — you need a small amount of BNB (for JAGA/BNB) or SOL (for SOL) left over to cover the network fee, even if you have enough of the token itself.</li><li><strong>Payment stuck on "pending"</strong> — blockchain confirmations can take a minute or two, especially on busy days. Leave the checkout screen open; it checks automatically.</li><li><strong>Sent to the wrong address / wrong amount</strong> — crypto transactions cannot be reversed by Zobia or anyone else. Always double-check the address and amount your wallet shows before confirming.</li></ul>', 'first_time', 1, 'How to buy crypto (JAGA, BNB, SOL) — Zobia Help Center', 'A beginner-friendly, step-by-step guide to installing a wallet, buying BNB or SOL, and swapping for JAGA to pay on Zobia.', true, 0, NULL, '''-24'':76B ''-30'':426B ''1'':93B,195B,304B,445B ''10'':425B ''12'':75B ''2'':184B,206B,325B,450B ''3'':231B,292B,339B,467B ''4'':251B,374B,436B,484B ''5'':406B,495B ''6'':422B ''actual'':402B ''address'':363B,615B,633B ''alway'':628B ''amount'':386B,411B,532B,562B,617B,635B ''anyon'':79B,626B ''app'':40B,46B,97B,117B,135B,145B,183B,218B,308B,338B,417B,458B,540B ''appear'':488B ''approv'':332B,535B ''ask'':90B,371B ''automat'':358B,545B,610B ''back'':279B,497B,501B ''balanc'':260B,435B,487B ''bank'':45B,221B,461B ''blockchain'':552B,591B ''bnb'':6A,101B,105B,186B,194B,208B,259B,272B,294B,347B,378B,388B,522B,564B ''browser'':122B,139B,313B ''built'':311B ''built-in'':310B ''busi'':601B ''buy'':3A,185B,202B,204B,437B,449B ''cannot'':620B ''card'':220B,460B ''chain'':107B ''check'':609B,631B ''checkout'':22B,283B,366B,505B,605B ''choos'':506B ''chose'':17B ''claim'':82B ''coin'':211B ''come'':496B ''compani'':53B ''complet'':254B ''confirm'':413B,544B,592B,640B ''connect'':284B,327B,334B,510B ''contract'':362B ''countri'':230B ''cover'':574B ''creat'':152B ''crypto'':4A,20B,205B,618B ''currenc'':508B ''day'':602B ''depend'':227B ''desktop'':125B,142B ''doesn'':354B ''done'':277B ''doubl'':630B ''double-check'':629B ''els'':627B ''enough'':582B ''enter'':375B ''especi'':599B ''even'':578B ''exact'':531B ''except'':47B ''extens'':123B,140B ''fee'':399B,577B ''first'':249B,482B ''follow'':147B,232B,468B ''fund'':516B,555B ''gas'':557B ''go'':278B,322B,500B ''hold'':54B ''id'':247B,480B ''includ'':80B ''insid'':196B,446B ''instal'':94B,108B,129B ''insuffici'':554B ''jaga'':5A,99B,192B,274B,296B,303B,351B,353B,434B,520B ''jaga/bnb'':566B ''keep'':169B ''key'':56B ''leav'':383B,603B ''left'':571B ''like'':43B ''littl'':395B ''ll'':36B,256B,392B ''local'':225B,465B ''may'':242B,475B ''metamask'':109B,121B,197B,314B ''metamask/trust'':517B ''method'':216B,456B ''minut'':267B,494B,596B ''money'':63B ''move'':61B ''much'':377B ''need'':13B,31B,37B,243B,271B,393B,476B,559B ''network'':398B,576B ''never'':67B,89B ''new'':154B ''note'':182B ''offer'':219B,459B ''on-screen'':234B ''one'':320B ''open'':143B,305B,607B ''option'':226B,466B ''pancakeswap'':298B,330B ''pancakeswap.finance'':324B ''paper'':167B ''past'':359B ''pay'':18B,190B,301B,442B,499B ''payment'':215B,291B,405B,455B,543B,587B ''paystack'':24B ''pend'':590B ''phantom'':130B,447B,490B,523B ''phone'':115B,133B ''phrase'':73B,161B,164B ''pick'':207B,213B,451B ''pop'':420B ''provid'':240B,470B ''re'':189B,276B,441B ''recoveri'':72B,160B ''revers'':622B ''review'':409B ''run'':103B ''safe'':172B ''save'':178B ''screen'':236B,343B,367B,606B ''screenshot'':175B ''second'':427B ''see'':257B ''seen'':549B ''send'':289B,403B,534B ''sent'':611B ''set'':344B ''setup'':149B ''share'':68B ''show'':157B,356B,368B,432B,528B,638B ''sinc'':390B ''small'':385B,561B ''smart'':106B ''sol'':7A,127B,438B,444B,452B,486B,525B,568B,570B ''solana'':128B ''someon'':81B ''somewher'':171B ''start'':10B ''step'':237B,472B ''store'':118B,136B ''stuck'':588B ''support'':86B,373B ''swap'':293B,342B,382B,408B ''take'':594B ''tap'':201B,326B,407B,448B ''time'':250B,483B ''token'':585B ''transact'':619B ''transfer'':222B,462B ''troubleshoot'':553B ''trust'':111B,199B,316B ''two'':598B ''unswap'':389B ''usual'':74B ''verifi'':245B,478B ''wait'':423B ''wallet'':39B,70B,96B,112B,155B,200B,263B,287B,307B,317B,328B,337B,416B,429B,513B,518B,539B,637B ''want'':380B ''within'':264B,491B ''word'':77B ''work'':25B ''write'':162B ''wrong'':614B,616B ''zobia'':50B,85B,281B,364B,503B,526B,624B', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('02cc7bb3-3b77-4d68-bb68-91b9f93d446d', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'your-first-visit', 'Your first visit', '# Your first visit

Start on **Home**. Your feed brings together posts, games, discussions and classrooms. Select a card to open it. Use **Search** to find people or content. Open the menu to browse related features under their section headings.

Open **Profile** to check your account and choose your language. Open **Settings** to change your privacy choices and notifications. You can change these choices later.

Your daily quests suggest actions you can do now. Select a quest to open the relevant area. A progress bar shows how close you are to finishing it. Your reward is shown before you start.

Never share your password, PIN, sign-in code or recovery information in a chat. Staff will not ask you to send these secrets to them.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''account'':48B ''action'':72B ''area'':84B ''ask'':121B ''bar'':87B ''bring'':12B ''brows'':36B ''card'':21B ''chang'':56B,64B ''chat'':117B ''check'':46B ''choic'':59B,66B ''choos'':50B ''classroom'':18B ''close'':90B ''code'':111B ''content'':31B ''daili'':69B ''discuss'':16B ''featur'':38B ''feed'':11B ''find'':28B ''finish'':94B ''first'':2A,5B ''game'':15B ''head'':42B ''home'':9B ''inform'':114B ''languag'':52B ''later'':67B ''menu'':34B ''never'':103B ''notif'':61B ''open'':23B,32B,43B,53B,81B ''password'':106B ''peopl'':29B ''pin'':107B ''post'':14B ''privaci'':58B ''profil'':44B ''progress'':86B ''quest'':70B,79B ''recoveri'':113B ''relat'':37B ''relev'':83B ''reward'':97B ''search'':26B ''secret'':126B ''section'':41B ''select'':19B,77B ''send'':124B ''set'':54B ''share'':104B ''show'':88B ''shown'':99B ''sign'':109B ''sign-in'':108B ''staff'':118B ''start'':7B,102B ''suggest'':71B ''togeth'':13B ''use'':25B ''visit'':3A,6B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('bb95debb-0424-4c44-9e17-0438b3af9134', '577d584f-770b-4735-8233-f1fe78ee7a46', 'get-credits', 'How to get credits', '# How to get {{currency.softPlural}}

Open [Wallet](/wallet) to see your balance and transaction history. Your welcome tasks, eligible quests and other activities may reward {{currency.softPlural}}. Each activity shows its current reward; some quests award XP rather than credits.

To buy more, choose an available bundle in Wallet and follow the checkout steps. Check the bundle price and currency before confirming. The Android app uses its available in-app purchase flow. Payment options may differ between Android and the website.

Someone can also send you a [gift](/gifts). Gifts and purchases appear in your wallet history when processed. Do not send money to an unknown person who promises to add credits manually.

To unlock a paid post, return to the post, select Unlock, and check the amount in the confirmation. If your balance is too low, you can buy a bundle, receive a gift or complete an eligible rewarded quest. A failed unlock does not give access to the paid content.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/gifts'':92B ''/wallet'':11B ''access'':161B ''activ'':26B,31B ''add'':114B ''also'':87B ''amount'':131B ''android'':66B,81B ''app'':67B,73B ''appear'':96B ''avail'':48B,70B ''award'':38B ''balanc'':15B,137B ''bundl'':49B,59B,145B ''buy'':44B,143B ''check'':57B,129B ''checkout'':55B ''choos'':46B ''complet'':150B ''confirm'':64B,134B ''content'':165B ''credit'':4A,42B,115B ''currenc'':62B ''currency.softplural'':8B,29B ''current'':34B ''differ'':79B ''elig'':22B,152B ''fail'':156B ''flow'':75B ''follow'':53B ''get'':3A,7B ''gift'':91B,93B,148B ''give'':160B ''histori'':18B,100B ''in-app'':71B ''low'':140B ''manual'':116B ''may'':27B,78B ''money'':106B ''open'':9B ''option'':77B ''paid'':120B,164B ''payment'':76B ''person'':110B ''post'':121B,125B ''price'':60B ''process'':102B ''promis'':112B ''purchas'':74B,95B ''quest'':23B,37B,154B ''rather'':40B ''receiv'':146B ''return'':122B ''reward'':28B,35B,153B ''see'':13B ''select'':126B ''send'':88B,105B ''show'':32B ''someon'':85B ''step'':56B ''task'':21B ''transact'':17B ''unknown'':109B ''unlock'':118B,127B,157B ''use'':68B ''wallet'':10B,51B,99B ''websit'':84B ''welcom'':20B ''xp'':39B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('e3482724-f24d-46ac-8408-bc2cacc2f1a1', '577d584f-770b-4735-8233-f1fe78ee7a46', 'understand-wallet-history', 'Read your wallet history', '# Read your wallet history

Open [Wallet](/wallet) and find the transaction history. Each entry explains an amount added or spent, with its date. Check the description to distinguish a purchase, gift, reward, refund or game stake.

Credits and stars have separate histories. A pending payment or payout may not be a completed wallet transaction yet. Refresh once to check its latest status. If a charge looks wrong, contact Support with the transaction reference and date. Never include your card details or sign-in secrets.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/wallet'':11B ''ad'':22B ''amount'':21B ''card'':83B ''charg'':69B ''check'':28B,63B ''complet'':56B ''contact'':72B ''credit'':41B ''date'':27B,79B ''descript'':30B ''detail'':84B ''distinguish'':32B ''entri'':18B ''explain'':19B ''find'':13B ''game'':39B ''gift'':35B ''histori'':4A,8B,16B,46B ''includ'':81B ''latest'':65B ''look'':70B ''may'':52B ''never'':80B ''open'':9B ''payment'':49B ''payout'':51B ''pend'':48B ''purchas'':34B ''read'':1A,5B ''refer'':77B ''refresh'':60B ''refund'':37B ''reward'':36B ''secret'':89B ''separ'':45B ''sign'':87B ''sign-in'':86B ''spent'':24B ''stake'':40B ''star'':43B ''status'':66B ''support'':73B ''transact'':15B,58B,76B ''wallet'':3A,7B,10B,57B ''wrong'':71B ''yet'':59B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('8b62d88b-314b-4e3f-9dbe-c4bd5f2e8884', '577d584f-770b-4735-8233-f1fe78ee7a46', 'choose-a-plan', 'Choose or change a plan', '# Choose or change a plan

Open [Subscription settings](/settings/subscription) to compare the current plans. Read the price, billing period, features and limits shown there. These can change, so the checkout and your account settings are the place to check current amounts.

Upgrading may unlock higher limits. A cancellation normally stops the next renewal; check your subscription status and end date for what remains available. Some features have grace periods after a plan ends. Existing bookmark folder slots stay unlocked after a downgrade.

Do not buy a plan through a message from someone claiming to be staff. Start from your account''s own plan screen.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/settings/subscription'':14B ''account'':38B,105B ''amount'':46B ''avail'':69B ''bill'':23B ''bookmark'':80B ''buy'':90B ''cancel'':53B ''chang'':3A,8B,32B ''check'':44B,59B ''checkout'':35B ''choos'':1A,6B ''claim'':98B ''compar'':16B ''current'':18B,45B ''date'':65B ''downgrad'':87B ''end'':64B,78B ''exist'':79B ''featur'':25B,71B ''folder'':81B ''grace'':73B ''higher'':50B ''limit'':27B,51B ''may'':48B ''messag'':95B ''next'':57B ''normal'':54B ''open'':11B ''period'':24B,74B ''place'':42B ''plan'':5A,10B,19B,77B,92B,108B ''price'':22B ''read'':20B ''remain'':68B ''renew'':58B ''screen'':109B ''set'':13B,39B ''shown'':28B ''slot'':82B ''someon'':97B ''staff'':101B ''start'':102B ''status'':62B ''stay'':83B ''stop'':55B ''subscript'':12B,61B ''unlock'':49B,84B ''upgrad'':47B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('3a814bb7-3bb7-4a6b-94c6-f545ef8920e8', '8975cf71-f982-4067-bc4c-d1b42d4b65e1', 'recent-activity-privacy', 'Control your recent activity', '# Control your recent activity

Open [Privacy settings](/settings#privacy). Recently active controls become available at Level 2. If you turn visibility off, you will not appear in other people''s recent-activity lists, and you also stop seeing their recent activity.

To see activity again, turn your own visibility on. A missing activity indicator does not prove that someone has left Zobia or is ignoring you. They may have hidden it or be away from the app.

On shared devices, log out when you finish. When your session expires, sign in again before opening private content. Do not leave an unlocked device with a private conversation on screen.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/settings'':12B ''2'':21B ''activ'':4A,8B,15B,37B,46B,49B,58B ''also'':41B ''app'':82B ''appear'':30B ''avail'':18B ''away'':79B ''becom'':17B ''content'':101B ''control'':1A,5B,16B ''convers'':111B ''devic'':85B,107B ''expir'':94B ''finish'':90B ''hidden'':75B ''ignor'':70B ''indic'':59B ''leav'':104B ''left'':66B ''level'':20B ''list'':38B ''log'':86B ''may'':73B ''miss'':57B ''open'':9B,99B ''peopl'':33B ''privaci'':10B,13B ''privat'':100B,110B ''prove'':62B ''recent'':3A,7B,14B,36B,45B ''recent-act'':35B ''screen'':113B ''see'':43B,48B ''session'':93B ''set'':11B ''share'':84B ''sign'':95B ''someon'':64B ''stop'':42B ''turn'':24B,51B ''unlock'':106B ''visibl'':25B,54B ''zobia'':67B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('8150d577-ec4e-4c8d-a52e-ffe118fdc023', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'save-bookmarks', 'Save and organise bookmarks', '# Save and organise bookmarks

Select **Save bookmark** below a feed card. Open [Bookmarks](/bookmarks) from the menu to find your saved content. Select a title to open it.

Use the folder selector beside a saved item to move it. Choose Unfiled to remove it from a folder without deleting the bookmark. Removing a bookmark does not delete the original content.

Paid plans unlock folder slots: Plus includes {{bookmarks.plusFolders}}, Pro includes {{bookmarks.proFolders}}, and Max includes {{bookmarks.maxFolders}}. Once unlocked, those slots remain available after a downgrade. Existing folders are kept.

If you need another slot, the first purchased slot costs {{bookmarks.firstFolderCost}} {{currency.softPlural}}, and later purchased slots cost {{bookmarks.extraFolderCost}} each. The confirmation shows the current price before your wallet is charged. Deleting a folder keeps its saved items and frees the slot.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/bookmarks'':18B ''anoth'':96B ''avail'':85B ''besid'':37B ''bookmark'':4A,8B,11B,17B,55B,58B ''bookmarks.extrafoldercost'':110B ''bookmarks.firstfoldercost'':103B ''bookmarks.maxfolders'':79B ''bookmarks.plusfolders'':72B ''bookmarks.profolders'':75B ''card'':15B ''charg'':122B ''choos'':44B ''confirm'':113B ''content'':26B,64B ''cost'':102B,109B ''currency.softplural'':104B ''current'':116B ''delet'':53B,61B,123B ''downgrad'':88B ''exist'':89B ''feed'':14B ''find'':23B ''first'':99B ''folder'':35B,51B,68B,90B,125B ''free'':131B ''includ'':71B,74B,78B ''item'':40B,129B ''keep'':126B ''kept'':92B ''later'':106B ''max'':77B ''menu'':21B ''move'':42B ''need'':95B ''open'':16B,31B ''organis'':3A,7B ''origin'':63B ''paid'':65B ''plan'':66B ''plus'':70B ''price'':117B ''pro'':73B ''purchas'':100B,107B ''remain'':84B ''remov'':47B,56B ''save'':1A,5B,10B,25B,39B,128B ''select'':9B,27B ''selector'':36B ''show'':114B ''slot'':69B,83B,97B,101B,108B,133B ''titl'':29B ''unfil'':45B ''unlock'':67B,81B ''use'':33B ''wallet'':120B ''without'':52B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('4ce8ca9c-c04d-4681-a4d8-a9e643204249', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'classroom-chatrooms', 'Join a classroom chatroom', '# Join a classroom chatroom

Open the classroom''s page first. Read its description and enrolment options. A free classroom lets you enrol without a payment. A paid classroom shows its current fee before you confirm.

After you are enrolled, select **Chat** if the creator has enabled the classroom chatroom. Classroom chat messages are for enrolled members and authorised classroom staff. A chatroom link by itself does not give access.

If you see an enrolment message, use its link to return to the classroom and check your membership. If you have paid but still cannot enter, refresh your classroom page and contact Support with your payment reference. Do not pay again just to try to fix an access problem.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''access'':73B,121B ''authoris'':62B ''cannot'':98B ''chat'':45B,55B ''chatroom'':4A,8B,53B,66B ''check'':89B ''classroom'':3A,7B,11B,23B,32B,52B,54B,63B,87B,102B ''confirm'':39B ''contact'':105B ''creator'':48B ''current'':35B ''descript'':17B ''enabl'':50B ''enrol'':19B,26B,43B,59B,78B ''enter'':99B ''fee'':36B ''first'':14B ''fix'':119B ''free'':22B ''give'':72B ''join'':1A,5B ''let'':24B ''link'':67B,82B ''member'':60B ''membership'':91B ''messag'':56B,79B ''open'':9B ''option'':20B ''page'':13B,103B ''paid'':31B,95B ''pay'':113B ''payment'':29B,109B ''problem'':122B ''read'':15B ''refer'':110B ''refresh'':100B ''return'':84B ''see'':76B ''select'':44B ''show'':33B ''staff'':64B ''still'':97B ''support'':106B ''tri'':117B ''use'':80B ''without'':27B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('458cee4e-b3d9-4c0d-86c8-1243ba703b1c', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'send-a-game-challenge', 'Send a game challenge', '# Send a game challenge

Open [Challenges](/games/challenges), choose a game and select another player. Suggestions include your friends and people who have chosen to share recent activity. Pick the round format and check any credit stake before sending.

You can send up to {{challenges.dailyLimit}} challenges per day. A new challenge expires after {{challenges.expiryHours}} hours. The Expired label means it can no longer be accepted or played, even if a scheduled cleanup has not run yet.

When a staked challenge is accepted, both players'' stakes move into escrow together. A challenge with an unaffordable stake cannot be accepted. Cancellation rules may include a forfeiture after rounds have been played; read the displayed terms. Expired active challenges are refunded by the games housekeeping job.

The Results tab contains completed challenges. Archiving your result hides it from your own inbox; it does not remove it from the other player''s inbox.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/games/challenges'':11B ''accept'':68B,85B,101B ''activ'':31B,118B ''anoth'':17B ''archiv'':133B ''cancel'':102B ''cannot'':99B ''challeng'':4A,8B,10B,49B,54B,83B,94B,119B,132B ''challenges.dailylimit'':48B ''challenges.expiryhours'':57B ''check'':37B ''choos'':12B ''chosen'':27B ''cleanup'':75B ''complet'':131B ''contain'':130B ''credit'':39B ''day'':51B ''display'':115B ''escrow'':91B ''even'':71B ''expir'':55B,60B,117B ''forfeitur'':107B ''format'':35B ''friend'':22B ''game'':3A,7B,14B,124B ''hide'':136B ''hour'':58B ''housekeep'':125B ''inbox'':141B,152B ''includ'':20B,105B ''job'':126B ''label'':61B ''longer'':66B ''may'':104B ''mean'':62B ''move'':89B ''new'':53B ''open'':9B ''peopl'':24B ''per'':50B ''pick'':32B ''play'':70B,112B ''player'':18B,87B,150B ''read'':113B ''recent'':30B ''refund'':121B ''remov'':145B ''result'':128B,135B ''round'':34B,109B ''rule'':103B ''run'':78B ''schedul'':74B ''select'':16B ''send'':1A,5B,42B,45B ''share'':29B ''stake'':40B,82B,88B,98B ''suggest'':19B ''tab'':129B ''term'':116B ''togeth'':92B ''unafford'':97B ''yet'':79B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('58845803-59c5-4b63-ac38-96c0e2356b58', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'edit-a-blog-post', 'Write and edit a blog post', '# Write and edit a blog post

Open Blogs, choose your blog and open its dashboard. Select a new article or page, then add a title and content. The editor shows your current word and post limits.

**Save draft** keeps an unpublished post private. **Publish** makes it available to readers. For a published post, **Save** stores your changes as a private revision; readers keep seeing the previous published version until you select Publish. **Unpublish** takes the post out of public view.

The editor keeps a recovery copy on your device for the signed-in account. This helps after a refresh, but clearing browser/app data can remove it. Save important work to the server as well.

Select Reward pot to open its controls. A new post needs to be saved before its pot can be funded. Pay-gating and reward pots are separate choices. Check all amounts before confirming a charge.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''account'':101B ''add'':29B ''amount'':153B ''articl'':25B ''avail'':53B ''blog'':5A,11B,14B,17B ''browser/app'':109B ''chang'':63B ''charg'':157B ''check'':151B ''choic'':150B ''choos'':15B ''clear'':108B ''confirm'':155B ''content'':33B ''control'':128B ''copi'':92B ''current'':38B ''dashboard'':21B ''data'':110B ''devic'':95B ''draft'':44B ''edit'':3A,9B ''editor'':35B,88B ''fund'':141B ''gate'':144B ''help'':103B ''import'':115B ''keep'':45B,69B,89B ''limit'':42B ''make'':51B ''need'':132B ''new'':24B,130B ''open'':13B,19B,126B ''page'':27B ''pay'':143B ''pay-gat'':142B ''post'':6A,12B,41B,48B,59B,82B,131B ''pot'':124B,138B,147B ''previous'':72B ''privat'':49B,66B ''public'':85B ''publish'':50B,58B,73B,78B ''reader'':55B,68B ''recoveri'':91B ''refresh'':106B ''remov'':112B ''revis'':67B ''reward'':123B,146B ''save'':43B,60B,114B,135B ''see'':70B ''select'':22B,77B,122B ''separ'':149B ''server'':119B ''show'':36B ''sign'':99B ''signed-in'':98B ''store'':61B ''take'':80B ''titl'':31B ''unpublish'':47B,79B ''version'':74B ''view'':86B ''well'':121B ''word'':39B ''work'':116B ''write'':1A,7B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('d430bdc1-f707-4437-b647-4d349b67e559', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'use-wikis', 'Read and contribute to a wiki', '# Read and contribute to a wiki

Open [Wikis](/wiki), choose a subject and search or browse its pages. A wiki groups reference pages about one topic. Read the wiki description so you know what belongs there.

If you want to help, check its contribution policy. Some wikis allow contributions from everyone; others require an invitation or owner permission. Creation and page limits depend on the current plan settings shown in the app.

To create a page, choose a specific title and write an introduction, useful sections and sources. To improve a page, use Edit, explain the change and save it. Keep the page focused on the subject rather than promoting yourself or a product.

The revision history helps people see how a page changed. A moderator may review or remove a contribution. If a page has a reward pot, read the qualifying action and current pot state; simply visiting or editing does not guarantee a payout.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/wiki'':15B ''action'':149B ''allow'':54B ''app'':78B ''belong'':41B ''brows'':22B ''chang'':103B,130B ''check'':48B ''choos'':16B,83B ''contribut'':3A,9B,50B,55B,138B ''creat'':80B ''creation'':65B ''current'':72B,151B ''depend'':69B ''descript'':36B ''edit'':100B,157B ''everyon'':57B ''explain'':101B ''focus'':110B ''group'':27B ''guarante'':160B ''help'':47B,124B ''histori'':123B ''improv'':96B ''introduct'':90B ''invit'':61B ''keep'':107B ''know'':39B ''limit'':68B ''may'':133B ''moder'':132B ''one'':31B ''open'':13B ''other'':58B ''owner'':63B ''page'':24B,29B,67B,82B,98B,109B,129B,141B ''payout'':162B ''peopl'':125B ''permiss'':64B ''plan'':73B ''polici'':51B ''pot'':145B,152B ''product'':120B ''promot'':116B ''qualifi'':148B ''rather'':114B ''read'':1A,7B,33B,146B ''refer'':28B ''remov'':136B ''requir'':59B ''review'':134B ''revis'':122B ''reward'':144B ''save'':105B ''search'':20B ''section'':92B ''see'':126B ''set'':74B ''shown'':75B ''simpli'':154B ''sourc'':94B ''specif'':85B ''state'':153B ''subject'':18B,113B ''titl'':86B ''topic'':32B ''use'':91B,99B ''visit'':155B ''want'':45B ''wiki'':6A,12B,14B,26B,35B,53B ''write'':88B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('9dffecbe-ce91-48d8-881d-ace8f922cbcf', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'ask-ai-or-support', 'Ask AI or contact Support', '# Ask AI or contact Support

Use the Ask AI box at the end of a help document for questions about using Zobia. Tell it what you were trying to do and what happened. Do not include passwords, PINs, payment secrets or private identity documents.

The Free plan includes {{help.aiFreeWeeklyLimit}} questions per week. Your usage notice appears as you approach the limit. The reset date is shown in the notice. A paid question after the allowance costs {{help.aiQuestionCost}} {{currency.softPlural}}; you must confirm the displayed charge first. Failed answers release the question allowance and refund any question charge.

AI answers can be incomplete. If an answer does not solve your problem, browse or search [Help](/help), or use the Contact a real person option. Your support eligibility and any ticket cost are shown before you submit a ticket.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/help'':119B ''ai'':2A,7B,14B,102B ''allow'':80B,96B ''answer'':92B,103B,109B ''appear'':61B ''approach'':64B ''ask'':1A,6B,13B ''box'':15B ''brows'':115B ''charg'':89B,101B ''confirm'':86B ''contact'':4A,9B,123B ''cost'':81B,134B ''currency.softplural'':83B ''date'':69B ''display'':88B ''document'':22B,49B ''elig'':130B ''end'':18B ''fail'':91B ''first'':90B ''free'':51B ''happen'':38B ''help'':21B,118B ''help.aifreeweeklylimit'':54B ''help.aiquestioncost'':82B ''ident'':48B ''includ'':41B,53B ''incomplet'':106B ''limit'':66B ''must'':85B ''notic'':60B,74B ''option'':127B ''paid'':76B ''password'':42B ''payment'':44B ''per'':56B ''person'':126B ''pin'':43B ''plan'':52B ''privat'':47B ''problem'':114B ''question'':24B,55B,77B,95B,100B ''real'':125B ''refund'':98B ''releas'':93B ''reset'':68B ''search'':117B ''secret'':45B ''shown'':71B,136B ''solv'':112B ''submit'':139B ''support'':5A,10B,129B ''tell'':28B ''ticket'':133B,141B ''tri'':33B ''usag'':59B ''use'':11B,26B,121B ''week'':57B ''zobia'':27B', '2026-10-23 11:26:32.933848+00', '2026-10-23 11:26:32.933848+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('4bbd00e0-c8c7-468f-8097-068124510cf5', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'read-tales', 'Read stories chapter by chapter', '# Read stories on Tales

Open [Tales](/t) and choose a story. The first chapter is always free and can be read without signing in. At the end, choose **Continue to next part**. Sign in or create an account to read further chapters; Zobia keeps the destination through sign-in and onboarding.

Some chapters cost {{currency.softPlural}}. The price appears before you pay. Open [Wallet](/wallet) to check your balance, including welcome credits. Confirm the deduction to unlock the chapter. An unlocked chapter stays available to your account while the author and content remain available. If a price changes, review and confirm the current price again.

You can vote, comment when the author allows it, subscribe to an author, or share a link. Some funded reward pots pay eligible distinct readers for sharing. A pot can run out, so a share does not guarantee a reward. Use **Report story** for content that breaks the rules.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/t'':12B ''/wallet'':70B ''account'':43B,92B ''allow'':118B ''alway'':21B ''appear'':64B ''author'':95B,117B,123B ''avail'':89B,99B ''balanc'':74B ''break'':157B ''chang'':103B ''chapter'':3A,5A,19B,47B,59B,84B,87B ''check'':72B ''choos'':14B,33B ''comment'':114B ''confirm'':78B,106B ''content'':97B,155B ''continu'':34B ''cost'':60B ''creat'':41B ''credit'':77B ''currency.softplural'':61B ''current'':108B ''deduct'':80B ''destin'':51B ''distinct'':134B ''elig'':133B ''end'':32B ''first'':18B ''free'':22B ''fund'':129B ''guarante'':148B ''includ'':75B ''keep'':49B ''link'':127B ''next'':36B ''onboard'':57B ''open'':10B,68B ''part'':37B ''pay'':67B,132B ''pot'':131B,139B ''price'':63B,102B,109B ''read'':1A,6B,26B,45B ''reader'':135B ''remain'':98B ''report'':152B ''review'':104B ''reward'':130B,150B ''rule'':159B ''run'':141B ''share'':125B,137B,145B ''sign'':28B,38B,54B ''sign-in'':53B ''stay'':88B ''stori'':2A,7B,16B,153B ''subscrib'':120B ''tale'':9B,11B ''unlock'':82B,86B ''use'':151B ''vote'':113B ''wallet'':69B ''welcom'':76B ''without'':27B ''zobia'':48B', '2026-10-23 11:26:32.99458+00', '2026-10-23 11:26:32.99458+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('f9e577c8-7915-40fc-a6fc-af587758cf1b', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'write-tales', 'Write and publish a story', '# Write your story

Reach Level {{tales.minLevel}} to write. Open [Tales](/t), choose **Write a story**, and save the story details as a draft. Add an optional cover, a synopsis and chapters. Draft recovery belongs to your account and helps protect unsaved text on the same device.

Free writers can keep {{tales.publishedLimit}} published stories and {{tales.draftLimit}} draft stories. Paid plans allow unlimited stories and drafts. Publish approved chapters individually or all at once. Chapter one must be free. Publish an approved first chapter before publishing the story itself. Paid plans can schedule chapters for later; scheduled publishing pauses when the account no longer has a paid plan.

A story default price applies to further chapters unless a chapter overrides it. A chapter price of zero makes that chapter free. Paid chapter sales transfer the configured author share to the author in {{currency.softPlural}}. You may remove paywalls, control comments and choose subscriber notifications. You can fund a reward pot for the story or a chapter; funding deducts credits and closing refunds the unclaimed amount.

Stories and covers are checked before public reading. Clean romance is allowed. Explicit sexual content and unrelated advertising are not. Uncertain reviews go to staff. You can appeal a rejected story, chapter or Tales account restriction up to {{tales.appealLimit}} times per target. Read the reason and explain what should be reconsidered.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/t'':16B ''account'':42B,105B,212B ''add'':29B ''advertis'':195B ''allow'':65B,189B ''amount'':177B ''appeal'':205B ''appli'':116B ''approv'':71B,85B ''author'':140B,144B ''belong'':39B ''chapter'':36B,72B,78B,87B,97B,119B,122B,126B,132B,135B,168B,209B ''check'':182B ''choos'':17B,154B ''clean'':186B ''close'':173B ''comment'':152B ''configur'':139B ''content'':192B ''control'':151B ''cover'':32B,180B ''credit'':171B ''currency.softplural'':146B ''deduct'':170B ''default'':114B ''detail'':25B ''devic'':51B ''draft'':28B,37B,61B,69B ''explain'':224B ''explicit'':190B ''first'':86B ''free'':52B,82B,133B ''fund'':159B,169B ''go'':200B ''help'':44B ''individu'':73B ''keep'':55B ''later'':99B ''level'':10B ''longer'':107B ''make'':130B ''may'':148B ''must'':80B ''notif'':156B ''one'':79B ''open'':14B ''option'':31B ''overrid'':123B ''paid'':63B,93B,110B,134B ''paus'':102B ''paywal'':150B ''per'':218B ''plan'':64B,94B,111B ''pot'':162B ''price'':115B,127B ''protect'':45B ''public'':184B ''publish'':3A,57B,70B,83B,89B,101B ''reach'':9B ''read'':185B,220B ''reason'':222B ''reconsid'':228B ''recoveri'':38B ''refund'':174B ''reject'':207B ''remov'':149B ''restrict'':213B ''review'':199B ''reward'':161B ''romanc'':187B ''sale'':136B ''save'':22B ''schedul'':96B,100B ''sexual'':191B ''share'':141B ''staff'':202B ''stori'':5A,8B,20B,24B,58B,62B,67B,91B,113B,165B,178B,208B ''subscrib'':155B ''synopsi'':34B ''tale'':15B,211B ''tales.appeallimit'':216B ''tales.draftlimit'':60B ''tales.minlevel'':11B ''tales.publishedlimit'':56B ''target'':219B ''text'':47B ''time'':217B ''transfer'':137B ''uncertain'':198B ''unclaim'':176B ''unless'':120B ''unlimit'':66B ''unrel'':194B ''unsav'':46B ''write'':1A,6B,13B,18B ''writer'':53B ''zero'':129B', '2026-10-23 11:26:32.99458+00', '2026-10-23 11:26:32.99458+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('a7790bf4-9605-4697-922c-8dfaa52fc09e', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'join-forum-discussions', 'Join a forum discussion', '# Join a forum discussion

Open [Forum](/forum) and choose a board that matches your topic. Read the board description and a few existing discussions first. Search for your question before starting another thread.

Choose a thread to read its opening post and replies. Use Reply to add to the discussion. If you quote another reply, keep only the part you are answering. A useful reply explains what you mean, gives an example and stays on the topic.

To start a discussion, choose the new-thread action, pick a clear title and write the opening post. Review the preview and any image or reward-pot cost shown before posting. If an action is unavailable, check the level or plan notice rather than repeatedly submitting it.

You can report a post that breaks the rules. Disagree with ideas without attacking the person. Never put passwords, payment codes or someone else''s private information in a public thread.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/forum'':11B ''action'':91B,117B ''add'':51B ''anoth'':36B,58B ''answer'':66B ''attack'':144B ''board'':15B,22B ''break'':137B ''check'':120B ''choos'':13B,38B,86B ''clear'':94B ''code'':151B ''cost'':111B ''descript'':23B ''disagre'':140B ''discuss'':4A,8B,28B,54B,85B ''els'':154B ''exampl'':76B ''exist'':27B ''explain'':70B ''first'':29B ''forum'':3A,7B,10B ''give'':74B ''idea'':142B ''imag'':106B ''inform'':157B ''join'':1A,5B ''keep'':60B ''level'':122B ''match'':17B ''mean'':73B ''never'':147B ''new'':89B ''new-thread'':88B ''notic'':125B ''open'':9B,44B,99B ''part'':63B ''password'':149B ''payment'':150B ''person'':146B ''pick'':92B ''plan'':124B ''post'':45B,100B,114B,135B ''pot'':110B ''preview'':103B ''privat'':156B ''public'':160B ''put'':148B ''question'':33B ''quot'':57B ''rather'':126B ''read'':20B,42B ''repeat'':128B ''repli'':47B,49B,59B,69B ''report'':133B ''review'':101B ''reward'':109B ''reward-pot'':108B ''rule'':139B ''search'':30B ''shown'':112B ''someon'':153B ''start'':35B,83B ''stay'':78B ''submit'':129B ''thread'':37B,40B,90B,161B ''titl'':95B ''topic'':19B,81B ''unavail'':119B ''use'':48B,68B ''without'':143B ''write'':97B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('73b15c02-1370-4902-bc8b-afa93ff51218', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'ask-and-answer', 'Ask and answer questions', '# Ask and answer questions

[Answers](/answers) is for questions that other people can answer. Search first. If the answer is not already there, choose Ask and select the best category.

Use a title that says what you need to know. In the question, explain what you tried and which part is confusing. Avoid putting several unrelated questions in one post. Check the page for any level requirement before writing a long question.

When answering, explain the steps and say when your advice may not apply. Link to a reliable source when it helps. If you do not know, it is fine to ask a clarifying question instead of guessing.

Votes help other readers find useful contributions. The question author can mark the answer that solved the problem when that option is available. Comments, votes and accepted answers have different purposes; do not use reports to punish an answer you simply disagree with.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/answers'':10B ''accept'':140B ''advic'':86B ''alreadi'':26B ''answer'':3A,7B,9B,18B,23B,78B,127B,141B,152B ''appli'':89B ''ask'':1A,5B,29B,107B ''author'':123B ''avail'':136B ''avoid'':57B ''best'':33B ''categori'':34B ''check'':65B ''choos'':28B ''clarifi'':109B ''comment'':137B ''confus'':56B ''contribut'':120B ''differ'':143B ''disagre'':155B ''explain'':48B,79B ''find'':118B ''fine'':105B ''first'':20B ''guess'':113B ''help'':97B,115B ''instead'':111B ''know'':44B,102B ''level'':70B ''link'':90B ''long'':75B ''mark'':125B ''may'':87B ''need'':42B ''one'':63B ''option'':134B ''page'':67B ''part'':54B ''peopl'':16B ''post'':64B ''problem'':131B ''punish'':150B ''purpos'':144B ''put'':58B ''question'':4A,8B,13B,47B,61B,76B,110B,122B ''reader'':117B ''reliabl'':93B ''report'':148B ''requir'':71B ''say'':39B,83B ''search'':19B ''select'':31B ''sever'':59B ''simpli'':154B ''solv'':129B ''sourc'':94B ''step'':81B ''titl'':37B ''tri'':51B ''unrel'':60B ''use'':35B,119B,147B ''vote'':114B,138B ''write'':73B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('82945143-b6e8-4f56-b5c6-c5b6d23160cd', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'moments-and-tweets', 'Share a Moment or Tweet', '# Share a Moment or Tweet

Use [Moments](/moments) for updates on the Moments wall and [Tweets](/tweets) for short posts and conversations. Choose the composer in the area you want to use.

Write your text and add media only if you want it. Check the audience, preview and any current media cost before publishing. A disabled composer may mean you have not reached the required level or an administrator has turned that feature off.

A reply continues a conversation. A share or repost brings an existing post to more people. Give credit to the original author and avoid posting the same message repeatedly.

Hashtags connect related public posts. Use a few relevant terms rather than filling a post with unrelated tags. Public posts can be read by people outside your friend list. Remove private details before sharing. Use the report action for content that breaks the rules.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/moments'':13B ''/tweets'':22B ''action'':146B ''add'':42B ''administr'':74B ''area'':33B ''audienc'':51B ''author'':101B ''avoid'':103B ''break'':150B ''bring'':89B ''check'':49B ''choos'':28B ''compos'':30B,62B ''connect'':110B ''content'':148B ''continu'':82B ''convers'':27B,84B ''cost'':57B ''credit'':97B ''current'':55B ''detail'':140B ''disabl'':61B ''exist'':91B ''featur'':78B ''fill'':121B ''friend'':136B ''give'':96B ''hashtag'':109B ''level'':71B ''list'':137B ''may'':63B ''mean'':64B ''media'':43B,56B ''messag'':107B ''moment'':3A,8B,12B,18B ''origin'':100B ''outsid'':134B ''peopl'':95B,133B ''post'':25B,92B,104B,113B,123B,128B ''preview'':52B ''privat'':139B ''public'':112B,127B ''publish'':59B ''rather'':119B ''reach'':68B ''read'':131B ''relat'':111B ''relev'':117B ''remov'':138B ''repeat'':108B ''repli'':81B ''report'':145B ''repost'':88B ''requir'':70B ''rule'':152B ''share'':1A,6B,86B,142B ''short'':24B ''tag'':126B ''term'':118B ''text'':40B ''turn'':76B ''tweet'':5A,10B,21B ''unrel'':125B ''updat'':15B ''use'':11B,37B,114B,143B ''wall'':19B ''want'':35B,47B ''write'':38B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('fedd186e-13d0-420e-8d91-14b8d8902a11', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'polls-and-quizzes', 'Take part in polls and quizzes', '# Take part in polls and quizzes

Open [Polls](/polls) to answer a poll or [Quizzes](/quizzes) to test what you know. Read the question, choices and any explanation before submitting.

A poll collects opinions. A quiz checks answers against the creator''s chosen answers. Some quizzes require a passing score before an associated reward can be claimed. The page shows the current rules, closing time and reward state.

When creating content, use a clear question and choices that are easy to tell apart. Check the creation-level notice, time settings and preview. If you fund a reward pot, review the total deduction and claimant limit before confirming. Edit the existing pot to change its total; close it to refund what remains unclaimed.

A reward is not guaranteed just because a page shows a pot. You must meet the qualifying action, and the pot must still have available funds and claimant places. Report misleading or unsafe content using its report action.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/polls'':15B ''/quizzes'':22B ''action'':147B,167B ''answer'':17B,44B,50B ''apart'':89B ''associ'':59B ''avail'':154B ''chang'':120B ''check'':43B,90B ''choic'':31B,83B ''chosen'':49B ''claim'':63B ''claimant'':111B,157B ''clear'':80B ''close'':70B,123B ''collect'':39B ''confirm'':114B ''content'':77B,163B ''creat'':76B ''creation'':93B ''creation-level'':92B ''creator'':47B ''current'':68B ''deduct'':109B ''easi'':86B ''edit'':115B ''exist'':117B ''explan'':34B ''fund'':102B,155B ''guarante'':134B ''know'':27B ''level'':94B ''limit'':112B ''meet'':144B ''mislead'':160B ''must'':143B,151B ''notic'':95B ''open'':13B ''opinion'':40B ''page'':65B,138B ''part'':2A,8B ''pass'':55B ''place'':158B ''poll'':4A,10B,14B,19B,38B ''pot'':105B,118B,141B,150B ''preview'':99B ''qualifi'':146B ''question'':30B,81B ''quiz'':42B ''quizz'':6A,12B,21B,52B ''read'':28B ''refund'':126B ''remain'':128B ''report'':159B,166B ''requir'':53B ''review'':106B ''reward'':60B,73B,104B,131B ''rule'':69B ''score'':56B ''set'':97B ''show'':66B,139B ''state'':74B ''still'':152B ''submit'':36B ''take'':1A,7B ''tell'':88B ''test'':24B ''time'':71B,96B ''total'':108B,122B ''unclaim'':129B ''unsaf'':162B ''use'':78B,164B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('bf98bffa-6736-4e03-a1a8-37f88321dc7b', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'friends-and-messages', 'Find friends and send a message', '# Find friends and send a message

Open [Friends](/friends) and search for a username or display name. Open the profile to check that you found the right person, then send a friend request if requests are available. The other person decides whether to accept it.

Open [Messages](/messages) to read your conversations or start one with a selected person. Check the username and write your message. Any current message or attachment cost is shown by the app. A delivery problem or expired session does not mean the other person has read your message.

Do not send repeated messages to someone who is not responding. Use mute, block or report when needed. Keep payment codes, passwords and private account information out of messages.

Online and recent indicators follow both people''s privacy choices. If you hide your activity, you also stop seeing other people''s activity. [Privacy settings](/settings/privacy) explains the current eligibility and controls.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/friends'':15B ''/messages'':54B ''/settings/privacy'':154B ''accept'':50B ''account'':124B ''activ'':143B,151B ''also'':145B ''app'':83B ''attach'':77B ''avail'':43B ''block'':113B ''check'':28B,66B ''choic'':138B ''code'':120B ''control'':160B ''convers'':58B ''cost'':78B ''current'':74B,157B ''decid'':47B ''deliveri'':85B ''display'':22B ''elig'':158B ''expir'':88B ''explain'':155B ''find'':1A,7B ''follow'':133B ''found'':31B ''friend'':2A,8B,14B,38B ''hide'':141B ''indic'':132B ''inform'':125B ''keep'':118B ''mean'':92B ''messag'':6A,12B,53B,72B,75B,99B,104B,128B ''mute'':112B ''name'':23B ''need'':117B ''one'':61B ''onlin'':129B ''open'':13B,24B,52B ''password'':121B ''payment'':119B ''peopl'':135B,149B ''person'':34B,46B,65B,95B ''privaci'':137B,152B ''privat'':123B ''problem'':86B ''profil'':26B ''read'':56B,97B ''recent'':131B ''repeat'':103B ''report'':115B ''request'':39B,41B ''respond'':110B ''right'':33B ''search'':17B ''see'':147B ''select'':64B ''send'':4A,10B,36B,102B ''session'':89B ''set'':153B ''shown'':80B ''someon'':106B ''start'':60B ''stop'':146B ''use'':111B ''usernam'':20B,68B ''whether'':48B ''write'':70B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('a789a37e-98da-4e5c-b04d-cca2995f7b4f', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'group-conversations', 'Start and manage a group conversation', '# Group conversations

Open [Messages](/messages) and use the group creation option when your account is eligible. Choose a clear group name and invite the people who should join. The app shows the current member and group limits.

A group is a shared conversation. Messages are visible to its members, so check the member list before sharing private information. A room or classroom is a different feature and can have different access rules.

Group owners or authorized managers can use the available member controls. If a group becomes unavailable after a plan change, read the notice before creating another one. Upgrade or restore the appropriate entitlement when you want to recover a preserved group.

When you leave, you may lose access to later conversation content. Do not rely on an offline copy as a permanent record. Report harassment and block unwanted direct contact through the available safety controls.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/messages'':11B ''access'':77B,126B ''account'':20B ''anoth'':104B ''app'':36B ''appropri'':110B ''author'':82B ''avail'':87B,151B ''becom'':93B ''block'':145B ''chang'':98B ''check'':57B ''choos'':23B ''classroom'':68B ''clear'':25B ''contact'':148B ''content'':130B ''control'':89B,153B ''convers'':6A,8B,49B,129B ''copi'':137B ''creat'':103B ''creation'':16B ''current'':39B ''differ'':71B,76B ''direct'':147B ''elig'':22B ''entitl'':111B ''featur'':72B ''group'':5A,7B,15B,26B,42B,45B,79B,92B,119B ''harass'':143B ''inform'':64B ''invit'':29B ''join'':34B ''later'':128B ''leav'':122B ''limit'':43B ''list'':60B ''lose'':125B ''manag'':3A,83B ''may'':124B ''member'':40B,55B,59B,88B ''messag'':10B,50B ''name'':27B ''notic'':101B ''offlin'':136B ''one'':105B ''open'':9B ''option'':17B ''owner'':80B ''peopl'':31B ''perman'':140B ''plan'':97B ''preserv'':118B ''privat'':63B ''read'':99B ''record'':141B ''recov'':116B ''reli'':133B ''report'':142B ''restor'':108B ''room'':66B ''rule'':78B ''safeti'':152B ''share'':48B,62B ''show'':37B ''start'':1A ''unavail'':94B ''unwant'':146B ''upgrad'':106B ''use'':13B,85B ''visibl'':52B ''want'':114B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('c2862469-bf6d-4fa6-8a4f-866999855652', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'join-a-guild', 'Join a guild and contribute', '# Join a guild

Open [Guilds](/guilds) and browse groups that match your interests. Read the guild description, joining rules and any current requirements before applying or joining.

After joining, introduce yourself and check the guild''s announcements and activities. Quests, events or wars may have their own entry rules and deadlines. The page shows which actions count toward a contribution.

A guild role gives only the permissions described by the app. It does not make someone platform staff. Never send passwords or sign-in codes to a guild leader or another member.

Rewards and leaderboards depend on recorded qualifying activity. Repeating empty messages or arranging fake activity can lead to moderation. If you want to leave, use the membership controls and read any effect on current activities or rewards.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/guilds'':11B ''action'':61B ''activ'':44B,106B,113B,133B ''announc'':42B ''anoth'':97B ''app'':76B ''appli'':30B ''arrang'':111B ''brows'':13B ''check'':38B ''code'':91B ''contribut'':5A,65B ''control'':126B ''count'':62B ''current'':27B,132B ''deadlin'':56B ''depend'':102B ''describ'':73B ''descript'':22B ''effect'':130B ''empti'':108B ''entri'':53B ''event'':46B ''fake'':112B ''give'':69B ''group'':14B ''guild'':3A,8B,10B,21B,40B,67B,94B ''interest'':18B ''introduc'':35B ''join'':1A,6B,23B,32B,34B ''lead'':115B ''leader'':95B ''leaderboard'':101B ''leav'':122B ''make'':80B ''match'':16B ''may'':49B ''member'':98B ''membership'':125B ''messag'':109B ''moder'':117B ''never'':84B ''open'':9B ''page'':58B ''password'':86B ''permiss'':72B ''platform'':82B ''qualifi'':105B ''quest'':45B ''read'':19B,128B ''record'':104B ''repeat'':107B ''requir'':28B ''reward'':99B,135B ''role'':68B ''rule'':24B,54B ''send'':85B ''show'':59B ''sign'':89B ''sign-in'':88B ''someon'':81B ''staff'':83B ''toward'':63B ''use'':123B ''want'':120B ''war'':48B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('f8658009-4cb2-4173-89b7-3be3b73629e1', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'play-games', 'Play games and keep your progress', '# Play games

Open [Games](/games), choose a game and read its instructions before starting. The game page shows available modes, current entry costs and any limits or rewards.

If the game supports saved progress, use the game''s save controls. Available save slots depend on your current account entitlement. A saved game, a completed score and a challenge round are different records; wait for the completion result before leaving a scored session.

For a friend challenge, open [Challenges](/games/challenges), choose an eligible opponent and review the game, rounds and any Credit stake. Invitations expire according to the displayed deadline. A challenge that expires cannot be accepted or played afterward.

If a round does not finish, read the error and refresh the challenge status before trying again. Do not assume a local animation means a reward has been credited. Check [Wallet](/wallet) for actual transactions.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/games'':11B ''/games/challenges'':85B ''/wallet'':147B ''accept'':112B ''accord'':101B ''account'':54B ''actual'':149B ''afterward'':115B ''anim'':138B ''assum'':135B ''avail'':25B,47B ''cannot'':110B ''challeng'':64B,82B,84B,107B,128B ''check'':145B ''choos'':12B,86B ''complet'':60B,72B ''control'':46B ''cost'':29B ''credit'':97B,144B ''current'':27B,53B ''deadlin'':105B ''depend'':50B ''differ'':67B ''display'':104B ''elig'':88B ''entitl'':55B ''entri'':28B ''error'':124B ''expir'':100B,109B ''finish'':121B ''friend'':81B ''game'':2A,8B,10B,14B,22B,37B,43B,58B,93B ''instruct'':18B ''invit'':99B ''keep'':4A ''leav'':75B ''limit'':32B ''local'':137B ''mean'':139B ''mode'':26B ''open'':9B,83B ''oppon'':89B ''page'':23B ''play'':1A,7B,114B ''progress'':6A,40B ''read'':16B,122B ''record'':68B ''refresh'':126B ''result'':73B ''review'':91B ''reward'':34B,141B ''round'':65B,94B,118B ''save'':39B,45B,48B,57B ''score'':61B,77B ''session'':78B ''show'':24B ''slot'':49B ''stake'':98B ''start'':20B ''status'':129B ''support'':38B ''transact'':150B ''tri'':131B ''use'':41B ''wait'':69B ''wallet'':146B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('96c1281e-a673-4696-950e-04810fb81c6e', '577d584f-770b-4735-8233-f1fe78ee7a46', 'send-and-receive-gifts', 'Send and receive gifts', '# Send a gift

Open [Gifts](/gifts) and browse the catalog. Select the recipient carefully and review the gift, current price and currency. If a message option is available, write a message that is appropriate for the recipient.

Confirm only after checking the username and deduction. A gift is different from a cash payout or a subscription. Read the gift''s description to understand what it provides and whether a separate reward is involved.

Your history shows sent and received gifts. If the balance or history looks out of date, refresh it and wait for the transaction result before trying again. Repeated tapping does not make a delayed transaction finish sooner.

Never pay someone outside the official flow because they promise a special gift or account upgrade. Use the report and support options if another user asks for your password, PIN or payment code.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/gifts'':10B ''account'':129B ''anoth'':138B ''appropri'':38B ''ask'':140B ''avail'':32B ''balanc'':87B ''brows'':12B ''care'':18B ''cash'':56B ''catalog'':14B ''check'':45B ''code'':147B ''confirm'':42B ''currenc'':26B ''current'':23B ''date'':93B ''deduct'':49B ''delay'':111B ''descript'':65B ''differ'':53B ''finish'':113B ''flow'':121B ''gift'':4A,7B,9B,22B,51B,63B,84B,127B ''histori'':79B,89B ''involv'':77B ''look'':90B ''make'':109B ''messag'':29B,35B ''never'':115B ''offici'':120B ''open'':8B ''option'':30B,136B ''outsid'':118B ''password'':143B ''pay'':116B ''payment'':146B ''payout'':57B ''pin'':144B ''price'':24B ''promis'':124B ''provid'':70B ''read'':61B ''receiv'':3A,83B ''recipi'':17B,41B ''refresh'':94B ''repeat'':105B ''report'':133B ''result'':101B ''review'':20B ''reward'':75B ''select'':15B ''send'':1A,5B ''sent'':81B ''separ'':74B ''show'':80B ''someon'':117B ''sooner'':114B ''special'':126B ''subscript'':60B ''support'':135B ''tap'':106B ''transact'':100B,112B ''tri'':103B ''understand'':67B ''upgrad'':130B ''use'':131B ''user'':139B ''usernam'':47B ''wait'':97B ''whether'':72B ''write'':33B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('f9aa2e4f-a692-4eed-89da-4a9ee26fe0f9', '42b9e7c4-9668-43dc-98d1-ed7c56aba743', 'referrals-and-invitations', 'Invite someone with your referral link', '# Invite someone

Open [Referrals](/referrals) to find your referral link and the current reward rules. Share the link with someone who wants to join Zobia.

The invited person must complete the required steps shown in the referral rules. A click, an account creation and a completed qualifying action are different events. A reward appears only after the server records the required activity and any checks are complete.

Use your own link and explain what you are inviting people to. Do not create fake accounts, buy artificial signups or promise rewards that the app does not offer.

The referral page shows recorded progress. If something looks wrong, refresh it and check the eligibility rules before contacting support. Include the relevant username or reference, but never share account secrets.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/referrals'':11B ''account'':48B,90B,132B ''action'':54B ''activ'':68B ''app'':99B ''appear'':60B ''artifici'':92B ''buy'':91B ''check'':71B,116B ''click'':46B ''complet'':36B,52B,73B ''contact'':121B ''creat'':88B ''creation'':49B ''current'':19B ''differ'':56B ''elig'':118B ''event'':57B ''explain'':79B ''fake'':89B ''find'':13B ''includ'':123B ''invit'':1A,7B,33B,83B ''join'':30B ''link'':6A,16B,24B,77B ''look'':111B ''must'':35B ''never'':130B ''offer'':102B ''open'':9B ''page'':105B ''peopl'':84B ''person'':34B ''progress'':108B ''promis'':95B ''qualifi'':53B ''record'':65B,107B ''refer'':128B ''referr'':5A,10B,15B,43B,104B ''refresh'':113B ''relev'':125B ''requir'':38B,67B ''reward'':20B,59B,96B ''rule'':21B,44B,119B ''secret'':133B ''server'':64B ''share'':22B,131B ''show'':106B ''shown'':40B ''signup'':93B ''someon'':2A,8B,26B ''someth'':110B ''step'':39B ''support'':122B ''use'':74B ''usernam'':126B ''want'':28B ''wrong'':112B ''zobia'':31B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('3f0dcd42-54a7-47fa-adb2-bfde090a591d', '8975cf71-f982-4067-bc4c-d1b42d4b65e1', 'notifications-and-announcements', 'Manage notifications and announcements', '# Notifications and announcements

Open [Notifications](/notifications) to see account events, activity and notices. Select an available action to open the related content. A notification is a pointer to the current content; a removed post or expired activity may no longer be available.

Public platform announcements appear in [Announcements](/announcements). A personal conversation is found in Messages instead. Check the sender and destination before following any instruction that asks you to pay or change account details.

Notification preferences and device permissions work together. The app cannot show a device notification if the operating system has denied permission. Use the app''s settings and your device''s notification settings to adjust them.

Marking a notice read is different from completing the action it describes. Check the related page or Wallet for the actual result. Staff will not ask you to reply with a password, sign-in code or PIN.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/announcements'':53B ''/notifications'':10B ''account'':13B,78B ''action'':21B,124B ''activ'':15B,41B ''actual'':135B ''adjust'':113B ''announc'':4A,7B,49B,52B ''app'':88B,103B ''appear'':50B ''ask'':72B,140B ''avail'':20B,46B ''cannot'':89B ''chang'':77B ''check'':62B,127B ''code'':150B ''complet'':122B ''content'':26B,35B ''convers'':56B ''current'':34B ''deni'':99B ''describ'':126B ''destin'':66B ''detail'':79B ''devic'':83B,92B,108B ''differ'':120B ''event'':14B ''expir'':40B ''follow'':68B ''found'':58B ''instead'':61B ''instruct'':70B ''longer'':44B ''manag'':1A ''mark'':115B ''may'':42B ''messag'':60B ''notic'':17B,117B ''notif'':2A,5B,9B,28B,80B,93B,110B ''open'':8B,23B ''oper'':96B ''page'':130B ''password'':146B ''pay'':75B ''permiss'':84B,100B ''person'':55B ''pin'':152B ''platform'':48B ''pointer'':31B ''post'':38B ''prefer'':81B ''public'':47B ''read'':118B ''relat'':25B,129B ''remov'':37B ''repli'':143B ''result'':136B ''see'':12B ''select'':18B ''sender'':64B ''set'':105B,111B ''show'':90B ''sign'':148B ''sign-in'':147B ''staff'':137B ''system'':97B ''togeth'':86B ''use'':101B ''wallet'':132B ''work'':85B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('6e50582b-45ec-4b92-8f0e-c74f1bbead16', '8975cf71-f982-4067-bc4c-d1b42d4b65e1', 'report-a-problem', 'Report unsafe content or get support', '# Report a problem

Use the report action on the specific story, post, message or profile that concerns you. Choose the closest reason and explain what happened. Include useful context without copying passwords, payment codes or unrelated private information.

A report goes to moderation; it does not guarantee that the content will be removed. Staff may review the context and automated classification. Do not submit the same report repeatedly or organize false reports against someone you disagree with.

For an account, purchase or technical problem, open [Help](/help) and use the support option. Explain what you were doing, what you expected and what happened. A payment reference can help support find the right transaction.

If your content or account was restricted, read the reason and use the available appeal route. Explain why the decision should be reconsidered and include relevant details. Appeal limits and eligibility are shown by the app.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/help'':93B ''account'':86B,124B ''action'':13B ''app'':155B ''appeal'':134B,147B ''autom'':66B ''avail'':133B ''choos'':25B ''classif'':67B ''closest'':27B ''code'':40B ''concern'':23B ''content'':3A,56B,122B ''context'':35B,64B ''copi'':37B ''decis'':139B ''detail'':146B ''disagre'':82B ''elig'':150B ''expect'':106B ''explain'':30B,99B,136B ''fals'':77B ''find'':116B ''get'':5A ''goe'':47B ''guarante'':53B ''happen'':32B,109B ''help'':92B,114B ''includ'':33B,144B ''inform'':44B ''limit'':148B ''may'':61B ''messag'':19B ''moder'':49B ''open'':91B ''option'':98B ''organ'':76B ''password'':38B ''payment'':39B,111B ''post'':18B ''privat'':43B ''problem'':9B,90B ''profil'':21B ''purchas'':87B ''read'':127B ''reason'':28B,129B ''reconsid'':142B ''refer'':112B ''relev'':145B ''remov'':59B ''repeat'':74B ''report'':1A,7B,12B,46B,73B,78B ''restrict'':126B ''review'':62B ''right'':118B ''rout'':135B ''shown'':152B ''someon'':80B ''specif'':16B ''staff'':60B ''stori'':17B ''submit'':70B ''support'':6A,97B,115B ''technic'':89B ''transact'':119B ''unrel'':42B ''unsaf'':2A ''use'':10B,34B,95B,131B ''without'':36B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.help_docs (id, category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, view_count, author_id, search_vector, created_at, updated_at, deleted_at) VALUES ('2b981f4e-abe0-49bb-92bb-2401bb826239', 'ddf157ff-d41c-4d76-a618-98ea0e7e3359', 'business-and-creator-tools', 'Find business and creator tools', '# Business and creator tools

A personal account, a creator feature and a business account have different purposes. Open [Business](/business) to compare current business options and requirements. Check the included limits and pricing before buying or upgrading.

Creator tools can include blogs, paid content, rooms, classes and earnings. Each feature shows its own eligibility, fees, revenue-share rules and available controls. Publishing content does not automatically make it eligible for a cash payout.

Keep descriptions, prices and promises accurate. Check the preview and payment settings before publishing. Use the available statistics to understand recorded views, purchases or participation rather than treating every interaction as earnings.

Identity checks, payout thresholds and account standing may affect withdrawals. Follow the official payout flow and provide only the information it requests. Never give another user your password, sign-in code or PIN to set up a business or creator feature.', '', 'first_time', 0, NULL, NULL, true, 0, NULL, '''/business'':25B ''account'':12B,19B,117B ''accur'':85B ''affect'':120B ''anoth'':136B ''automat'':72B ''avail'':66B,96B ''blog'':47B ''busi'':2A,6B,18B,24B,29B,150B ''buy'':40B ''cash'':78B ''check'':33B,86B,113B ''class'':51B ''code'':143B ''compar'':27B ''content'':49B,69B ''control'':67B ''creator'':4A,8B,14B,43B,152B ''current'':28B ''descript'':81B ''differ'':21B ''earn'':53B,111B ''elig'':59B,75B ''everi'':108B ''featur'':15B,55B,153B ''fee'':60B ''find'':1A ''flow'':126B ''follow'':122B ''give'':135B ''ident'':112B ''includ'':35B,46B ''inform'':131B ''interact'':109B ''keep'':80B ''limit'':36B ''make'':73B ''may'':119B ''never'':134B ''offici'':124B ''open'':23B ''option'':30B ''paid'':48B ''particip'':104B ''password'':139B ''payment'':90B ''payout'':79B,114B,125B ''person'':11B ''pin'':145B ''preview'':88B ''price'':38B,82B ''promis'':84B ''provid'':128B ''publish'':68B,93B ''purchas'':102B ''purpos'':22B ''rather'':105B ''record'':100B ''request'':133B ''requir'':32B ''revenu'':62B ''revenue-shar'':61B ''room'':50B ''rule'':64B ''set'':91B,147B ''share'':63B ''show'':56B ''sign'':141B ''sign-in'':140B ''stand'':118B ''statist'':97B ''threshold'':115B ''tool'':5A,9B,44B ''treat'':107B ''understand'':99B ''upgrad'':42B ''use'':94B ''user'':137B ''view'':101B ''withdraw'':121B', '2026-10-23 11:26:32.996777+00', '2026-10-23 11:26:32.996777+00', NULL);

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('business_tier', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('business_renew', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('subscription', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('coin_purchase', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('star_purchase', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at) VALUES ('merch_purchase', true, '[]', false, NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('a04a96c9-7123-45f5-b4d0-97d74213f18d', 'AFCON Season', 'Africa Cup of Nations — 1.5x competitor XP', 'cultural', 1.5, 0, '2026-01-10 00:00:00+00', '2026-02-28 23:59:59+00', true, NULL, false, NULL, NULL, NULL, NULL, '{"tracks": ["competitor"], "guild_war_points_multiplier": 1.5}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'none');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('d1760344-6cff-42e1-9936-7a0caf99f198', 'Nigerian Independence Day Double XP', 'Full-platform double XP on Oct 1st', 'cultural', 2.0, 0, '2025-10-01 00:00:00+00', '2025-10-01 23:59:59+00', true, NULL, true, 10, 1, 10, 1, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('43089a08-52c9-4b1a-9ad1-f8f903b4211e', 'Detty December Season', 'The biggest season of the year', 'cultural', 1.5, 0, '2025-12-01 00:00:00+00', '2025-12-31 23:59:59+00', true, NULL, true, 12, 1, 12, 31, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('ad918d19-1d9c-4990-afce-01409bcf8ef9', 'Valentine Gift Weekend', 'Double XP for gifts sent', 'cultural', 1.0, 0, '2026-02-13 00:00:00+00', '2026-02-15 23:59:59+00', true, NULL, true, 2, 13, 2, 15, '{"gift_xp_multiplier": 2}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('86f6e6dd-e017-4794-bad6-5d27c2a70443', 'Easter Celebration Weekend', 'Double gift XP across the platform', 'cultural', 1.0, 0, '2026-04-03 00:00:00+00', '2026-04-05 23:59:59+00', true, NULL, true, 4, 3, 4, 5, '{"gift_xp_multiplier": 2}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('ae629cc1-704b-4473-83cd-50de09a45302', 'Africa Freedom Day', 'Pan-African double XP on May 25th', 'cultural', 2.0, 0, '2026-05-25 00:00:00+00', '2026-05-25 23:59:59+00', true, NULL, true, 5, 25, 5, 25, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('d46ce76c-2b7c-4a53-9ffd-6465ba2de49d', 'Labour Day Boost', '1.5x XP on International Workers Day', 'cultural', 1.5, 0, '2026-05-01 00:00:00+00', '2026-05-01 23:59:59+00', true, NULL, true, 5, 1, 5, 1, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('870b9cb0-b318-429f-9022-6f3248fd2d93', 'African Union Day', 'Cross-continent guild alliance bonus weekend', 'cultural', 1.5, 0, '2026-07-10 00:00:00+00', '2026-07-12 23:59:59+00', true, NULL, true, 7, 10, 7, 12, '{"alliance_bonus": true}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('06f80ea9-7f03-4b97-8406-07a3b6ceef67', 'Eid al-Adha Celebration', 'Double gifting XP during the feast', 'cultural', 1.0, 0, '2026-06-06 00:00:00+00', '2026-06-08 23:59:59+00', true, NULL, true, 6, 6, 6, 8, '{"gift_xp_multiplier": 2}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('2f43f305-a678-4435-ab49-95019db12182', 'Eid al-Fitr Celebration', 'Community gifting bonus at end of Ramadan', 'cultural', 1.0, 0, '2026-03-30 00:00:00+00', '2026-03-31 23:59:59+00', true, NULL, true, 3, 30, 3, 31, '{"gift_xp_multiplier": 2}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('cef3d9d8-6d0f-4236-a8ed-24dddd7756bf', 'Black History Month', 'All-February 1.25x XP', 'cultural', 1.3, 0, '2026-02-01 00:00:00+00', '2026-02-28 23:59:59+00', true, NULL, true, 2, 1, 2, 28, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('114b3fcf-2649-4cbf-bdbe-734ff964e60b', 'Kwanzaa Week', 'Community and culture XP boost Dec 26-Jan 1', 'cultural', 1.5, 0, '2026-12-26 00:00:00+00', '2027-01-01 23:59:59+00', true, NULL, true, 12, 26, 1, 1, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('3d2bb341-2680-4520-9e8f-b63e2bad6db7', 'New Year Countdown', 'Triple XP in the final hour of the year', 'cultural', 3.0, 0, '2026-12-31 23:00:00+00', '2027-01-01 00:59:59+00', true, NULL, true, 12, 31, 1, 1, '{"city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('babd9a77-4dea-4bdd-bb07-89a43a406be0', 'New Year Hustle Season', 'Bonus XP for the first week of the year', 'cultural', 1.5, 0, '2026-01-01 01:00:00+00', '2026-01-07 23:59:59+00', true, NULL, true, 1, 1, 1, 7, '{"badge": "new_year_hustle_2026", "city_filter": null}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.platform_events (id, name, description, event_type, xp_multiplier, coin_bonus_pct, starts_at, ends_at, is_active, target_cities, is_recurring_annual, recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata, created_at, updated_at, created_by, recurrence_interval) VALUES ('0edf0589-e897-451d-9f2b-5a658dad1565', 'International Women''s Month — Creator Boost Week', 'Female creators earn 1.5x XP in first week of March', 'cultural', 1.5, 0, '2026-03-01 00:00:00+00', '2026-03-07 23:59:59+00', true, NULL, true, 3, 1, 3, 7, '{"boost_tracks": ["creator", "social"], "female_creator_only": true}', '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00', NULL, 'yearly');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('19793a00-5e0e-494d-a165-529d44bf7856', 'lagos', '3c327f35-217b-44a1-9a6b-3dccb00dc2ff', 'Lagos', 'The Centre of Excellence: food, nightlife, hustle and everything in between.', NULL, NULL, '#0d9488', 'official', '[]', NULL, 'Lagos', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('f10c451f-b40d-4f0c-b741-b04c68e304b4', 'abuja', '5ed3be35-4b1f-4592-8642-4f560411cf1c', 'Abuja', 'The capital city: events, people and places around FCT.', NULL, NULL, '#2563eb', 'official', '[]', NULL, 'Abuja', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('e1e18867-6f69-4d41-bc53-571404e1eb01', 'edo', '8fb6af05-07de-4a3a-9846-b2e15622c33b', 'Edo', 'Home of Benin City: culture, food, news and people.', NULL, NULL, '#d97706', 'official', '[]', NULL, 'Benin', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('a012e9df-e3a9-44fe-86a6-98a7885deed5', 'portharcourt', '63fcd542-eb13-41bb-ba90-9319f3bd6be2', 'Port Harcourt', 'The Garden City: music, food and the Rivers State community.', NULL, NULL, '#16a34a', 'official', '[]', NULL, 'Port Harcourt', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('3f90134a-9d57-45fa-ad94-05380f738db8', 'ibadan', 'da8f40cb-48bf-4e61-a908-356fba58b764', 'Ibadan', 'The city of brown roofs: Oyo State, campuses and culture.', NULL, NULL, '#b45309', 'official', '[]', NULL, 'Ibadan', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('e29acc96-a927-4aec-b096-efccde3d8ba7', 'kano', '816ccb54-c0b2-4bc5-ab7f-36b3d935806c', 'Kano', 'The ancient commercial centre of the north.', NULL, NULL, '#7c3aed', 'official', '[]', NULL, 'Kano', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('cc81e9aa-b85e-4d6e-b0cd-b1548fc6f70f', 'accra', '17e04548-60ef-4d81-916e-1839e09b60a2', 'Accra', 'Ghana''s capital: music, food and community.', NULL, NULL, '#dc2626', 'official', '[]', NULL, 'Accra', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('935ab656-3feb-4307-be4b-d589f6f9131b', 'nairobi', '4ac80a73-6196-41fd-b143-e565dc29e604', 'Nairobi', 'The green city in the sun: tech, music and life in Kenya.', NULL, NULL, '#0891b2', 'official', '[]', NULL, 'Nairobi', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('10fe64a8-66be-4d65-9349-0b5ea771ef55', 'detroit', '39afe8df-e051-4f62-933f-45b3f3087323', 'Detroit', 'Motor City: Naija in Detroit and the wider Michigan community.', NULL, NULL, '#475569', 'official', '[]', NULL, 'Detroit', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('83969cb9-582a-4130-98ca-ee79f785a4ef', 'london', 'a21e54b6-e21c-4e98-845d-11da8d854f66', 'London', 'Naija and Africans in London: events, food and meetups.', NULL, NULL, '#be123c', 'official', '[]', NULL, 'London', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('7cebe9cd-f0d7-4a6f-80ce-a3fc40dcbff4', 'uniben', 'e6fe88eb-022f-49fd-a77d-85f71fc06602', 'University of Benin', 'UNIBEN: campus life, news and the alumni network.', NULL, NULL, '#0f766e', 'official', '[]', NULL, 'UNIBEN', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('650349a2-02c8-46aa-b8b4-ae2e93e9261d', 'unilag', 'e2bab237-ce1e-42c8-8915-042e42c4464a', 'University of Lagos', 'UNILAG: the University of First Choice. Campus life and alumni.', NULL, NULL, '#1d4ed8', 'official', '[]', NULL, 'UNILAG', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('4b4eaf1a-760b-4197-8da1-c283da2926fc', 'oau', 'dff74236-dfa0-490e-8a97-f71e733530a6', 'Obafemi Awolowo University', 'OAU Ife: campus life, culture and alumni.', NULL, NULL, '#15803d', 'official', '[]', NULL, 'Obafemi Awolowo', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('57e34584-9598-487f-a79f-b71fd46cb14b', 'ui', 'cf8b3c66-2872-469a-87b9-08294081df24', 'University of Ibadan', 'UI: the premier university. Campus life and alumni.', NULL, NULL, '#a16207', 'official', '[]', NULL, 'University of Ibadan', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('db6471fe-400b-4d0e-917f-d77a328116cd', 'abu', '08dcfa2e-f800-4619-a0ef-a66a53c27dbd', 'Ahmadu Bello University', 'ABU Zaria: campus life and the alumni community.', NULL, NULL, '#7e22ce', 'official', '[]', NULL, 'Ahmadu Bello', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('c4622d18-22fd-4cfd-adc5-2bd8b68bc7f2', 'unn', '08f0e460-6ff7-439a-ab42-d654cfba9fbe', 'University of Nigeria, Nsukka', 'UNN: campus life, news and alumni.', NULL, NULL, '#c2410c', 'official', '[]', NULL, 'Nsukka', false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('8fdbfa8e-376b-444a-a64d-4f3efe14ae6c', 'naija', '49c4ef16-0adf-4327-9325-071de4e5776f', 'Naija', 'All things Nigeria: news, culture, humour and pride.', NULL, NULL, '#059669', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('0c92cc9b-953f-4a73-85fc-71666dbfe0f9', 'afrobeats', '845fa9a4-8df1-4f7a-9707-14a1141902ef', 'Afrobeats', 'New music, artists, playlists and the culture behind the sound.', NULL, NULL, '#db2777', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('895ee090-d74f-4c8d-8048-602cfe9e1551', 'football', 'da51b0e8-fe2e-498f-9836-030f772e3bd1', 'Football', 'Matchday chat, transfers and the beautiful game.', NULL, NULL, '#65a30d', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('d6f5f3a9-db35-4117-8f5d-fe6288038dd7', 'food', '8c6a27fc-87c6-4ddf-84c6-d2ac98eb1631', 'Food', 'Recipes, street food and restaurant finds.', NULL, NULL, '#ea580c', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('e4be24ad-73cf-416f-8d17-0aa991bb1453', 'jollof', 'd9e9edc1-2cdc-4e14-a946-a31a165f6eb5', 'Jollof', 'The great jollof debate and every rice dish you love.', NULL, NULL, '#dc2626', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.portals (id, slug, hashtag_id, title, tagline, description, cover_image_url, accent_color, status, sections, bb_board_id, city, is_pinned, boost_weight, boost_starts_at, boost_ends_at, sponsored_until, sponsor_name, follower_count, last_activity_at, created_by, created_at, updated_at) VALUES ('df1676a2-f0f5-4b73-a63e-52ddbbef1397', 'tech', '2a98d944-2930-4cfe-9a13-1c3f5b48ba8b', 'Tech', 'Builders, startups, gadgets and careers in tech.', NULL, NULL, '#4f46e5', 'official', '[]', NULL, NULL, false, 0, NULL, NULL, NULL, NULL, 0, '2026-10-23 11:26:32.897602+00', NULL, '2026-10-23 11:26:32.897602+00', '2026-10-23 11:26:32.897602+00');

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('6bb3d2d3-718b-4f63-b36e-9ba3875f9b84', 'Message Marathon', 'Send 10 messages today', 'messages', 10, 100, 10, 'social', 'free', 'social', '💬', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('5e67f853-d44e-4806-a621-0b0bdf85c8cf', 'Room Explorer', 'Join a Room you haven''t visited before', 'room_join', 1, 150, 0, 'explorer', 'free', 'explorer', '🚪', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('364bed2b-3893-4971-88c8-ca12d65f6af7', 'Be Generous', 'Gift any user today', 'gift', 1, 50, 5, 'generosity', 'free', 'generosity', '🎁', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('c15d8ed8-595e-413d-9eba-a75db09762a4', 'Streak Keeper', 'Log in for 7 consecutive days', 'login_streak', 7, 200, 50, 'main', 'free', 'general', '⭐', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('ff0a021e-49ad-4591-9cfc-9bd2aca7cfc2', 'Guild Quest', 'Complete a Guild Quest contribution', 'guild_quest', 1, 200, 0, 'competitor', 'free', 'general', '⭐', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('55259e42-ed0c-41e0-a863-6d67fb3003d4', 'XP Grinder', 'Earn 500 XP today', 'xp_meta', 500, 100, 20, 'main', 'free', 'general', '⭐', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('01d78317-c6af-474a-a700-f8f5cd0cf1fb', 'Social Butterfly', 'Send 25 messages today', 'messages', 25, 200, 20, 'social', 'plus', 'social', '💬', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('eb5115ee-ade7-4cd7-9902-ac611313305c', 'Room Master', 'Visit 3 different Rooms today', 'room_join', 3, 300, 30, 'explorer', 'pro', 'explorer', '🚪', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('802f3775-3f4e-48ca-854a-807121235806', 'Super Gifter', 'Send 3 gifts today', 'gift', 3, 150, 15, 'generosity', 'pro', 'generosity', '🎁', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('dd061afb-aa18-4623-b8a7-03a1812435c9', 'XP Champion', 'Earn 2000 XP today', 'xp_meta', 2000, 300, 50, 'main', 'max', 'general', '⭐', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('b4c0aa5b-737b-4f79-92a4-291e53dc3379', 'Game On', 'Play any game today', 'game_play', 1, 120, 15, 'gaming', 'free', 'games', '🎮', NULL, true, '2026-09-17 00:34:39.123121+00', 'games', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('e8581f17-11f1-4578-9c42-48cf51a372ba', 'Game Marathon', 'Play 3 game rounds today', 'game_play', 3, 150, 20, 'gaming', 'plus', 'games', '🕹️', NULL, true, '2026-09-17 00:34:39.123121+00', 'games', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('74ed2062-ddb7-45ba-9b72-1cb3a342d3dd', 'Storyteller', 'Publish a Blog post', 'blog_publish', 1, 250, 30, 'knowledge', 'free', 'blogs', '✍️', NULL, true, '2026-09-17 00:34:39.123121+00', 'blogs', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('57e93d69-744c-4f33-9ec5-fb826103ac23', 'Blog Engager', 'Comment on 2 Blog posts', 'blog_comment', 2, 100, 15, 'knowledge', 'free', 'blogs', '💬', NULL, true, '2026-09-17 00:34:39.123121+00', 'blogs', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('e23bce02-c4ed-4814-a04c-64eab55acafe', 'Wiki Contributor', 'Edit or create a Wiki article', 'wiki_edit', 1, 220, 25, 'knowledge', 'free', 'wiki', '📝', NULL, true, '2026-09-17 00:34:39.123121+00', 'wiki', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('70d176e1-b70e-460d-aa7e-bafde0b209ff', 'Make Your Voice Heard', 'Vote in a Poll today', 'poll_vote', 1, 60, 5, 'social', 'free', 'polls', '🗳️', NULL, true, '2026-09-17 00:34:39.123121+00', 'polls', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('5e7a1adf-17d3-4caa-81ef-61cafdcedd6d', 'Poll Creator', 'Create a Poll', 'poll_create', 1, 150, 15, 'social', 'free', 'polls', '📊', NULL, true, '2026-09-17 00:34:39.123121+00', 'polls', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('02b74e3a-3c14-41ed-b4b7-938b4ffe70d2', 'Quiz Whiz', 'Complete a Quiz today', 'quiz_complete', 1, 100, 15, 'knowledge', 'free', 'quizzes', '🧠', NULL, true, '2026-09-17 00:34:39.123121+00', 'quizzes', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('aa4ee392-404d-45a6-ba86-9c4c1bc1f5df', 'Perfect Score', 'Get a perfect score on any Quiz', 'quiz_perfect', 1, 220, 25, 'knowledge', 'free', 'quizzes', '💯', NULL, true, '2026-09-17 00:34:39.123121+00', 'quizzes', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('b1acb1e0-a5b1-474f-844f-25f1bd22ec40', 'Join the Discussion', 'Reply to a Forum thread', 'forum_reply', 1, 90, 10, 'social', 'free', 'forum', '🗨️', NULL, true, '2026-09-17 00:34:39.123121+00', 'bbforum', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('593d3417-fc3a-4409-af7e-0bf853468595', 'Start a Thread', 'Create a new Forum thread', 'forum_create_thread', 1, 180, 20, 'social', 'free', 'forum', '📌', NULL, true, '2026-09-17 00:34:39.123121+00', 'bbforum', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('43d152f4-df4c-4428-80f3-4094580b23ac', 'Spread the Love', 'Send a Gift to 2 different users today', 'gift', 2, 110, 15, 'generosity', 'free', 'gifts', '💝', NULL, true, '2026-09-17 00:34:39.123121+00', 'gifts', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('148e93b5-db7c-4eb8-a543-03893d63210f', 'Market Run', 'Visit the Market and buy something — any item counts.', 'market_purchase', 1, 60, 20, 'explorer', 'free', 'economy', 'shopping-bag', NULL, true, '2026-09-17 00:34:39.123121+00', NULL, NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('48345e49-45f0-4bd5-8cce-cd88734cb3c1', 'Win a challenge', 'Win a game challenge.', 'challenge_win', 1, 250, 0, 'explorer', 'free', 'games', NULL, NULL, true, '2026-10-23 11:26:32.908992+00', 'games', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('4f6f410e-8113-46c7-8ef1-213447cef2b8', 'Send a challenge', 'Invite someone to a game.', 'challenge_send', 1, 100, 0, 'explorer', 'free', 'games', NULL, NULL, true, '2026-10-23 11:26:32.908992+00', 'games', NULL);

INSERT INTO public.quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, valid_date, is_active, created_at, feature_key, sponsored_quest_id) VALUES ('f68a3dfa-3ad9-450c-8d1f-a67724131bb4', 'Accept a challenge', 'Accept a game invitation.', 'challenge_accept', 1, 150, 0, 'explorer', 'free', 'games', NULL, NULL, true, '2026-10-23 11:26:32.908992+00', 'games', NULL);

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('b211000b-da3c-40d2-a920-bd75bb19161e', 'Naija Vibes', 'Nigerian cultural expressions', '🇳🇬', NULL, 'free', 0, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'naija-vibes');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('15946b0e-0702-4c81-b2bc-c5769c2bf090', 'Flex Pack', 'Show off your style', '💎', NULL, 'earnable', 0, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'flex-pack');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('931b77d2-9d51-414c-b980-01cc9d1c9005', 'Boss Moves', 'Premium reactions', '👑', NULL, 'premium', 150, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'boss-moves');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('f2026569-f2ef-47b9-895b-7e2ff9412bb0', 'Naija Hausa', 'Northern Nigerian Hausa expressions', '🇳🇬', NULL, 'free', 0, NULL, 'ha', true, '2026-09-17 00:34:39.123121+00', 'naija-hausa');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('04377b30-c006-4782-867a-1564b0fc66b6', 'Yoruba Vibes', 'Yoruba cultural stickers', '🌟', NULL, 'free', 0, NULL, 'yo', true, '2026-09-17 00:34:39.123121+00', 'yoruba-vibes');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('717a51b7-809d-40b5-9b9f-034bb64fff8f', 'Igbo Pride', 'Igbo expressions and culture', '🦁', NULL, 'free', 0, NULL, 'ig', true, '2026-09-17 00:34:39.123121+00', 'igbo-pride');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('3ed5b73d-3105-407c-8ba7-4182be1e04bd', 'Swahili Soul', 'East African Swahili stickers', '🌍', NULL, 'free', 0, NULL, 'sw', true, '2026-09-17 00:34:39.123121+00', 'swahili-soul');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('294b9cd2-ef86-4962-a8ab-03e69369bb39', 'Arabic Flow', 'Arabic language expressions', '✨', NULL, 'free', 0, NULL, 'ar', true, '2026-09-17 00:34:39.123121+00', 'arabic-flow');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('cf40d2b1-44ea-4c20-b153-4172fade8dad', 'French Touch', 'Francophone African stickers', '🎭', NULL, 'free', 0, NULL, 'fr', true, '2026-09-17 00:34:39.123121+00', 'french-touch');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('1bceff18-3634-46ce-8200-44dbafea645e', 'Lusophone', 'Portuguese-speaking African stickers', '🌊', NULL, 'free', 0, NULL, 'pt', true, '2026-09-17 00:34:39.123121+00', 'lusophone');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('3e321f7d-10df-441f-8461-36e02620e7a0', 'Social Butterfly', 'Unlock at Social Level 5', '🦋', NULL, 'earnable', 0, 'Reach Social Level 5', NULL, true, '2026-09-17 00:34:39.123121+00', 'social-butterfly');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('947bcb9c-571d-4e18-b162-8486782c187d', 'Connector', 'Unlock at Social Level 10', '🔗', NULL, 'earnable', 0, 'Reach Social Level 10', NULL, true, '2026-09-17 00:34:39.123121+00', 'connector');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('b369cd70-7d1c-4193-b307-902575468f5a', 'Influencer Pack', 'Unlock at Social Level 20', '💫', NULL, 'earnable', 0, 'Reach Social Level 20', NULL, true, '2026-09-17 00:34:39.123121+00', 'influencer-pack');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('a75dd693-e3c4-4228-902f-4fee082bf064', 'Legend Pack', 'Unlock at Social Level 30', '🏆', NULL, 'earnable', 0, 'Reach Social Level 30', NULL, true, '2026-09-17 00:34:39.123121+00', 'legend-pack');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('17a9b699-fdad-4113-9f3f-d2efaeb41dfa', 'Prestige Pack', 'Unlock on first Prestige', '👑', NULL, 'earnable', 0, 'Achieve Prestige I', NULL, true, '2026-09-17 00:34:39.123121+00', 'prestige-pack');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('5977a6f7-0e9a-4463-b4d1-8d1847b381a6', 'Elite Reactions', 'Premium high-energy reactions', '⚡', NULL, 'premium', 100, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'elite-reactions');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('5f440569-3559-411e-b070-d0bb0d3f19e6', 'Luxury Flex', 'Show your premium status', '💎', NULL, 'premium', 250, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'luxury-flex');

INSERT INTO public.sticker_packs (id, name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, locale, is_active, created_at, slug) VALUES ('23420686-7de1-48a6-a453-347b1fd88d78', 'Zobia Exclusive', 'Ultra-rare exclusive stickers', '🌌', NULL, 'premium', 500, NULL, NULL, true, '2026-09-17 00:34:39.123121+00', 'zobia-exclusive');

INSERT INTO public.stickers (id, pack_id, name, emoji, image_url, "position", created_at) VALUES ('2e10ef72-2817-4eac-bf92-9a77a2da8c53', 'b211000b-da3c-40d2-a920-bd75bb19161e', 'Naija Pride', '🇳🇬', NULL, 1, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.stickers (id, pack_id, name, emoji, image_url, "position", created_at) VALUES ('0fe298d4-0aa4-4cc7-9856-3b13b319a24b', 'b211000b-da3c-40d2-a920-bd75bb19161e', 'Oya Now', '😤', NULL, 2, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.stickers (id, pack_id, name, emoji, image_url, "position", created_at) VALUES ('8bf0281c-2056-46b1-b75a-6afe2702a4b2', 'b211000b-da3c-40d2-a920-bd75bb19161e', 'No Cap', '🙅', NULL, 3, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.stickers (id, pack_id, name, emoji, image_url, "position", created_at) VALUES ('a1a340e5-de35-49ac-837b-d0c0020229ea', 'b211000b-da3c-40d2-a920-bd75bb19161e', 'Sapa Mode', '😭', NULL, 4, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.stickers (id, pack_id, name, emoji, image_url, "position", created_at) VALUES ('3b0455a7-2399-4d8c-8e17-041d98027126', 'b211000b-da3c-40d2-a920-bd75bb19161e', 'God Don Butter My Bread', '🙏', NULL, 5, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('bd68e138-9cef-4a8e-ae00-23479b828860', 'plus', 'Plus — Monthly', 'monthly', 50000, 'NGN', true, 10, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('825d696d-823c-47db-8a38-305417a8e083', 'pro', 'Pro — Monthly', 'monthly', 150000, 'NGN', true, 20, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('5fee7801-e609-4e6b-8ea0-7808dbed2a0c', 'max', 'Max — Monthly', 'monthly', 350000, 'NGN', true, 30, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('7bf67be0-f45b-40e0-b857-c28a7123956b', 'plus', 'Plus — Annual', 'annual', 500000, 'NGN', true, 11, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('aad47408-342d-4dbb-8b42-3503ade2417f', 'pro', 'Pro — Annual', 'annual', 1500000, 'NGN', true, 21, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.subscription_plans (id, plan, name, "interval", price_kobo, currency, is_active, sort_order, created_at, updated_at) VALUES ('1ae3ea33-127a-46be-a3ad-9521fbc91559', 'max', 'Max — Annual', 'annual', 3500000, 'NGN', true, 31, '2026-09-17 00:34:39.123121+00', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('minimum_age', '18', 'Minimum age for registration', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('auth_google_enabled', 'true', 'Enable Google OAuth', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('auth_telegram_enabled', 'true', 'Enable Telegram Login', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_nemesis_system', 'true', 'Enable Nemesis system', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_guild_wars', 'true', 'Enable Guild Wars', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_classrooms', 'true', 'Enable ClassRooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_community_notes', 'true', 'Enable Community Notes', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_star_purchase', 'false', 'Enable direct Star purchase', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_star_purchase_enabled', 'false', 'Enable direct Star purchase via store', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_merch_store', 'false', 'Enable Creator Merch Store', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_platform_council', 'true', 'Enable Platform Council', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_alliance_system', 'true', 'Enable Alliance System', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_business_accounts', 'true', 'Enable Business Accounts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_admob_ads', 'true', 'Enable AdMob ads', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_rewarded_ads', 'true', 'Enable rewarded video ads', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_rooms', 'true', 'Enable Rooms feature', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_direct_messages', 'true', 'Enable Direct Messages', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_gifts', 'true', 'Enable Gifts feature', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_rankings', 'true', 'Enable Rankings/Leaderboards', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_pin_auth', 'true', 'Enable PIN authentication', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_mystery_xp_drops', 'true', 'Enable Mystery XP Drop events', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('mystery_drop_batch_size', '50', 'Users per Mystery XP Drop', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('mystery_drop_days_per_week', '3', 'Mystery drop days per week', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pwa_web_enabled', 'true', 'Enable PWA on web', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pwa_android_enabled', 'false', 'Enable PWA on Android', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pwa_ios_enabled', 'false', 'Enable PWA on iOS', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('coin_to_cash_rate', '1', 'Kobo per coin (1 coin = 1 kobo = ₦0.01)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_threshold_kobo', '100000', 'Minimum payout in kobo (₦1,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_large_approval_kobo', '5000000', 'Manual approval threshold kobo (₦50,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_low_balance_alert_kobo', '10000000', 'Low balance alert kobo (₦100,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('vip_room_min_subscription_kobo', '20000', 'Min VIP Room subscription (₦200)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('vip_room_max_subscription_kobo', '1000000', 'Max VIP Room subscription (₦10,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('season_pass_price_coins', '500', 'Default Season Pass price in Coins', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_platform_fee_percent', '20', 'Platform fee % on creator earnings', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('dm_coin_cost_free', '2', 'DM coin cost Free tier', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('dm_coin_cost_plus', '1', 'DM coin cost Plus tier', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('dm_reply_limit_free', '25', 'Max DM replies/day Free plan', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('dm_reply_limit_plus', '50', 'Max DM replies/day Plus plan', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('email_all_enabled', 'true', 'Enable all email notifications', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('email_non_critical_enabled', 'true', 'Enable non-critical emails', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('cron_external_enabled', 'false', 'Use cron-jobs.org for high-frequency crons', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_moderation_enabled', 'true', 'Enable AI moderation', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_moderation_auto_action_threshold', '0.9', 'AI auto-action confidence threshold', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_moderation_community_threshold', '0.7', 'AI community review threshold', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payouts_enabled', 'true', 'Master payout toggle', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('nigeria_cash_payout_enabled', 'true', 'Nigeria bank transfer payouts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('nigeria_coins_payout_enabled', 'true', 'Nigeria coin-based payouts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('nigeria_crypto_payout_enabled', 'true', 'Nigeria USDT/Tron payouts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('global_coins_payout_enabled', 'true', 'Global coin-based payouts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('global_crypto_payout_enabled', 'true', 'Global USDT/Tron payouts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('nigeria_payout_auto_approve', 'true', 'Nigeria bank auto-approve', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_batch_size', '200', 'Max payouts per CRON run', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_max_retries', '3', 'Max payout retry attempts', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bank_account_first_add_xp', '5', 'XP on first bank account add', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bank_account_first_add_creator_xp', '10', 'Creator XP on first bank account add', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_tier1_coin_bonus', '100', 'Tier 1 referral coin bonus', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_tier1_xp_bonus', '500', 'Tier 1 referral XP bonus', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_tier2_coin_bonus', '50', 'Tier 2 referral coin bonus', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_tier2_xp_bonus', '250', 'Tier 2 referral XP bonus', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('auth_2fa_enabled', 'true', 'Allow users to configure two-factor authentication', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('auth_2fa_required_for_mods', 'false', 'Require 2FA for moderators before they can log in', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('privacy_can_lock_profile', '["pro", "max", "prestige_1"]', 'Plans/roles allowed to lock their profile (hide from non-friends). JSON array.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('privacy_can_hide_sections', '["plus", "pro", "max", "prestige_1"]', 'Plans/roles allowed to hide individual profile sections. JSON array.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('privacy_can_disable_friend_requests', '["plus", "pro", "max", "prestige_1"]', 'Plans/roles allowed to disable incoming friend requests. JSON array.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('captcha_provider', 'none', 'CAPTCHA provider: recaptcha | turnstile | none', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payment_provider_nigeria', 'paystack', 'Payment provider Nigeria', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_alliance_wars', 'true', 'Enable National Alliance Wars', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_creator_fund', 'true', 'Enable Creator Fund distributions', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_leaderboard_seasons', 'true', 'Enable seasonal leaderboard mode', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_telegram_integration', 'false', 'Enable Telegram notification channel', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_sentry_tracing', 'false', 'Enable Sentry performance tracing', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_free_open_cap', '30', 'Soft concurrent-participant cap for free_open rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_tipping_cap', '30', 'Soft concurrent-participant cap for tipping rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_vip_cap', '200', 'Soft concurrent-participant cap for VIP rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_drop_cap', '100', 'Soft concurrent-participant cap for drop rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_classroom_cap', '150', 'Soft concurrent-participant cap for classroom rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_guild_cap', '100', 'Soft concurrent-participant cap for guild rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_capacity_upgrade_step', '25', 'Slots added per purchased capacity-upgrade step', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_capacity_upgrade_cost', '500', 'Coin cost per capacity-upgrade step', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_capacity_hard_max', '1000', 'Absolute ceiling a room capacity can be raised to', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_games', 'true', 'Master switch for the Games feature (directory, /g pages, challenges).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_wager_rake_pct', '5', 'Platform rake percentage taken from a challenge wager pot before payout.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_challenge_expiry_hours', '48', 'Hours a pending/active challenge stays open before it expires.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_default_reward_credits', '50', 'Fallback credits awarded for a game win when a game sets 0.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_default_reward_xp', '40', 'Fallback gaming XP awarded for a game win when a game sets 0.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_ads_enabled', 'true', 'Master toggle for ads on game pages (cover + play).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_ads_directory_enabled', 'true', 'Toggle for ads on the games directory page.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_trending_hours', '72', 'Window in hours for computing trending play counts.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payment_provider_international', 'dodopayments', 'Payment provider international', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_provider_nigeria', 'paystack', 'Payout provider Nigeria', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payout_provider_international', 'dodopayments', 'Payout provider international', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('announcement_modal_display_mode', 'serial', 'Modal display: serial or random', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('announcement_banner_mode', 'serial', 'Banner display: serial or random', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('admob_app_id', '', 'AdMob App ID', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('admob_banner_unit_id', '', 'AdMob Banner Ad Unit ID', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('admob_interstitial_unit_id', '', 'AdMob Interstitial Ad Unit ID', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('admob_rewarded_unit_id', '', 'AdMob Rewarded Ad Unit ID', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gif_provider', 'giphy', 'GIF provider: giphy or tenor', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_moderation_system_prompt', '', 'Override AI moderation system prompt', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_qualifying_action', 'coin_purchase', 'Action that qualifies a referral', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('currency_soft_name_singular', 'Credit', 'Singular display name for the earned soft currency (e.g. Credit)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('currency_soft_name_plural', 'Credits', 'Plural display name for the earned soft currency (e.g. Credits)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('currency_premium_name_singular', 'Star', 'Singular display name for the purchased premium currency (e.g. Star)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('currency_premium_name_plural', 'Stars', 'Plural display name for the purchased premium currency (e.g. Stars)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('deep_link_base_url', 'https://zobia.vercel.app', 'Base URL for deep links', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_moments', 'true', 'Master toggle for the Zobia Moments feature', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('moments_cost_credits', '100', 'Credits charged to post a Moment (0 = not payable with Credits)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('moments_cost_stars', '1', 'Stars charged to post a Moment (0 = not payable with Stars)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('moments_min_level', '2', 'Minimum account level (main rank number) required to post a Moment', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('privacy_can_show_online_status', '["pro","max","prestige_1"]', 'Plans/prestige tiers allowed to toggle "show my online status" in privacy settings', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_forum', 'true', 'Master toggle for Answers (mini forum / Q&A)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_min_level_to_post', '2', 'Minimum account level required to post a question', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_min_level_to_comment', '1', 'Minimum account level required to answer/comment for free', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_comment_bypass_cost_credits', '1', 'Credits charged to comment when below the comment level gate', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_xp_per_question', '10', 'XP awarded for posting a question', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_credits_per_question', '0', 'Credits awarded for posting a question', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_xp_per_answer', '5', 'XP awarded for posting an answer', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_credits_per_answer', '0', 'Credits awarded for posting an answer', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_xp_per_upvote', '1', 'XP awarded to a content author per upvote received', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_credits_per_upvote', '0', 'Credits awarded to a content author per upvote received', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_xp_best_answer', '25', 'XP awarded when an answer is marked best', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_reward_credits_best_answer', '10', 'Credits awarded when an answer is marked best', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_daily_reward_cap_credits', '50', 'Max forum-sourced credit rewards a single user can earn per rolling 24h', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('forum_auto_moderation_enabled', 'true', 'Run profanity/duplicate auto-moderation on new questions and answers', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_profile_stats', 'true', 'Master toggle for the User Profile Stats page', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('profile_stats_full_plans', '["plus","pro","max"]', 'Plans/prestige tiers that get the Full Stats page; everyone else gets the Basic Stats page', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('save_slots_free', '0', 'Save slots for Free plan users (in-progress game saves).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('save_slots_plus', '1', 'Save slots for Plus plan users.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('save_slots_pro', '3', 'Save slots for Pro plan users.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('save_slots_max', '5', 'Save slots for Max plan users.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_plus', '7', 'Grace period (days) after a Plus subscription lapses before grace-gated data is purged.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_pro', '14', 'Grace period (days) after a Pro subscription lapses before grace-gated data is purged.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_max', '30', 'Grace period (days) after a Max subscription lapses before grace-gated data is purged.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_business_starter', '7', 'Grace period (days) after a Business Starter subscription lapses.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_business_growth', '14', 'Grace period (days) after a Business Growth subscription lapses.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_days_business_enterprise', '30', 'Grace period (days) after a Business Enterprise subscription lapses.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_plus', '["saved_games"]', 'Grace-gated features preserved during the Plus grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_pro', '["saved_games"]', 'Grace-gated features preserved during the Pro grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_max', '["saved_games"]', 'Grace-gated features preserved during the Max grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_business_starter', '["saved_games"]', 'Grace-gated features preserved during the Business Starter grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_business_growth', '["saved_games"]', 'Grace-gated features preserved during the Business Growth grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('grace_period_features_business_enterprise', '["saved_games"]', 'Grace-gated features preserved during the Business Enterprise grace period.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_blogs', 'true', 'Master toggle for the Blogs feature', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_posts_free', '30', 'Max articles + pages (combined) for Free plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_posts_plus', '100', 'Max articles + pages (combined) for Plus plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_posts_pro', '200', 'Max articles + pages (combined) for Pro plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_posts_max', '500', 'Max articles + pages (combined) for Max plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_words_free', '1000', 'Max words per article for Free plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_words_plus', '5000', 'Max words per article for Plus plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_words_pro', '5000', 'Max words per article for Pro plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_max_words_max', '5000', 'Max words per article for Max plan blogs', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_rev_share_pct_free', '40', 'Creator revenue share (%) for Free plan blog owners, after provider fees/VAT', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_rev_share_pct_plus', '50', 'Creator revenue share (%) for Plus plan blog owners, after provider fees/VAT', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_rev_share_pct_pro', '60', 'Creator revenue share (%) for Pro plan blog owners, after provider fees/VAT', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_rev_share_pct_max', '70', 'Creator revenue share (%) for Max plan blog owners, after provider fees/VAT', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_paystack_fee_pct', '3', 'Paystack payment processing fee (%) deducted before blog revenue share', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_google_play_fee_pct', '10', 'Google Play Billing fee (%) deducted before blog revenue share (IAP-funded unlocks)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_vat_pct', '7.5', 'VAT (%) deducted before blog revenue share', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('business_page_limit_starter', '2', 'Max Business Pages a Business Starter account may create', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('business_page_limit_growth', '10', 'Max Business Pages a Business Growth account may create', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('business_page_limit_enterprise', '50', 'Max Business Pages a Business Enterprise account may create', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_moderation_mode', 'manual', 'How business-submitted Sponsored Quests are moderated: manual (admin queue) or ai (AI moderation with manual fallback)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_ai_auto_approve_threshold', '0.85', 'AI moderation confidence (0-1) at or above which a business-submitted Sponsored Quest is auto-approved when moderation mode is "ai"', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('business_downgrade_grace_days', '30', 'Days after a business account tier downgrade before extra pages are deactivated and running sponsored quests are stopped', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_kyc', 'true', 'Master toggle for the identity KYC (Tier 1-3) feature', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_cost_credits', '100', 'Credits charged per KYC verification attempt (Tier 1 submission)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_tier1_review_mode', 'ai', 'Tier 1 review mode: "ai" (AI pre-screens, escalates low-confidence cases to manual) or "manual" (always human-reviewed)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_ai_auto_approve_threshold', '0.85', 'Combined AI confidence (0-1) at or above which a Tier 1 AI-mode submission is auto-approved', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_ai_escalate_below_threshold', '0.55', 'Combined AI confidence (0-1) below which a Tier 1 AI-mode submission is escalated to manual review instead of auto-rejected', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_badge_min_tier', '1', 'Minimum approved KYC tier required to show the blue verified checkmark badge', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_individual_tier2_threshold_kobo', '10000000', 'Individual: product price or revenue (kobo) above which Tier 2 KYC is required (default NGN 100,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_individual_tier2_threshold_usd_cents', '100000', 'Individual: product price or revenue (USD cents) above which Tier 2 KYC is required (default $1,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_individual_tier3_threshold_kobo', '100000000', 'Individual: product price or revenue (kobo) at/above which Tier 3 KYC is required (default NGN 1,000,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_individual_tier3_threshold_usd_cents', '500000', 'Individual: product price or revenue (USD cents) at/above which Tier 3 KYC is required (default $5,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_business_tier2_threshold_kobo', '50000000', 'Business: product price or revenue (kobo) above which Tier 2 KYC is required (default NGN 500,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_business_tier2_threshold_usd_cents', '500000', 'Business: product price or revenue (USD cents) above which Tier 2 KYC is required (default $5,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_business_tier3_threshold_kobo', '1000000000', 'Business: product price or revenue (kobo) at/above which Tier 3 KYC is required (default NGN 10,000,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('kyc_business_tier3_threshold_usd_cents', '500000', 'Business: product price or revenue (USD cents) at/above which Tier 3 KYC is required (default $5,000)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_ads_system', 'true', 'Master toggle for the platform ad control panel (self-service + admin)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_native_ads', 'true', 'Show in-house/user/native ads in ad slots', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_instream_ads', 'true', 'Interleave native ads inside free-tier Room message streams', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_boosted_posts', 'true', 'Allow Business Pages to boost Blog posts and Rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_ad_coupons', 'true', 'Enable the ad-budget coupon/promo-code system', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_moderation_mode', 'manual', 'Ad campaign moderation: manual (admin queue) or ai (DeepSeek/Gemini auto-review)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_ai_auto_approve_threshold', '0.85', 'Minimum AI approvalConfidence (0-1) to auto-approve a submitted ad campaign', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_min_kyc_tier_to_advertise', '1', 'Minimum users.kyc_tier the business account owner must hold to submit ad campaigns', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_default_cpm_credits', '500', 'Default Credits charged per 1000 impressions when a placement has no custom CPM', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_room_instream_interval', '10', 'Show one in-stream ad after this many messages in free Rooms', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_rewarded_daily_cap', '5', 'Max rewarded-ad claims per user per day', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_rewarded_credits_min', '10', 'Minimum Credits awarded per rewarded ad', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_rewarded_credits_max', '20', 'Maximum Credits awarded per rewarded ad', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_plan_free_ads_level', 'full', 'Ad exposure level for Free plan: full | reduced | none', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_plan_plus_ads_level', 'reduced', 'Ad exposure level for Plus plan: full | reduced | none', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_plan_pro_ads_level', 'none', 'Ad exposure level for Pro plan: full | reduced | none', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_plan_max_ads_level', 'none', 'Ad exposure level for Max plan: full | reduced | none', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_admob_app_id', '', 'AdMob App ID (Capacitor Android)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_admob_banner_unit_id', '', 'AdMob banner ad unit ID (Capacitor Android)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_admob_interstitial_unit_id', '', 'AdMob interstitial ad unit ID (Capacitor Android)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_admob_rewarded_unit_id', '', 'AdMob rewarded video ad unit ID (Capacitor Android)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_admob_test_mode', 'true', 'Serve AdMob test ads instead of live inventory (Capacitor Android)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_fund_split_room_subscription_percent', '5', 'Percent of gross room-subscription revenue contributed to the Creator Fund', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_fund_split_room_entry_percent', '5', 'Percent of gross room-entry-fee revenue contributed to the Creator Fund', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_fund_split_coin_purchase_percent', '5', 'Percent of gross Credit-pack purchase revenue contributed to the Creator Fund', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_fund_split_sponsor_budget_percent', '5', 'Percent of branded-room sponsor budget contributed to the Creator Fund', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('creator_fund_split_ad_reward_percent', '5', 'Percent of rewarded-ad payout value contributed to the Creator Fund', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('maintenance_mode_enabled', 'false', 'When true, non-staff visitors see the maintenance message instead of the app', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('maintenance_message', 'Zobia is briefly unavailable at the moment due to system maintenance. Kindly check back later.', 'Message shown to visitors while maintenance mode is on', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_allow_personal_accounts', 'false', 'Allow personal (non-business) accounts to place ads.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_require_kyc', 'true', 'Require identity (KYC) verification to place ads.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_allow_free_accounts', 'false', 'Allow free-plan accounts to place ads (subject to level gate below).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_min_level_free_accounts', '5', 'Minimum account level for a free-plan account to place ads, when allowed.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_enforce_min_level_paid_business', 'false', 'Also enforce a minimum level for paid-plan/business advertisers.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_min_level_paid_business', '1', 'Minimum account level for paid-plan/business advertisers, when enforced.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_advertiser_grace_days', '14', 'Days an ad keeps running under its original advertiser identity after the underlying business/page stops qualifying.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_moderation_mode_text', 'manual', 'Moderation mode for text/native ad creatives: manual or ai.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ad_moderation_mode_image', 'manual', 'Moderation mode for image ad creatives: manual or ai. Always uses an image-capable model.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_provider_order', 'deepseek,gemini,groq', 'Comma-separated AI provider fallback order.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_deepseek_model', '', 'Selected DeepSeek model. Empty = provider default.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_gemini_model', '', 'Selected Gemini model. Empty = provider default.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_groq_model', '', 'Selected Groq model. Empty = provider default (GPT-OSS 120B).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_bbforum', 'true', 'Enable the old-school BB-style forum at /forum.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_creator_level_threshold', '2', 'Creator/reputation level (users.level_creator) a Free-plan user must reach to get any blog included free; below this, every blog (including the first) must be unlocked with Credits/Stars', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_included_free', '1', 'Blogs included free for Free-plan personal accounts at/above blog_creator_level_threshold (0 below the threshold)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_included_plus', '2', 'Blogs included free for Plus-plan personal accounts (no level gate)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_included_pro', '5', 'Blogs included free for Pro-plan personal accounts (no level gate)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_included_max', '10', 'Blogs included free for Max-plan personal accounts (no level gate)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_extra_slot_cost_credits', '500', 'One-time Credits cost to unlock an additional personal-account blog slot beyond the plan''s included count', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_extra_slot_cost_stars', '3', 'One-time Stars cost to unlock an additional personal-account blog slot beyond the plan''s included count', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_extra_slot_currencies', 'credits,stars', 'Comma-separated list of currencies accepted for a personal-account extra blog slot unlock (credits, stars, or both)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_included_starter', '5', 'Blogs included for a Business Starter-tier account (additive to the owner''s personal blog quota)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_included_growth', '20', 'Blogs included for a Business Growth-tier account (additive to the owner''s personal blog quota)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_included_enterprise', '50', 'Blogs included for a Business Enterprise-tier account (additive to the owner''s personal blog quota)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_extra_slot_cost_credits', '500', 'One-time Credits cost to unlock an additional business-account blog slot beyond the tier''s included count', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_extra_slot_cost_stars', '3', 'One-time Stars cost to unlock an additional business-account blog slot beyond the tier''s included count', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_business_extra_slot_currencies', 'credits,stars', 'Comma-separated list of currencies accepted for a business-account extra blog slot unlock (credits, stars, or both)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_blog_gifts', 'true', NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_monetization_enabled', 'true', NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('captcha_active_surfaces', '["login","admin_login","signup","create_blog","create_room","contact_us","blog_comments","create_question","submit_answer","reply_answer_comment","blog_contact_form"]', 'JSON array of CAPTCHA surface keys with CAPTCHA enabled. Only takes effect when captcha_provider != none. See lib/security/captchaSurfaces.ts.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_min_level_to_post', '2', 'Minimum account level to start a thread or reply.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_reward_xp_per_thread', '1', 'XP awarded for starting a new forum thread.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_reward_credits_per_thread', '0', 'Credits awarded for starting a new forum thread.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_reward_xp_per_reply', '1', 'XP awarded for replying to a forum thread.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_reward_credits_per_reply', '0', 'Credits awarded for replying to a forum thread.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_daily_reward_cap_credits', '50', 'Ceiling on total bbforum-sourced credit rewards a user can earn per rolling 24h.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_auto_moderation_enabled', 'true', 'Run profanity/duplicate-post auto-moderation on new forum threads and posts.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_image_cost_credits', '0', 'Credits charged to attach an image to a forum thread/post. 0 = free.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_image_cost_stars', '0', 'Stars charged to attach an image to a forum thread/post. 0 = free.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bbforum_pot_expiry_days', '14', 'Days of inactivity (no new pot claims) before an unclaimed thread pot balance is auto-refunded to its OP.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_support_tickets', 'false', 'Master on/off switch for the Support Ticket System.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_help_center_ai', 'true', '"Ask AI" block on Help Center doc pages. Independent of feature_support_tickets.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_ai_triage_enabled', 'true', 'When true, a new ticket first gets an AI-generated response before reaching the human queue.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_eligible_plans', '["plus","pro","max"]', 'JSON array of plan slugs (and/or prestige_N entries) that can create tickets for free. Read via lib/plans/eligibility.ts.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_ticket_cost_credits', '0', 'One-time credits charged to create a ticket for users not covered by support_eligible_plans. 0 = not chargeable in credits.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_ticket_cost_stars', '0', 'One-time stars charged to create a ticket for users not covered by support_eligible_plans. 0 = not chargeable in stars.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_charging_model', 'first_message_only', 'One of: first_message_only | every_message | every_x_messages | first_x_messages.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_charging_x', '1', 'The X parameter for every_x_messages / first_x_messages charging models.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('support_staff_roles', '["support","moderator","admin"]', 'JSON array of roles ("support","moderator","admin") permitted to view/respond to the ticket queue.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_help_center', 'true', 'Master on/off switch for the database-backed Help Center (/help). When false, the static FAQ fallback is shown.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_center_ai_free_for_all', 'false', 'When true, "Contact a real person" from a Help Center AI answer is always free regardless of support_ticket_cost_credits/stars, and the cost messaging is hidden entirely.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_concurrent_cap', '20', 'Default soft cap on concurrently-active users per group chat.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_capacity_upgrade_step', '10', 'Extra concurrent slots added per paid capacity-upgrade step.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_capacity_upgrade_cost', '300', 'Coin cost per group chat capacity-upgrade step.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_capacity_hard_max', '300', 'Absolute ceiling a group chat concurrent cap can be raised to.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_free', '0', 'Concurrently-active group chats a Free plan user may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_plus', '0', 'Concurrently-active group chats a Plus plan user may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_pro', '3', 'Concurrently-active group chats a Pro plan user may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_max', '10', 'Concurrently-active group chats a Max plan user may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_business_starter', '5', 'Concurrently-active group chats a Business Starter account may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_business_growth', '10', 'Concurrently-active group chats a Business Growth account may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_limit_business_enterprise', '20', 'Concurrently-active group chats a Business Enterprise account may create.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('group_chat_any_member_can_invite', 'false', 'Default: only the group admin and admin-selected participants may invite. When true, any member may invite by default.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('nemesis_challenge_accept_days', '3', 'Days a challenged user has to accept a Nemesis XP-sprint challenge before the challenger is assigned a new Nemesis.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_reward_credits_first_accepted', '50', 'Credits awarded to the FIRST reporter of a report that is accepted (any resolution other than dismiss).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_reward_xp_first_accepted', '50', 'XP awarded to the FIRST reporter of an accepted report.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_reward_xp_subsequent_accepted', '50', 'XP awarded to every reporter AFTER the first on an accepted report (no Credits).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_reward_xp_not_accepted', '1', 'XP awarded to a reporter when their report is dismissed (not accepted).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_malicious_trust_penalty', '1', 'Trust Score points deducted from the original reporter when a moderator marks a report malicious/spammy.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_duplicate_auto_quarantine_threshold', '5', 'Number of distinct reporters against the same target (within the cluster window) that triggers automatic quarantine pending review. 0 disables auto-quarantine.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('report_duplicate_cluster_window_hours', '24', 'Rolling window (hours) during which new reports against the same target are folded into the existing pending report instead of creating a new one.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_dismiss', 'true', 'Platform Mods may dismiss reports.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_warn', 'true', 'Platform Mods may warn the reported user.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_remove_content', 'true', 'Platform Mods may remove reported content.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_suspend_user', 'true', 'Platform Mods may temporarily suspend the reported user.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_ban_user', 'false', 'Platform Mods may permanently ban the reported user. Default off — admin can grant it.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_platform_escalate_ai', 'false', 'Platform Mods may trigger a paid AI re-escalation. Default off (costs an API call) — admin can grant it.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_guild_dismiss', 'true', 'Forum Mods may dismiss reports scoped to their guild.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_guild_warn', 'true', 'Forum Mods may warn a guild member.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_guild_remove_content', 'true', 'Forum Mods may remove a reported guild chat message.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_guild_mute_member', 'true', 'Forum Mods may temporarily mute a guild member from guild chat.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('modcap_guild_kick_member', 'false', 'Forum Mods may remove a member from the guild. Default off — admin (or the guild captain) can grant it.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_polls', 'true', 'Master toggle for the Polls feature. When off, all /api/polls endpoints and /poll/* pages return unavailable.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_quizzes', 'true', 'Master toggle for the Quizzes feature. When off, all /api/quizzes endpoints and /quiz/* pages return unavailable.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('poll_monetization_enabled', 'true', 'Master kill-switch for Poll reward pots (treasuries). When off, funding/claiming a pot is disabled but polls still work.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quiz_monetization_enabled', 'true', 'Master kill-switch for Quiz reward pots (treasuries). When off, funding/claiming a pot is disabled but quizzes still work.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_min_level_to_create', '1', 'Minimum account level required to create a poll.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_reward_xp_creator', '1', 'XP awarded to a user for creating a poll.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_reward_credits_creator', '0', 'Credits awarded to a user for creating a poll.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_reward_xp_voter', '1', 'XP awarded to a user for voting on a poll.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_reward_credits_voter', '0', 'Credits awarded to a user for voting on a poll.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_daily_reward_cap_credits', '50', 'Ceiling on total poll-sourced credit rewards a user can earn per rolling 24h.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('polls_max_options', '10', 'Maximum number of options a poll may have.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_min_level_to_create', '1', 'Minimum account level required to create a quiz.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_reward_xp_creator', '1', 'XP awarded to a user for creating a quiz.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_reward_credits_creator', '0', 'Credits awarded to a user for creating a quiz.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_reward_xp_taker', '1', 'XP awarded to a user for completing (taking) a quiz.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_reward_credits_taker', '0', 'Credits awarded to a user for completing (taking) a quiz.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_daily_reward_cap_credits', '50', 'Ceiling on total quiz-sourced credit rewards a user can earn per rolling 24h.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_max_questions', '25', 'Maximum number of questions a quiz may have.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('quizzes_default_max_attempts', '1', 'Default max attempts per user when a quiz creator does not specify one.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_tweets', 'true', 'Master toggle for the Tweets feature. When off, all /api/tweets endpoints and the /tweets pages return unavailable.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_min_level', '2', 'Minimum account level (main rank number, 1 = Beginner) required to post a Tweet.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_image_cost_credits', '5', 'Credits charged to attach an image to a Tweet. Set to 0 to make image uploads free. Video embeds (YouTube/TikTok) are always free regardless of this setting.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_default_max_length', '280', 'Standard Tweet length limit in characters, applied to all eligible users unless they are long-form exempt.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_long_min_level', '10', 'Minimum account level that unlocks free long-form Tweets (above tweets_default_max_length) up to the user''s personal max length. Combined with tweets_long_min_role by OR — either qualifies.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_long_min_role', '["role_admin","role_moderator","pro","max"]', 'JSON array of role/plan eligibility entries (same vocabulary as lib/plans/eligibility.ts: plan slugs, prestige_N, business_N, role_admin, role_moderator) that unlock free long-form Tweets. Combined with tweets_long_min_level by OR.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_long_max_length', '1000', 'Long-form Tweet ceiling in WORDS (not characters) — the maximum a user''s personal tweetMaxLength setting can be raised to. Converted to an approximate character ceiling server-side.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tweets_long_tweet_cost_credits', '10', 'Credits charged for a single Tweet whose content exceeds tweets_default_max_length, for users who are NOT long-form exempt. Exempt users post long Tweets (up to their personal max length) for free.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_room_custom_rewards', 'true', NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_custom_rewards_min_owner_level', '1', NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('room_custom_rewards_max_claimants_cap', '500', NULL, '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('privacy_hideable_sections', '["activities", "avatar", "badges", "bio", "guild", "rank", "seasons", "xp"]', 'Profile sections that users can hide (admin-controlled list). JSON array.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('avatar_change_cost_credits', '200', 'Credits charged to a free-plan user to upload a custom profile photo (0 = disable paying with Credits). Paid-plan users upload for free.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('avatar_change_cost_stars', '1', 'Stars charged to a free-plan user to upload a custom profile photo (0 = disable paying with Stars).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_min_level', '5', 'Minimum account level (main rank number) that makes a user eligible to change their username, independent of plan/business tier', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_plans', '["max"]', 'Plans that are eligible to change their username regardless of level. JSON array of plan slugs.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_business_tiers', '["growth","enterprise"]', 'Business account tiers (business_accounts.tier) eligible to change their username regardless of level. JSON array.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_cost_credits', '5000', 'Credits charged to change username (0 = not payable with Credits)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_cost_stars', '50', 'Stars charged to change username (0 = not payable with Stars)', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('username_change_cooldown_days', '90', 'Minimum days a user must wait between username changes', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_wiki', 'true', 'Master toggle for the Wiki feature. When off, all /api/wiki endpoints and /w/* pages return unavailable.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_monetization_enabled', 'true', 'Master kill-switch for Wiki reward pots (treasuries). When off, funding/claiming a pot is disabled but wikis still work.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_create_required_plan', 'free', 'Minimum plan (free/plus/pro/max) required to create a wiki.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_create_min_level', '0', 'Minimum creator level (users.level_creator) required to create a wiki.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_create_restricted_to_staff', 'false', 'When true, only moderators/admins may create wikis, regardless of plan/level.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_create_reward_xp', '1', 'XP awarded to a user for creating a wiki.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_create_reward_credits', '0', 'Credits awarded to a user for creating a wiki.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_contribute_reward_xp', '1', 'XP awarded to a user for creating or editing a wiki page.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_contribute_reward_credits', '0', 'Credits awarded to a user for creating or editing a wiki page.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_daily_reward_cap_credits', '50', 'Ceiling on total wiki-sourced credit rewards a user can earn per rolling 24h.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_owned_free', '1', 'Max wikis a Free-plan user may own.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_owned_plus', '3', 'Max wikis a Plus-plan user may own.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_owned_pro', '10', 'Max wikis a Pro-plan user may own.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_owned_max', '25', 'Max wikis a Max-plan user may own.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_pages_free', '20', 'Max pages per wiki for a Free-plan owner.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_pages_plus', '75', 'Max pages per wiki for a Plus-plan owner.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_pages_pro', '250', 'Max pages per wiki for a Pro-plan owner.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_pages_max', '1000', 'Max pages per wiki for a Max-plan owner.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_max_selected_collaborators', '100', 'Max explicitly-selected/invited collaborators per wiki (contribute_policy = selected).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('wiki_invite_expiry_hours', '168', 'Hours a wiki collaborator invite link remains valid (default 7 days).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_daily_injection_enabled', 'true', 'Allow eligible Sponsored Quests to appear in regular users'' daily quest decks (in addition to the creator-application marketplace).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_daily_slot_chance', '0.35', 'Probability (0-1) that a user''s daily deck swaps in an eligible Sponsored Quest for one regular quest slot.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_default_cpm_credits', '500', 'Default Credits charged per 1,000 daily-quest-deck impressions when a Sponsored Quest has no custom CPM.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('sponsored_quest_max_daily_slots', '1', 'Max Sponsored Quest slots per user per day in the daily quest deck.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_1_channel_sms', 'true', 'Level 1 (Critical) alerts send SMS.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_1_channel_email', 'true', 'Level 1 (Critical) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_1_channel_telegram', 'true', 'Level 1 (Critical) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_1_channel_push', 'true', 'Level 1 (Critical) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_1_channel_in_app', 'true', 'Level 1 (Critical) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_2_channel_sms', 'true', 'Level 2 (Urgent Emergency) alerts send SMS.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_2_channel_email', 'true', 'Level 2 (Urgent Emergency) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_2_channel_telegram', 'true', 'Level 2 (Urgent Emergency) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_2_channel_push', 'true', 'Level 2 (Urgent Emergency) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_2_channel_in_app', 'true', 'Level 2 (Urgent Emergency) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_3_channel_sms', 'false', 'Level 3 (Top Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_3_channel_email', 'true', 'Level 3 (Top Priority) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_3_channel_telegram', 'true', 'Level 3 (Top Priority) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_3_channel_push', 'true', 'Level 3 (Top Priority) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_3_channel_in_app', 'true', 'Level 3 (Top Priority) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_4_channel_sms', 'false', 'Level 4 (High Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_4_channel_email', 'false', 'Level 4 (High Priority) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_4_channel_telegram', 'true', 'Level 4 (High Priority) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_4_channel_push', 'true', 'Level 4 (High Priority) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_4_channel_in_app', 'true', 'Level 4 (High Priority) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_5_channel_sms', 'false', 'Level 5 (Medium Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_5_channel_email', 'false', 'Level 5 (Medium Priority) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_5_channel_telegram', 'true', 'Level 5 (Medium Priority) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_5_channel_push', 'false', 'Level 5 (Medium Priority) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_5_channel_in_app', 'true', 'Level 5 (Medium Priority) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_6_channel_sms', 'false', 'Level 6 (Low Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_6_channel_email', 'false', 'Level 6 (Low Priority) alerts send email.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_6_channel_telegram', 'false', 'Level 6 (Low Priority) alerts send Telegram.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_6_channel_push', 'false', 'Level 6 (Low Priority) alerts send push notifications.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level_6_channel_in_app', 'true', 'Level 6 (Low Priority) alerts show an in-app notification.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level1_escalation_schedule', '1,2,4,8,16,32', 'Level 1 hour-offsets for each re-notification stage within one backoff cycle, comma-separated.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level1_escalation_cycles', '3', 'How many times the Level 1 backoff schedule repeats before switching to daily paging.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level1_daily_phase_days', '7', 'Days Level 1 pages once/day after backoff cycles are exhausted, before switching to weekly.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level1_weekly_phase_weeks', '52', 'Weeks Level 1 pages once/week after the daily phase, before escalation stops permanently.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level2_escalation_schedule', '1,2,4,8,16,32', 'Level 2 hour-offsets for each re-notification stage within one backoff cycle, comma-separated.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level2_escalation_cycles', '1', 'How many times the Level 2 backoff schedule repeats before switching to daily paging.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level2_daily_phase_days', '3', 'Days Level 2 pages once/day after backoff cycles are exhausted, before switching to weekly.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_level2_weekly_phase_weeks', '0', 'Weeks Level 2 pages once/week after the daily phase. 0 = stop after the daily phase.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_report_spike_level5_threshold', '5', 'Distinct reporters on one content cluster that raises a Level 5 (Medium) mass-report alert.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_report_spike_level4_threshold', '15', 'Distinct reporters on one content cluster that raises a Level 4 (High) mass-report alert.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_report_spike_level3_threshold', '40', 'Distinct reporters on one content cluster that raises a Level 3 (Top Priority) mass-report alert.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_report_spike_level2_velocity_threshold', '100', 'Sitewide reports across ALL targets in the last hour that suggests brigading/an attack and raises a Level 2 alert to admins+mods.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_notify_mods_infra_other', 'false', 'Whether moderators (not just admins) are notified for infra/other-category alerts. Site/security/moderation alerts always notify mods; financial alerts never do.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('alert_sms_provider', 'termii', 'Active SMS provider key for Level 1/2 alert paging (see lib/notifications/sms.ts).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_referral_digital_enabled', 'true', 'Admin kill switch: allow creators to opt digital Market items into the referral program (uses the standard tier1/tier2 commission rates).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_referral_physical_enabled', 'true', 'Admin kill switch: allow creators to opt physical Market items into the referral program (creator-set commission %, platform keeps its standard cut of that %).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_referral_physical_min_pct', '1.00', 'Minimum referral commission % a creator may set on a physical item (of which the platform fee % below is taken first).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_referral_platform_fee_pct', '20', 'Platform''s cut of a physical item''s referral commission pool, taken before the remainder goes to the referrer. Mirrors the merch creator/platform 80/20 split.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_trending_boost_weight', '2.0', 'Multiplier applied to a creator item''s selection weight in the Market "Trending" section rotation once it crosses the trending threshold below.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('market_trending_min_orders', '5', 'Minimum completed orders in the last 14 days for a creator item to be eligible for the Market trending-item rotation boost.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('interests_onboarding_selection_enabled', 'true', 'Show an interest-selection step during onboarding. When false, only implicit engagement-signal tracking is used for feed personalization.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('home_feed_cache_ttl_seconds', '900', 'How long a Home Feed candidate pool (computed by /api/cron/feed-refresh) stays cached before the next cron run refreshes it. 15 minutes of staleness is acceptable.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('home_feed_page_size', '20', 'Default number of items returned per Home Feed page.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('home_feed_zobian_of_month_auto_compute_enabled', 'true', 'When true, /api/cron/feed-refresh auto-computes Zobian of the Month from monthly XP gain unless an admin has already set an override for the current month.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payment_crypto_price_refresh_minutes', '360', 'Minutes between live crypto price-feed refreshes (lazy, on read). 5-10080 (7 days).', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payment_usd_to_ngn_rate', '1600', 'USD→NGN rate used only to display crypto-equivalent prices in Naira; core pricing stays kobo-denominated.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('payment_crypto_discounts', '{"JAGA":20,"BNB":0,"SOL":0}', 'Per-currency checkout discount percentage when paying in crypto.', '2026-09-17 00:34:39.123121+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_vision_provider_order', 'deepseek,gemini', 'Image-classification provider fallback/escalation order (vision-capable providers only).', '2026-10-23 11:26:32.683376+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_vision_escalate_below_threshold', '0.6', 'If the active vision provider''s confidence is below this, escalate to the next provider (or human review).', '2026-10-23 11:26:32.683376+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_deepseek_vision_model', '', 'Admin override for the DeepSeek vision model. Empty = use the built-in default (deepseek-flash).', '2026-10-23 11:26:32.683376+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ai_gemini_vision_model', '', 'Admin override for the Gemini vision model. Empty = use the built-in default (gemini-3.6-flash).', '2026-10-23 11:26:32.683376+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('referral_stats_full_plans', '["plus","pro","max"]', 'Plans/prestige tiers that get the Full referral stats view (visit breakdown, top pages, conversion rate, per-referral list); everyone else gets totals only', '2026-10-23 11:26:32.753853+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_free', '3', 'Max classrooms (draft + live) a Free plan user may own.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_plus', '10', 'Max classrooms (draft + live) a Plus plan user may own.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_pro', '15', 'Max classrooms (draft + live) a Pro plan user may own.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_max', '20', 'Max classrooms (draft + live) a Max plan user may own.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_free_min_level', '5', 'Creator-track level a Free plan user must reach before creating any classroom.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_chat_max_active', '20', 'Target max concurrently-active participants in a classroom chat Room.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('classroom_chat_max_total', '150', 'Max total roster of a classroom once its chat Room is enabled.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('crypto_payouts_enabled', 'false', 'Whether creators/referrers can hold and withdraw crypto-native balances (JAGA/BNB/SOL) instead of always converting earnings to Credits.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('crypto_payout_mode', 'credits', 'When crypto payouts are enabled: "crypto" pays out in the earned currency, "credits" always converts to Credits.', '2026-10-23 11:26:32.761817+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled', 'true', 'Master on/off switch for the optional gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_free_min_level', '5', 'Minimum account level (main rank number) a Free-plan user needs to unlock the gift message box.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_free', '40', 'Max words in a gift message for Free-plan users who meet the level requirement.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_plus', '50', 'Max words in a gift message for Plus-plan users.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_pro', '100', 'Max words in a gift message for Pro-plan users.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_max', '250', 'Max words in a gift message for Max-plan users.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_business_starter', '50', 'Max words in a gift message for Business Starter accounts.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_business_growth', '100', 'Max words in a gift message for Business Growth accounts.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_max_words_business_enterprise', '250', 'Max words in a gift message for Business Enterprise accounts.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_free', 'true', 'Whether Free-plan users can use the gift message feature at all (still gated by gift_message_free_min_level).', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_plus', 'true', 'Whether Plus-plan users can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_pro', 'true', 'Whether Pro-plan users can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_max', 'true', 'Whether Max-plan users can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_business_starter', 'true', 'Whether Business Starter accounts can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_business_growth', 'true', 'Whether Business Growth accounts can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('gift_message_enabled_business_enterprise', 'true', 'Whether Business Enterprise accounts can use the gift message feature.', '2026-10-23 11:26:32.778409+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('appeals_max_refusals', '3', 'Max times an account appeal may be denied before further appeals for that suspension/ban are blocked.', '2026-10-23 11:26:32.780346+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('appeals_triage_mode', 'manual', 'How suspension/ban appeals are reviewed: "manual" (default, always human) or "ai_then_manual" (AI triage first, human decides).', '2026-10-23 11:26:32.780346+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('signups_enabled', 'true', 'Master toggle for new account signups. When false, new Google/Telegram OAuth sign-ins are refused (existing users can still log in). Editable at /gate44/config and /gate44/users (Settings tab).', '2026-10-23 11:26:32.790245+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('phone_verification_required', 'false', 'When true, users must confirm a phone number via SMS OTP before it is saved (uses the same Termii integration as admin/mod SMS alerting). When false (default), a typed phone number is saved as-is, unverified. Editable at /gate44/config.', '2026-10-23 11:26:32.794818+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ui_site_theme', 'default', 'Default sitewide UI theme applied to every device that has not chosen its own override: default | reddit | facebook | christmas. Editable at /gate44/config ("Theming"). See shared/utils/uiThemes.ts.', '2026-10-23 11:26:32.870897+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('ui_icon_set', 'emoji', 'Default nav/UI icon set applied to every device that has not chosen its own override: emoji | mono (black-and-white vector icons). Editable at /gate44/config ("Theming"). See shared/utils/uiThemes.ts.', '2026-10-23 11:26:32.870897+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('leaderboard_anonymity_enabled', 'true', 'Master switch for the "hide my name from public leaderboards" privacy setting (Plus and above). When off, nobody is hidden and the setting is not offered.', '2026-10-23 11:26:32.871628+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('leaderboard_anonymity_min_level', '0', 'Account level (main rank number, 1 = Beginner) that unlocks hiding from leaderboards irrespective of plan. 0 disables the level unlock. Combined with leaderboard_anonymity_eligible by OR.', '2026-10-23 11:26:32.871628+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('leaderboard_anonymity_eligible', '["plus","pro","max","business_starter","business_growth","business_enterprise"]', 'JSON array of plan/role eligibility entries (lib/plans/eligibility.ts vocabulary: plan slugs, prestige_N, business_<tier>, role_admin, role_moderator) allowed to hide from leaderboards. Default: every paid plan and business account.', '2026-10-23 11:26:32.871628+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_max_failed_attempts', '5', 'Wrong PINs allowed within pin_fail_window_minutes before the PIN is locked. Default: 5.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_fail_window_minutes', '15', 'Rolling window (minutes) in which wrong PINs accumulate. Default: 15.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_lockout_minutes', '15', 'Length (minutes) of an ordinary PIN lockout. Default: 15.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_strike_limit', '3', 'Number of lockouts within pin_strike_window_hours that escalates to the long lockout. Default: 3.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_strike_window_hours', '24', 'Window (hours) in which PIN lockouts count as strikes. Default: 24.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('pin_long_lockout_hours', '24', 'Length (hours) of the escalated PIN lockout. Default: 24.', '2026-10-23 11:26:32.87395+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('feature_portals', 'true', 'Master toggle for Hashtags and Portals (/h/<slug>). When off, hashtag pages and feed portal suggestions are hidden and portal APIs return 503.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_auto_create_enabled', 'true', 'When true, /api/cron/feed-refresh promotes trending hashtags to auto portals once they pass the thresholds.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_auto_min_posts', '20', 'Tagged posts required inside the trending window before a hashtag becomes an auto portal.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_auto_min_distinct_users', '8', 'Distinct authors required inside the trending window before a hashtag becomes an auto portal (anti-spam).', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_trending_window_hours', '48', 'Window in hours used for tag velocity and the auto-portal thresholds.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_archive_after_days', '30', 'Auto portals with no tagged activity for this many days are archived. Official portals are never auto-archived.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_feed_suggestion_every', '8', 'Insert one "Portals for you" card after this many Home Feed items. 0 turns suggestions off.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_feed_suggestion_max_portals', '6', 'Maximum portals shown in a single feed suggestion card.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('portals_cache_ttl_seconds', '600', 'How long a portal page payload stays cached (memory + Redis), in seconds.', '2026-10-23 11:26:32.874734+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_challenge_daily_limit', '10', 'Maximum challenges sent per user per UTC day.', '2026-10-23 11:26:32.908992+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('game_challenge_recent_days', '7', 'Recent activity window for challenge opponent suggestions.', '2026-10-23 11:26:32.908992+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_ai_weekly_limit_free', '20', 'Weekly included help AI questions: Free.', '2026-10-23 11:26:32.910228+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_ai_weekly_limit_plus', '50', 'Weekly included help AI questions: Plus.', '2026-10-23 11:26:32.910228+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_ai_weekly_limit_pro', '100', 'Weekly included help AI questions: Pro.', '2026-10-23 11:26:32.910228+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_ai_weekly_limit_max', '200', 'Weekly included help AI questions: Max.', '2026-10-23 11:26:32.910228+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('help_ai_question_cost_credits', '5', 'Credits for a confirmed question after the weekly allowance; zero disables paid questions.', '2026-10-23 11:26:32.910228+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folders_plus', '5', 'Permanently unlocked bookmark folder slots on Plus.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folders_pro', '15', 'Permanently unlocked bookmark folder slots on Pro.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folders_max', '30', 'Permanently unlocked bookmark folder slots on Max.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folders_business', '30', 'Permanently unlocked bookmark folder slots for Business accounts.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folder_first_cost', '100', 'Credits for the first purchased bookmark folder slot.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('bookmark_folder_extra_cost', '50', 'Credits for each subsequent purchased bookmark folder slot.', '2026-10-23 11:26:32.919389+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_100_credits', '1000', 'Credits for 100 permanent extra posts per blog.', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_200_credits', '1900', 'Credits for 200 extra posts (5% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_300_credits', '2700', 'Credits for 300 extra posts (10% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_500_credits', '4250', 'Credits for 500 extra posts (15% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_1000_credits', '8000', 'Credits for 1000 extra posts (20% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_100_stars', '100', 'Stars for 100 permanent extra posts per blog.', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_200_stars', '190', 'Stars for 200 extra posts (5% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_300_stars', '270', 'Stars for 300 extra posts (10% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_500_stars', '425', 'Stars for 500 extra posts (15% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('blog_post_bundle_1000_stars', '800', 'Stars for 1000 extra posts (20% discount).', '2026-10-23 11:26:32.938757+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tales_free_published_limit', '10', 'Maximum published stories for Free writers.', '2026-10-23 11:26:32.944855+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tales_free_draft_limit', '20', 'Maximum draft stories for Free writers.', '2026-10-23 11:26:32.944855+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tales_min_level', '2', 'Minimum main rank to write Tales.', '2026-10-23 11:26:32.944855+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tales_appeal_limit', '3', 'Maximum appeals per story, chapter, or Tales account.', '2026-10-23 11:26:32.944855+00');

INSERT INTO public.x_manifest (key, value, description, updated_at) VALUES ('tales_creator_share_pct', '70', 'Share of paid chapter credits transferred to the author (0–100).', '2026-10-23 11:26:32.974481+00');


-- Foreign keys — after all tables and reference rows


ALTER TABLE ONLY public.account_appeals
    ADD CONSTRAINT account_appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_appeals
    ADD CONSTRAINT account_appeals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_restore_uses
    ADD CONSTRAINT account_restore_uses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_type_play_products
    ADD CONSTRAINT account_type_play_products_account_type_slug_fkey FOREIGN KEY (account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.ad_ai_escalations
    ADD CONSTRAINT ad_ai_escalations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_ai_escalations
    ADD CONSTRAINT ad_ai_escalations_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_ai_escalations
    ADD CONSTRAINT ad_ai_escalations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_campaign_daily_stats
    ADD CONSTRAINT ad_campaign_daily_stats_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_advertiser_user_id_fkey FOREIGN KEY (advertiser_user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_business_account_id_fkey FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_business_page_id_fkey FOREIGN KEY (business_page_id) REFERENCES public.business_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_campaigns
    ADD CONSTRAINT ad_campaigns_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_coupon_redemptions
    ADD CONSTRAINT ad_coupon_redemptions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_coupon_redemptions
    ADD CONSTRAINT ad_coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.ad_coupons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_coupon_redemptions
    ADD CONSTRAINT ad_coupon_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_coupons
    ADD CONSTRAINT ad_coupons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT ad_creatives_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_creatives
    ADD CONSTRAINT ad_creatives_placement_key_fkey FOREIGN KEY (placement_key) REFERENCES public.ad_placements(key) ON DELETE RESTRICT;

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.ad_campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ad_events
    ADD CONSTRAINT ad_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ad_wallet_ledger
    ADD CONSTRAINT ad_wallet_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.admin_data_import_jobs
    ADD CONSTRAINT admin_data_import_jobs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_admin_message_id_fkey FOREIGN KEY (admin_message_id) REFERENCES public.admin_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.admin_message_receipts
    ADD CONSTRAINT admin_message_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.admin_messages
    ADD CONSTRAINT admin_messages_sender_admin_id_fkey FOREIGN KEY (sender_admin_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.admin_roles
    ADD CONSTRAINT admin_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alert_notification_log
    ADD CONSTRAINT alert_notification_log_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.system_alerts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alliance_wars
    ADD CONSTRAINT alliance_wars_alliance_1_id_fkey FOREIGN KEY (alliance_1_id) REFERENCES public.guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alliance_wars
    ADD CONSTRAINT alliance_wars_alliance_2_id_fkey FOREIGN KEY (alliance_2_id) REFERENCES public.guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.alliance_wars
    ADD CONSTRAINT alliance_wars_winner_alliance_id_fkey FOREIGN KEY (winner_alliance_id) REFERENCES public.guild_alliances(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automated_actions_log
    ADD CONSTRAINT automated_actions_log_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automated_actions_log
    ADD CONSTRAINT automated_actions_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automated_actions_log
    ADD CONSTRAINT automated_actions_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automation_accounts
    ADD CONSTRAINT automation_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.automation_generations
    ADD CONSTRAINT automation_generations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.automation_generations
    ADD CONSTRAINT automation_generations_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.automation_jobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automation_generations
    ADD CONSTRAINT automation_generations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.automation_accounts(user_id);

ALTER TABLE ONLY public.bb_boards
    ADD CONSTRAINT bb_boards_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.bb_boards(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_post_reactions
    ADD CONSTRAINT bb_post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.bb_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_post_reactions
    ADD CONSTRAINT bb_post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_posts
    ADD CONSTRAINT bb_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.bb_posts
    ADD CONSTRAINT bb_posts_quoted_post_id_fkey FOREIGN KEY (quoted_post_id) REFERENCES public.bb_posts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bb_posts
    ADD CONSTRAINT bb_posts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.bb_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_pot_claims
    ADD CONSTRAINT bb_pot_claims_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.bb_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_pot_claims
    ADD CONSTRAINT bb_pot_claims_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.bb_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_pot_claims
    ADD CONSTRAINT bb_pot_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bb_threads
    ADD CONSTRAINT bb_threads_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.bb_threads
    ADD CONSTRAINT bb_threads_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.bb_boards(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_categories
    ADD CONSTRAINT blog_categories_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_contact_messages
    ADD CONSTRAINT blog_contact_messages_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_contact_messages
    ADD CONSTRAINT blog_contact_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.blog_gift_claims
    ADD CONSTRAINT blog_gift_claims_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.blog_gift_purchases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_gift_purchases
    ADD CONSTRAINT blog_gift_purchases_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_gift_purchases
    ADD CONSTRAINT blog_gift_purchases_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_gift_purchases
    ADD CONSTRAINT blog_gift_purchases_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.blog_gift_tiers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_gift_tiers
    ADD CONSTRAINT blog_gift_tiers_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_moderation_log
    ADD CONSTRAINT blog_moderation_log_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_moderation_log
    ADD CONSTRAINT blog_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_moderation_log
    ADD CONSTRAINT blog_moderation_log_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_moderation_log
    ADD CONSTRAINT blog_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.blog_post_bundle_purchases
    ADD CONSTRAINT blog_post_bundle_purchases_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_bundle_purchases
    ADD CONSTRAINT blog_post_bundle_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_comments
    ADD CONSTRAINT blog_post_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_comments
    ADD CONSTRAINT blog_post_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.blog_post_comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_comments
    ADD CONSTRAINT blog_post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_daily_stats
    ADD CONSTRAINT blog_post_daily_stats_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_likes
    ADD CONSTRAINT blog_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_likes
    ADD CONSTRAINT blog_post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_shares
    ADD CONSTRAINT blog_post_shares_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_shares
    ADD CONSTRAINT blog_post_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasuries
    ADD CONSTRAINT blog_post_treasuries_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasuries
    ADD CONSTRAINT blog_post_treasuries_gift_tier_fk FOREIGN KEY (gift_tier_id) REFERENCES public.blog_gift_tiers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasuries
    ADD CONSTRAINT blog_post_treasuries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasuries
    ADD CONSTRAINT blog_post_treasuries_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasury_claims
    ADD CONSTRAINT blog_post_treasury_claims_treasury_id_fkey FOREIGN KEY (treasury_id) REFERENCES public.blog_post_treasuries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_treasury_claims
    ADD CONSTRAINT blog_post_treasury_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_unlocks
    ADD CONSTRAINT blog_post_unlocks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.blog_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_post_unlocks
    ADD CONSTRAINT blog_post_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.blog_categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.blog_subscriptions
    ADD CONSTRAINT blog_subscriptions_blog_id_fkey FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_subscriptions
    ADD CONSTRAINT blog_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blog_themes
    ADD CONSTRAINT blog_themes_store_item_id_fkey FOREIGN KEY (store_item_id) REFERENCES public.store_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_active_theme_id_fkey FOREIGN KEY (active_theme_id) REFERENCES public.blog_themes(id);

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_business_account_id_fkey FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_theme_store_item_id_fkey FOREIGN KEY (theme_store_item_id) REFERENCES public.store_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bookmark_entitlements
    ADD CONSTRAINT bookmark_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bookmark_folders
    ADD CONSTRAINT bookmark_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.bookmark_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.boost_types
    ADD CONSTRAINT boost_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.branded_rooms
    ADD CONSTRAINT branded_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.branded_rooms
    ADD CONSTRAINT branded_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_account_type_slug_fkey FOREIGN KEY (account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_downgrade_account_type_slug_fkey FOREIGN KEY (downgrade_account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_pending_account_type_slug_fkey FOREIGN KEY (pending_account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.business_accounts
    ADD CONSTRAINT business_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_page_daily_stats
    ADD CONSTRAINT business_page_daily_stats_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.business_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_page_posts
    ADD CONSTRAINT business_page_posts_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.business_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.business_pages
    ADD CONSTRAINT business_pages_business_account_id_fkey FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_daily_stats
    ADD CONSTRAINT classroom_daily_stats_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_muted_by_fkey FOREIGN KEY (muted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_enrolments
    ADD CONSTRAINT classroom_enrolments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_events
    ADD CONSTRAINT classroom_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_events
    ADD CONSTRAINT classroom_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_lesson_completions
    ADD CONSTRAINT classroom_lesson_completions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_lesson_completions
    ADD CONSTRAINT classroom_lesson_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_likes
    ADD CONSTRAINT classroom_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.classroom_post_comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_likes
    ADD CONSTRAINT classroom_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.classroom_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_likes
    ADD CONSTRAINT classroom_likes_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_likes
    ADD CONSTRAINT classroom_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_member_badges
    ADD CONSTRAINT classroom_member_badges_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_member_badges
    ADD CONSTRAINT classroom_member_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_member_points
    ADD CONSTRAINT classroom_member_points_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_member_points
    ADD CONSTRAINT classroom_member_points_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_moderators
    ADD CONSTRAINT classroom_moderators_granted_by_fkey FOREIGN KEY (moderator_granted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_moderators
    ADD CONSTRAINT classroom_moderators_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_moderators
    ADD CONSTRAINT classroom_moderators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_points_ledger
    ADD CONSTRAINT classroom_points_ledger_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_points_ledger
    ADD CONSTRAINT classroom_points_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_post_comments
    ADD CONSTRAINT classroom_post_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_post_comments
    ADD CONSTRAINT classroom_post_comments_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_post_comments
    ADD CONSTRAINT classroom_post_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.classroom_post_comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_post_comments
    ADD CONSTRAINT classroom_post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.classroom_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_post_comments
    ADD CONSTRAINT classroom_post_comments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_posts
    ADD CONSTRAINT classroom_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_posts
    ADD CONSTRAINT classroom_posts_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_posts
    ADD CONSTRAINT classroom_posts_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.classroom_quizzes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_quiz_attempts
    ADD CONSTRAINT classroom_quiz_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_quiz_questions
    ADD CONSTRAINT classroom_quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.classroom_quizzes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_quizzes
    ADD CONSTRAINT classroom_quizzes_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_quizzes
    ADD CONSTRAINT classroom_quizzes_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_reports
    ADD CONSTRAINT classroom_reports_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.classroom_post_comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_reports
    ADD CONSTRAINT classroom_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.classroom_posts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_reports
    ADD CONSTRAINT classroom_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_reports
    ADD CONSTRAINT classroom_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_reports
    ADD CONSTRAINT classroom_reports_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_shares
    ADD CONSTRAINT classroom_shares_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_shares
    ADD CONSTRAINT classroom_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classroom_slug_history
    ADD CONSTRAINT classroom_slug_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.classroom_slug_history
    ADD CONSTRAINT classroom_slug_history_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.coin_ledger
    ADD CONSTRAINT coin_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.community_note_votes
    ADD CONSTRAINT community_note_votes_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.community_notes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.community_note_votes
    ADD CONSTRAINT community_note_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.community_notes
    ADD CONSTRAINT community_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.community_notes
    ADD CONSTRAINT community_notes_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.content_engagement_signals
    ADD CONSTRAINT content_engagement_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_hashtags
    ADD CONSTRAINT content_hashtags_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.content_hashtags
    ADD CONSTRAINT content_hashtags_hashtag_id_fkey FOREIGN KEY (hashtag_id) REFERENCES public.hashtags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_shares
    ADD CONSTRAINT content_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_treasuries
    ADD CONSTRAINT content_treasuries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_treasury_claims
    ADD CONSTRAINT content_treasury_claims_treasury_id_fkey FOREIGN KEY (treasury_id) REFERENCES public.content_treasuries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_treasury_claims
    ADD CONSTRAINT content_treasury_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_scores
    ADD CONSTRAINT conversation_scores_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_scores
    ADD CONSTRAINT conversation_scores_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.council_invitations
    ADD CONSTRAINT council_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_bank_accounts
    ADD CONSTRAINT creator_bank_accounts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_business_account_id_fkey FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id);

ALTER TABLE ONLY public.creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_broadcasts
    ADD CONSTRAINT creator_broadcasts_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_crypto_balances
    ADD CONSTRAINT creator_crypto_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.creator_payouts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_kyc
    ADD CONSTRAINT creator_kyc_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_payouts
    ADD CONSTRAINT creator_payouts_appeal_resolved_by_fkey FOREIGN KEY (appeal_resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_payouts
    ADD CONSTRAINT creator_payouts_approved_by_admin_id_fkey FOREIGN KEY (approved_by_admin_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_payouts
    ADD CONSTRAINT creator_payouts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_spotlights
    ADD CONSTRAINT creator_spotlights_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_spotlights
    ADD CONSTRAINT creator_spotlights_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_wallet_addresses
    ADD CONSTRAINT creator_wallet_addresses_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cron_job_steps
    ADD CONSTRAINT cron_job_steps_job_key_run_date_fkey FOREIGN KEY (job_key, run_date) REFERENCES public.cron_job_runs(job_key, run_date) ON DELETE CASCADE;

ALTER TABLE ONLY public.crypto_balance_ledger
    ADD CONSTRAINT crypto_balance_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crypto_exchange_rate_overrides
    ADD CONSTRAINT crypto_exchange_rate_overrides_set_by_admin_id_fkey FOREIGN KEY (set_by_admin_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.crypto_transfer_claims
    ADD CONSTRAINT crypto_transfer_claims_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);

ALTER TABLE ONLY public.data_export_requests
    ADD CONSTRAINT data_export_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milestones_user_id_a_fkey FOREIGN KEY (user_id_a) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversation_score_milestones
    ADD CONSTRAINT dm_conversation_score_milestones_user_id_b_fkey FOREIGN KEY (user_id_b) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversation_unlocks
    ADD CONSTRAINT dm_conversation_unlocks_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversations
    ADD CONSTRAINT dm_conversations_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_conversations
    ADD CONSTRAINT dm_conversations_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_user_id_1_fkey FOREIGN KEY (user_id_1) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dm_score_sticker_unlocks
    ADD CONSTRAINT dm_score_sticker_unlocks_user_id_2_fkey FOREIGN KEY (user_id_2) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.drop_room_replays
    ADD CONSTRAINT drop_room_replays_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.drop_room_replays
    ADD CONSTRAINT drop_room_replays_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.elder_mentorships
    ADD CONSTRAINT elder_mentorships_elder_id_fkey FOREIGN KEY (elder_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.elder_mentorships
    ADD CONSTRAINT elder_mentorships_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.elder_requests
    ADD CONSTRAINT elder_requests_elder_id_fkey FOREIGN KEY (elder_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.elder_requests
    ADD CONSTRAINT elder_requests_mentee_id_fkey FOREIGN KEY (mentee_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_answers
    ADD CONSTRAINT forum_answers_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_answers
    ADD CONSTRAINT forum_answers_parent_answer_id_fkey FOREIGN KEY (parent_answer_id) REFERENCES public.forum_answers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_answers
    ADD CONSTRAINT forum_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.forum_questions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_favorites
    ADD CONSTRAINT forum_favorites_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.forum_questions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_favorites
    ADD CONSTRAINT forum_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_answer_id_fkey FOREIGN KEY (answer_id) REFERENCES public.forum_answers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.forum_questions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_moderation_log
    ADD CONSTRAINT forum_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.forum_questions
    ADD CONSTRAINT forum_questions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.forum_questions
    ADD CONSTRAINT forum_questions_best_answer_fk FOREIGN KEY (best_answer_id) REFERENCES public.forum_answers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.forum_questions
    ADD CONSTRAINT forum_questions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.forum_categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.forum_votes
    ADD CONSTRAINT forum_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_best_scores
    ADD CONSTRAINT game_best_scores_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_best_scores
    ADD CONSTRAINT game_best_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.game_challenges(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_challenger_play_id_fkey FOREIGN KEY (challenger_play_id) REFERENCES public.game_plays(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_opponent_play_id_fkey FOREIGN KEY (opponent_play_id) REFERENCES public.game_plays(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.game_challenge_rounds
    ADD CONSTRAINT game_challenge_rounds_round_winner_id_fkey FOREIGN KEY (round_winner_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.game_challenges
    ADD CONSTRAINT game_challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_challenges
    ADD CONSTRAINT game_challenges_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_challenges
    ADD CONSTRAINT game_challenges_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_challenges
    ADD CONSTRAINT game_challenges_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.game_favorites
    ADD CONSTRAINT game_favorites_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_favorites
    ADD CONSTRAINT game_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_milestone_claims
    ADD CONSTRAINT game_milestone_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_plays
    ADD CONSTRAINT game_plays_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_plays
    ADD CONSTRAINT game_plays_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_progress_tasks
    ADD CONSTRAINT game_progress_tasks_play_id_fkey FOREIGN KEY (play_id) REFERENCES public.game_plays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_ratings
    ADD CONSTRAINT game_ratings_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_ratings
    ADD CONSTRAINT game_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_saves
    ADD CONSTRAINT game_saves_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_saves
    ADD CONSTRAINT game_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.game_score_attestations
    ADD CONSTRAINT game_score_attestations_play_id_fkey FOREIGN KEY (play_id) REFERENCES public.game_plays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.gift_items
    ADD CONSTRAINT gift_items_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.gift_reward_grants
    ADD CONSTRAINT gift_reward_grants_gift_id_fkey FOREIGN KEY (gift_id) REFERENCES public.gifts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gift_reward_grants
    ADD CONSTRAINT gift_reward_grants_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gift_reward_grants
    ADD CONSTRAINT gift_reward_grants_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gift_types
    ADD CONSTRAINT gift_types_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES public.gift_items(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_gift_type_id_fkey FOREIGN KEY (gift_type_id) REFERENCES public.gift_types(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_blocks
    ADD CONSTRAINT group_chat_blocks_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES public.group_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_blocks
    ADD CONSTRAINT group_chat_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_members
    ADD CONSTRAINT group_chat_members_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES public.group_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_members
    ADD CONSTRAINT group_chat_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_reactivation_choices
    ADD CONSTRAINT group_chat_reactivation_choices_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES public.group_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chat_reactivation_choices
    ADD CONSTRAINT group_chat_reactivation_choices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.group_chats
    ADD CONSTRAINT group_chats_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_alliance_id_fkey FOREIGN KEY (alliance_id) REFERENCES public.guild_alliances(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_alliance_members
    ADD CONSTRAINT guild_alliance_members_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_alliances
    ADD CONSTRAINT guild_alliances_founded_by_fkey FOREIGN KEY (founded_by) REFERENCES public.guilds(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.guild_applications
    ADD CONSTRAINT guild_applications_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_applications
    ADD CONSTRAINT guild_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_applications
    ADD CONSTRAINT guild_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_contribution_alerts
    ADD CONSTRAINT guild_contribution_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_invites
    ADD CONSTRAINT guild_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_invites
    ADD CONSTRAINT guild_invites_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_invites
    ADD CONSTRAINT guild_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_invites
    ADD CONSTRAINT guild_invites_used_by_user_id_fkey FOREIGN KEY (used_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_moderator_granted_by_fkey FOREIGN KEY (moderator_granted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_members
    ADD CONSTRAINT guild_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_messages
    ADD CONSTRAINT guild_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_messages
    ADD CONSTRAINT guild_messages_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_messages
    ADD CONSTRAINT guild_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_quest_contributions
    ADD CONSTRAINT guild_quest_contributions_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.guild_quests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_quest_contributions
    ADD CONSTRAINT guild_quest_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_quests
    ADD CONSTRAINT guild_quests_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_rooms
    ADD CONSTRAINT guild_rooms_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_rooms
    ADD CONSTRAINT guild_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_tier_history
    ADD CONSTRAINT guild_tier_history_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_tier_history
    ADD CONSTRAINT guild_tier_history_war_id_fkey FOREIGN KEY (war_id) REFERENCES public.guild_wars(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_treasury_ledger
    ADD CONSTRAINT guild_treasury_ledger_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_treasury_ledger
    ADD CONSTRAINT guild_treasury_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_war_rematch_tokens
    ADD CONSTRAINT guild_war_rematch_tokens_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_war_rematch_tokens
    ADD CONSTRAINT guild_war_rematch_tokens_war_id_fkey FOREIGN KEY (war_id) REFERENCES public.guild_wars(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_wars
    ADD CONSTRAINT guild_wars_challenger_guild_id_fkey FOREIGN KEY (challenger_guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_wars
    ADD CONSTRAINT guild_wars_defender_guild_id_fkey FOREIGN KEY (defender_guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.guild_wars
    ADD CONSTRAINT guild_wars_winner_guild_id_fkey FOREIGN KEY (winner_guild_id) REFERENCES public.guilds(id);

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_captain_id_fkey FOREIGN KEY (captain_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.guilds
    ADD CONSTRAINT guilds_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.hall_of_fame
    ADD CONSTRAINT hall_of_fame_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.hashtags
    ADD CONSTRAINT hashtags_alias_of_fkey FOREIGN KEY (alias_of) REFERENCES public.hashtags(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.help_ai_requests
    ADD CONSTRAINT help_ai_requests_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.help_docs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.help_ai_requests
    ADD CONSTRAINT help_ai_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.help_docs
    ADD CONSTRAINT help_docs_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.help_docs
    ADD CONSTRAINT help_docs_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.help_categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.kyc_submissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kyc_submissions
    ADD CONSTRAINT kyc_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.kyc_submissions
    ADD CONSTRAINT kyc_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.leaderboard_rank_snapshots
    ADD CONSTRAINT leaderboard_rank_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.leaderboard_snapshots
    ADD CONSTRAINT leaderboard_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_certificates
    ADD CONSTRAINT learning_certificates_issuer_user_id_fkey FOREIGN KEY (issuer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.learning_certificates
    ADD CONSTRAINT learning_certificates_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_certificates
    ADD CONSTRAINT learning_certificates_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_orders
    ADD CONSTRAINT merch_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_orders
    ADD CONSTRAINT merch_orders_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_orders
    ADD CONSTRAINT merch_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.merch_products(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.merch_orders
    ADD CONSTRAINT merch_orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.merch_stores(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.merch_product_reviews
    ADD CONSTRAINT merch_product_reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_product_reviews
    ADD CONSTRAINT merch_product_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.merch_orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.merch_product_reviews
    ADD CONSTRAINT merch_product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.merch_products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_products
    ADD CONSTRAINT merch_products_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.merch_stores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.merch_stores
    ADD CONSTRAINT merch_stores_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.dm_conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES public.group_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.moderation_reports(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_actions
    ADD CONSTRAINT moderation_actions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_ai_escalations
    ADD CONSTRAINT moderation_ai_escalations_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_ai_escalations
    ADD CONSTRAINT moderation_ai_escalations_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.moderation_reports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_report_reporters
    ADD CONSTRAINT moderation_report_reporters_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.moderation_reports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_report_reporters
    ADD CONSTRAINT moderation_report_reporters_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_bb_post_id_fkey FOREIGN KEY (reported_bb_post_id) REFERENCES public.bb_posts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_bb_thread_id_fkey FOREIGN KEY (reported_bb_thread_id) REFERENCES public.bb_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_forum_answer_id_fkey FOREIGN KEY (reported_forum_answer_id) REFERENCES public.forum_answers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_forum_question_id_fkey FOREIGN KEY (reported_forum_question_id) REFERENCES public.forum_questions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_guild_id_fkey FOREIGN KEY (reported_guild_id) REFERENCES public.guilds(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_guild_message_id_fkey FOREIGN KEY (reported_guild_message_id) REFERENCES public.guild_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_message_id_fkey FOREIGN KEY (reported_message_id) REFERENCES public.room_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_poll_id_fkey FOREIGN KEY (reported_poll_id) REFERENCES public.polls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_quiz_id_fkey FOREIGN KEY (reported_quiz_id) REFERENCES public.quizzes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_room_id_fkey FOREIGN KEY (reported_room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_tale_chapter_id_fkey FOREIGN KEY (reported_tale_chapter_id) REFERENCES public.tale_chapters(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_tale_id_fkey FOREIGN KEY (reported_tale_id) REFERENCES public.tales(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_tweet_id_fkey FOREIGN KEY (reported_tweet_id) REFERENCES public.tweets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_wiki_id_fkey FOREIGN KEY (reported_wiki_id) REFERENCES public.wikis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reported_wiki_page_id_fkey FOREIGN KEY (reported_wiki_page_id) REFERENCES public.wiki_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moderation_reports
    ADD CONSTRAINT moderation_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.moment_reactions
    ADD CONSTRAINT moment_reactions_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moment_reactions
    ADD CONSTRAINT moment_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moment_views
    ADD CONSTRAINT moment_views_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES public.moments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moment_views
    ADD CONSTRAINT moment_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.moments
    ADD CONSTRAINT moments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.monthly_gift_drops
    ADD CONSTRAINT monthly_gift_drops_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES public.gift_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_nemesis_id_fkey FOREIGN KEY (nemesis_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_nemesis_user_id_fkey FOREIGN KEY (nemesis_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nemesis_assignments
    ADD CONSTRAINT nemesis_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nemesis_challenges
    ADD CONSTRAINT nemesis_challenges_challenged_id_fkey FOREIGN KEY (challenged_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.nemesis_challenges
    ADD CONSTRAINT nemesis_challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.new_member_quest_dismissals
    ADD CONSTRAINT new_member_quest_dismissals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.new_member_quests
    ADD CONSTRAINT new_member_quests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payment_context_settings
    ADD CONSTRAINT payment_context_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payout_dead_letter_queue
    ADD CONSTRAINT payout_dead_letter_queue_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payout_dead_letter_queue
    ADD CONSTRAINT payout_dead_letter_queue_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.creator_payouts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.phone_verification_codes
    ADD CONSTRAINT phone_verification_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_council_ideas
    ADD CONSTRAINT platform_council_ideas_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_council_members
    ADD CONSTRAINT platform_council_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_events
    ADD CONSTRAINT platform_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.play_purchase_receipts
    ADD CONSTRAINT play_purchase_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.poll_options
    ADD CONSTRAINT poll_options_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.polls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.poll_options(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.polls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.portal_follows
    ADD CONSTRAINT portal_follows_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.portal_follows
    ADD CONSTRAINT portal_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.portal_stats_daily
    ADD CONSTRAINT portal_stats_daily_portal_id_fkey FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.portals
    ADD CONSTRAINT portals_bb_board_id_fkey FOREIGN KEY (bb_board_id) REFERENCES public.bb_boards(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.portals
    ADD CONSTRAINT portals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.portals
    ADD CONSTRAINT portals_hashtag_id_fkey FOREIGN KEY (hashtag_id) REFERENCES public.hashtags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_themes
    ADD CONSTRAINT profile_themes_store_item_id_fkey FOREIGN KEY (store_item_id) REFERENCES public.store_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.push_tickets
    ADD CONSTRAINT push_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quest_feature_boosts
    ADD CONSTRAINT quest_feature_boosts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.quiz_attempt_answers
    ADD CONSTRAINT quiz_attempt_answers_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_attempt_answers
    ADD CONSTRAINT quiz_attempt_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.quiz_questions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_attempts
    ADD CONSTRAINT quiz_attempts_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_attempts
    ADD CONSTRAINT quiz_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_question_options
    ADD CONSTRAINT quiz_question_options_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.quiz_questions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_questions
    ADD CONSTRAINT quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.rank_up_events
    ADD CONSTRAINT rank_up_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reaction_set_items
    ADD CONSTRAINT reaction_set_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.reaction_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_commissions
    ADD CONSTRAINT referral_commissions_reference_order_id_fkey FOREIGN KEY (reference_order_id) REFERENCES public.merch_orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.referral_commissions
    ADD CONSTRAINT referral_commissions_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_commissions
    ADD CONSTRAINT referral_commissions_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_visits
    ADD CONSTRAINT referral_visits_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_id_fkey FOREIGN KEY (referred_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_forum_answer_id_fkey FOREIGN KEY (reported_forum_answer_id) REFERENCES public.forum_answers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_forum_question_id_fkey FOREIGN KEY (reported_forum_question_id) REFERENCES public.forum_questions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_guild_id_fkey FOREIGN KEY (reported_guild_id) REFERENCES public.guilds(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_message_id_fkey FOREIGN KEY (reported_message_id) REFERENCES public.room_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_poll_id_fkey FOREIGN KEY (reported_poll_id) REFERENCES public.polls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_quiz_id_fkey FOREIGN KEY (reported_quiz_id) REFERENCES public.quizzes(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_room_id_fkey FOREIGN KEY (reported_room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_tweet_id_fkey FOREIGN KEY (reported_tweet_id) REFERENCES public.tweets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_wiki_id_fkey FOREIGN KEY (reported_wiki_id) REFERENCES public.wikis(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_wiki_page_id_fkey FOREIGN KEY (reported_wiki_page_id) REFERENCES public.wiki_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.restore_email_tasks
    ADD CONSTRAINT restore_email_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_member_highlights
    ADD CONSTRAINT room_member_highlights_highlighted_by_fkey FOREIGN KEY (highlighted_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_member_highlights
    ADD CONSTRAINT room_member_highlights_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_member_highlights
    ADD CONSTRAINT room_member_highlights_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_members
    ADD CONSTRAINT room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_message_reactions
    ADD CONSTRAINT room_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.room_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_message_reactions
    ADD CONSTRAINT room_message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_message_reactions
    ADD CONSTRAINT room_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_messages
    ADD CONSTRAINT room_messages_group_chat_id_fkey FOREIGN KEY (group_chat_id) REFERENCES public.group_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_messages
    ADD CONSTRAINT room_messages_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.room_messages
    ADD CONSTRAINT room_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.room_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.room_messages
    ADD CONSTRAINT room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_messages
    ADD CONSTRAINT room_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_moderation_log
    ADD CONSTRAINT room_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_moderation_log
    ADD CONSTRAINT room_moderation_log_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_moderation_log
    ADD CONSTRAINT room_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.room_monthly_active_users
    ADD CONSTRAINT room_monthly_active_users_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_pins
    ADD CONSTRAINT room_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_promotions
    ADD CONSTRAINT room_promotions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_promotions
    ADD CONSTRAINT room_promotions_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.room_promotions
    ADD CONSTRAINT room_promotions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_subscriptions
    ADD CONSTRAINT room_subscriptions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_subscriptions
    ADD CONSTRAINT room_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_visits
    ADD CONSTRAINT room_visits_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.room_visits
    ADD CONSTRAINT room_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_flagged_by_fkey FOREIGN KEY (flagged_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_spotlight_by_fkey FOREIGN KEY (spotlight_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.season_pass_milestones
    ADD CONSTRAINT season_pass_milestones_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.season_rank_archives
    ADD CONSTRAINT season_rank_archives_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.season_rank_archives
    ADD CONSTRAINT season_rank_archives_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_contact_messages
    ADD CONSTRAINT site_contact_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.creator_payouts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.sponsored_quests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sponsored_quest_applications
    ADD CONSTRAINT sponsored_quest_applications_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quest_events
    ADD CONSTRAINT sponsored_quest_events_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.sponsored_quests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sponsored_quest_events
    ADD CONSTRAINT sponsored_quest_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_business_account_id_fkey FOREIGN KEY (business_account_id) REFERENCES public.business_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_business_page_id_fkey FOREIGN KEY (business_page_id) REFERENCES public.business_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_flagged_by_fkey FOREIGN KEY (flagged_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_funded_by_user_id_fkey FOREIGN KEY (funded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_paused_by_fkey FOREIGN KEY (paused_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sponsored_quests
    ADD CONSTRAINT sponsored_quests_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.staff_alert_contacts
    ADD CONSTRAINT staff_alert_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.star_ledger
    ADD CONSTRAINT star_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stickers
    ADD CONSTRAINT stickers_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_packs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.store_items
    ADD CONSTRAINT store_items_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subscription_cancellation_feedback
    ADD CONSTRAINT subscription_cancellation_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_account_type_slug_fkey FOREIGN KEY (account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_ticket_events
    ADD CONSTRAINT support_ticket_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.support_ticket_events
    ADD CONSTRAINT support_ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.system_alerts
    ADD CONSTRAINT system_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.tale_account_restrictions
    ADD CONSTRAINT tale_account_restrictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_appeals
    ADD CONSTRAINT tale_appeals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_author_subscriptions
    ADD CONSTRAINT tale_author_subscriptions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_author_subscriptions
    ADD CONSTRAINT tale_author_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_chapters
    ADD CONSTRAINT tale_chapters_tale_id_fkey FOREIGN KEY (tale_id) REFERENCES public.tales(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_comments
    ADD CONSTRAINT tale_comments_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.tale_chapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_comments
    ADD CONSTRAINT tale_comments_tale_id_fkey FOREIGN KEY (tale_id) REFERENCES public.tales(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_comments
    ADD CONSTRAINT tale_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_moderation_log
    ADD CONSTRAINT tale_moderation_log_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.tale_unlocks
    ADD CONSTRAINT tale_unlocks_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.tale_chapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_unlocks
    ADD CONSTRAINT tale_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_votes
    ADD CONSTRAINT tale_votes_tale_id_fkey FOREIGN KEY (tale_id) REFERENCES public.tales(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tale_votes
    ADD CONSTRAINT tale_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tales
    ADD CONSTRAINT tales_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.telegram_delivery_queue
    ADD CONSTRAINT telegram_delivery_queue_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.admin_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.track_milestone_unlocks
    ADD CONSTRAINT track_milestone_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_likes
    ADD CONSTRAINT tweet_likes_tweet_id_fkey FOREIGN KEY (tweet_id) REFERENCES public.tweets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_likes
    ADD CONSTRAINT tweet_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_mentions
    ADD CONSTRAINT tweet_mentions_mentioned_user_id_fkey FOREIGN KEY (mentioned_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_mentions
    ADD CONSTRAINT tweet_mentions_tweet_id_fkey FOREIGN KEY (tweet_id) REFERENCES public.tweets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_retweets
    ADD CONSTRAINT tweet_retweets_tweet_id_fkey FOREIGN KEY (tweet_id) REFERENCES public.tweets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweet_retweets
    ADD CONSTRAINT tweet_retweets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweets
    ADD CONSTRAINT tweets_parent_tweet_id_fkey FOREIGN KEY (parent_tweet_id) REFERENCES public.tweets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tweets
    ADD CONSTRAINT tweets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_announcement_rotation
    ADD CONSTRAINT user_announcement_rotation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_banner_views
    ADD CONSTRAINT user_banner_views_banner_id_fkey FOREIGN KEY (banner_id) REFERENCES public.announcement_banners(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_banner_views
    ADD CONSTRAINT user_banner_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_cosmetics
    ADD CONSTRAINT user_cosmetics_store_item_id_fkey FOREIGN KEY (store_item_id) REFERENCES public.store_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_cosmetics
    ADD CONSTRAINT user_cosmetics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_crypto_wallets
    ADD CONSTRAINT user_crypto_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_daily_logins
    ADD CONSTRAINT user_daily_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_email_preferences
    ADD CONSTRAINT user_email_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_inactivity_events
    ADD CONSTRAINT user_inactivity_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_interests
    ADD CONSTRAINT user_interests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_messages
    ADD CONSTRAINT user_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_messages
    ADD CONSTRAINT user_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.user_modal_views
    ADD CONSTRAINT user_modal_views_modal_id_fkey FOREIGN KEY (modal_id) REFERENCES public.announcement_modals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_modal_views
    ADD CONSTRAINT user_modal_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_quest_decks
    ADD CONSTRAINT user_quest_decks_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quest_templates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_quest_decks
    ADD CONSTRAINT user_quest_decks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_quest_progress
    ADD CONSTRAINT user_quest_progress_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quest_templates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_quest_progress
    ADD CONSTRAINT user_quest_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_reaction_sets
    ADD CONSTRAINT user_reaction_sets_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.reaction_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_reaction_sets
    ADD CONSTRAINT user_reaction_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_milestone_id_fkey FOREIGN KEY (milestone_id) REFERENCES public.season_pass_milestones(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_season_milestone_claims
    ADD CONSTRAINT user_season_milestone_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_season_passes
    ADD CONSTRAINT user_season_passes_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_season_passes
    ADD CONSTRAINT user_season_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.sticker_packs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_sticker_packs
    ADD CONSTRAINT user_sticker_packs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_xp_boosters
    ADD CONSTRAINT user_xp_boosters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.username_change_history
    ADD CONSTRAINT username_change_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.username_reservations
    ADD CONSTRAINT username_reservations_previous_user_id_fkey FOREIGN KEY (previous_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_account_type_slug_fkey FOREIGN KEY (account_type_slug) REFERENCES public.account_types(slug);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_active_cosmetic_frame_id_fkey FOREIGN KEY (active_cosmetic_frame_id) REFERENCES public.store_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_active_profile_theme_id_fkey FOREIGN KEY (active_profile_theme_id) REFERENCES public.profile_themes(id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.war_contributions
    ADD CONSTRAINT war_contributions_guild_id_fkey FOREIGN KEY (guild_id) REFERENCES public.guilds(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.war_contributions
    ADD CONSTRAINT war_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.war_contributions
    ADD CONSTRAINT war_contributions_war_id_fkey FOREIGN KEY (war_id) REFERENCES public.guild_wars(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_collaborators
    ADD CONSTRAINT wiki_collaborators_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.wiki_collaborators
    ADD CONSTRAINT wiki_collaborators_moderator_granted_by_fkey FOREIGN KEY (moderator_granted_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.wiki_collaborators
    ADD CONSTRAINT wiki_collaborators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_collaborators
    ADD CONSTRAINT wiki_collaborators_wiki_id_fkey FOREIGN KEY (wiki_id) REFERENCES public.wikis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_invites
    ADD CONSTRAINT wiki_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_invites
    ADD CONSTRAINT wiki_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_invites
    ADD CONSTRAINT wiki_invites_used_by_user_id_fkey FOREIGN KEY (used_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.wiki_invites
    ADD CONSTRAINT wiki_invites_wiki_id_fkey FOREIGN KEY (wiki_id) REFERENCES public.wikis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_moderation_log
    ADD CONSTRAINT wiki_moderation_log_moderator_id_fkey FOREIGN KEY (moderator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_moderation_log
    ADD CONSTRAINT wiki_moderation_log_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.wiki_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_moderation_log
    ADD CONSTRAINT wiki_moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.wiki_moderation_log
    ADD CONSTRAINT wiki_moderation_log_wiki_id_fkey FOREIGN KEY (wiki_id) REFERENCES public.wikis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_page_revisions
    ADD CONSTRAINT wiki_page_revisions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_page_revisions
    ADD CONSTRAINT wiki_page_revisions_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.wiki_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_wiki_id_fkey FOREIGN KEY (wiki_id) REFERENCES public.wikis(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wikis
    ADD CONSTRAINT wikis_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.xp_events
    ADD CONSTRAINT xp_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.xp_ledger
    ADD CONSTRAINT xp_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.zobian_of_month
    ADD CONSTRAINT zobian_of_month_overridden_by_fkey FOREIGN KEY (overridden_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.zobian_of_month
    ADD CONSTRAINT zobian_of_month_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Final indexes


CREATE INDEX ad_campaigns_business_idx ON public.ad_campaigns USING btree (business_account_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX ad_campaigns_moderation_idx ON public.ad_campaigns USING btree (moderation_status, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX ad_campaigns_status_idx ON public.ad_campaigns USING btree (status) WHERE (deleted_at IS NULL);

CREATE INDEX ad_coupon_redemptions_user_idx ON public.ad_coupon_redemptions USING btree (user_id);

CREATE INDEX ad_creatives_campaign_idx ON public.ad_creatives USING btree (campaign_id);

CREATE INDEX ad_creatives_placement_idx ON public.ad_creatives USING btree (placement_key, is_active);

CREATE INDEX ad_events_campaign_idx ON public.ad_events USING btree (campaign_id, created_at DESC);

CREATE UNIQUE INDEX ad_events_client_dedupe_idx ON public.ad_events USING btree (creative_id, event_type, client_event_id) WHERE (client_event_id IS NOT NULL);

CREATE INDEX ad_events_creative_idx ON public.ad_events USING btree (creative_id, created_at DESC);

CREATE INDEX ad_events_user_idx ON public.ad_events USING btree (user_id, campaign_id, created_at DESC) WHERE (user_id IS NOT NULL);

CREATE INDEX audit_discrepancies_active_idx ON public.audit_discrepancies USING btree (user_id, asset_type) WHERE (resolved = false);

CREATE INDEX automation_generations_similarity_idx ON public.automation_generations USING gin (normalized gin_trgm_ops);

CREATE INDEX automation_jobs_due_idx ON public.automation_jobs USING btree (next_run_at) WHERE enabled;

CREATE INDEX blog_contact_messages_blog_idx ON public.blog_contact_messages USING btree (blog_id, created_at DESC);

CREATE UNIQUE INDEX blog_gift_claims_purchase_idx ON public.blog_gift_claims USING btree (purchase_id);

CREATE INDEX blog_gift_purchases_buyer_idx ON public.blog_gift_purchases USING btree (buyer_id);

CREATE INDEX blog_gift_purchases_tier_idx ON public.blog_gift_purchases USING btree (tier_id);

CREATE UNIQUE INDEX blog_gift_purchases_vip_badge_idx ON public.blog_gift_purchases USING btree (blog_id, buyer_id) WHERE ((benefit_type = 'vip_badge'::text) AND (status = 'active'::text));

CREATE INDEX blog_gift_tiers_blog_idx ON public.blog_gift_tiers USING btree (blog_id);

CREATE INDEX blog_moderation_log_blog_idx ON public.blog_moderation_log USING btree (blog_id, created_at DESC);

CREATE INDEX blog_post_comments_post_idx ON public.blog_post_comments USING btree (post_id, created_at DESC);

CREATE INDEX blog_post_daily_stats_post_idx ON public.blog_post_daily_stats USING btree (post_id, date DESC);

CREATE UNIQUE INDEX blog_post_shares_post_user_idx ON public.blog_post_shares USING btree (post_id, user_id);

CREATE UNIQUE INDEX blog_post_treasuries_gift_tier_idx ON public.blog_post_treasuries USING btree (gift_tier_id) WHERE (gift_tier_id IS NOT NULL);

CREATE UNIQUE INDEX blog_post_treasuries_post_idx ON public.blog_post_treasuries USING btree (post_id);

CREATE UNIQUE INDEX blog_post_treasury_claims_treasury_user_idx ON public.blog_post_treasury_claims USING btree (treasury_id, user_id, generation);

CREATE INDEX blog_posts_author_idx ON public.blog_posts USING btree (author_id);

CREATE UNIQUE INDEX blog_posts_blog_page_key_idx ON public.blog_posts USING btree (blog_id, page_key) WHERE ((page_key IS NOT NULL) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX blog_posts_blog_slug_live_idx ON public.blog_posts USING btree (blog_id, slug) WHERE (deleted_at IS NULL);

CREATE INDEX blog_posts_blog_status_published_idx ON public.blog_posts USING btree (blog_id, status, published_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX blog_posts_discovery_idx ON public.blog_posts USING btree (status, published_at DESC) WHERE ((deleted_at IS NULL) AND (type = 'article'::text));

CREATE INDEX blog_subscriptions_user_idx ON public.blog_subscriptions USING btree (user_id);

CREATE INDEX blogs_business_account_idx ON public.blogs USING btree (business_account_id) WHERE (deleted_at IS NULL);

CREATE INDEX blogs_owner_id_idx ON public.blogs USING btree (owner_id) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX bookmark_folders_name_idx ON public.bookmark_folders USING btree (user_id, lower(name));

CREATE INDEX bookmarks_folder_idx ON public.bookmarks USING btree (user_id, folder_id);

CREATE INDEX bookmarks_user_created_idx ON public.bookmarks USING btree (user_id, created_at DESC, id DESC);

CREATE INDEX business_page_daily_stats_page_idx ON public.business_page_daily_stats USING btree (page_id, date DESC);

CREATE INDEX business_page_posts_page_idx ON public.business_page_posts USING btree (page_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX business_pages_account_idx ON public.business_pages USING btree (business_account_id, created_at) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX content_shares_type_content_user_idx ON public.content_shares USING btree (content_type, content_id, user_id);

CREATE UNIQUE INDEX content_treasuries_type_content_idx ON public.content_treasuries USING btree (content_type, content_id);

CREATE UNIQUE INDEX content_treasury_claims_treasury_user_idx ON public.content_treasury_claims USING btree (treasury_id, user_id, generation);

CREATE UNIQUE INDEX creator_earnings_reference_id_idx ON public.creator_earnings USING btree (creator_id, reference_id) WHERE (reference_id IS NOT NULL);

CREATE INDEX failed_webhooks_due_idx ON public.failed_webhooks USING btree (next_retry_at, created_at) WHERE (resolved_at IS NULL);

CREATE UNIQUE INDEX forum_categories_slug_unique_idx ON public.forum_categories USING btree (slug);

CREATE UNIQUE INDEX forum_questions_slug_unique_idx ON public.forum_questions USING btree (slug) WHERE ((deleted_at IS NULL) AND (slug IS NOT NULL));

CREATE INDEX game_best_scores_leaderboard_idx ON public.game_best_scores USING btree (game_id, best_score DESC);

CREATE INDEX game_challenge_rounds_challenge_idx ON public.game_challenge_rounds USING btree (challenge_id, round_no);

CREATE INDEX game_challenges_challenger_idx ON public.game_challenges USING btree (challenger_id, status);

CREATE INDEX game_challenges_expiry_idx ON public.game_challenges USING btree (status, expires_at);

CREATE INDEX game_challenges_opponent_idx ON public.game_challenges USING btree (opponent_id, status);

CREATE INDEX game_plays_game_idx ON public.game_plays USING btree (game_id, ended_at);

CREATE UNIQUE INDEX game_plays_nonce_idx ON public.game_plays USING btree (session_nonce);

CREATE INDEX game_plays_user_idx ON public.game_plays USING btree (user_id, ended_at);

CREATE INDEX game_ratings_game_idx ON public.game_ratings USING btree (game_id);

CREATE INDEX games_category_active_idx ON public.games USING btree (category, sort_order) WHERE ((deleted_at IS NULL) AND (is_active = true));

CREATE UNIQUE INDEX games_slug_unique_idx ON public.games USING btree (slug);

CREATE INDEX gift_reward_grants_active_lookup_idx ON public.gift_reward_grants USING btree (context_type, context_id, sender_id) WHERE (revoked_at IS NULL);

CREATE INDEX gift_reward_grants_gift_id_idx ON public.gift_reward_grants USING btree (gift_id);

CREATE INDEX gift_reward_grants_sender_idx ON public.gift_reward_grants USING btree (sender_id, created_at DESC);

CREATE INDEX gifts_gift_type_id_idx ON public.gifts USING btree (gift_type_id);

CREATE UNIQUE INDEX guild_treasury_ledger_idem_idx ON public.guild_treasury_ledger USING btree (guild_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE INDEX help_ai_requests_usage_idx ON public.help_ai_requests USING btree (user_id, week_start, status);

CREATE INDEX help_docs_search_vector_idx ON public.help_docs USING gin (search_vector);

CREATE INDEX idx_account_appeals_created_at ON public.account_appeals USING btree (created_at DESC);

CREATE INDEX idx_account_appeals_status ON public.account_appeals USING btree (status);

CREATE INDEX idx_account_appeals_user_id ON public.account_appeals USING btree (user_id);

CREATE INDEX idx_ad_ai_escalations_campaign_id ON public.ad_ai_escalations USING btree (campaign_id);

CREATE INDEX idx_ad_ai_escalations_status ON public.ad_ai_escalations USING btree (status, created_at DESC);

CREATE INDEX idx_ad_campaigns_advertiser_grace ON public.ad_campaigns USING btree (advertiser_grace_until) WHERE (advertiser_grace_until IS NOT NULL);

CREATE INDEX idx_ad_campaigns_ai_escalated ON public.ad_campaigns USING btree (ai_escalated) WHERE (ai_escalated = true);

CREATE INDEX idx_ad_campaigns_created_by ON public.ad_campaigns USING btree (created_by);

CREATE INDEX idx_ad_wallet_ledger_user ON public.ad_wallet_ledger USING btree (user_id, created_at DESC);

CREATE INDEX idx_admin_actions_admin ON public.admin_actions USING btree (admin_id, created_at DESC);

CREATE INDEX idx_admin_actions_target ON public.admin_actions USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX idx_admin_audit_log_action ON public.admin_audit_log USING btree (action, created_at DESC);

CREATE INDEX idx_admin_audit_log_admin ON public.admin_audit_log USING btree (admin_id, created_at DESC);

CREATE INDEX idx_admin_audit_log_created_at ON public.admin_audit_log USING btree (created_at DESC, id DESC);

CREATE INDEX idx_admin_audit_log_target ON public.admin_audit_log USING btree (target_type, target_id, created_at DESC);

CREATE INDEX idx_admin_data_import_jobs_admin_created ON public.admin_data_import_jobs USING btree (admin_id, created_at DESC);

CREATE INDEX idx_admin_msg_receipts_user ON public.admin_message_receipts USING btree (user_id);

CREATE INDEX idx_ai_call_log_created_at ON public.ai_call_log USING btree (created_at);

CREATE INDEX idx_ai_call_log_feature ON public.ai_call_log USING btree (feature, created_at DESC);

CREATE INDEX idx_alert_notification_log_alert ON public.alert_notification_log USING btree (alert_id, created_at DESC);

CREATE INDEX idx_alliance_wars_active ON public.alliance_wars USING btree (status) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX idx_alliance_wars_active_pair ON public.alliance_wars USING btree (LEAST((alliance_1_id)::text, (alliance_2_id)::text), GREATEST((alliance_1_id)::text, (alliance_2_id)::text)) WHERE (status = 'active'::text);

CREATE INDEX idx_audit_discrepancies_archive_user ON public.audit_discrepancies_archive USING btree (user_id, detected_at DESC);

CREATE INDEX idx_audit_discrepancies_resolved_detected ON public.audit_discrepancies USING btree (detected_at) WHERE (resolved = true);

CREATE INDEX idx_audit_discrepancies_unresolved ON public.audit_discrepancies USING btree (detected_at) WHERE (resolved = false);

CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action, created_at DESC);

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_id, created_at DESC);

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC, id DESC);

CREATE INDEX idx_audit_log_target ON public.audit_log USING btree (target_type, target_id, created_at DESC);

CREATE INDEX idx_automated_actions_log_created ON public.automated_actions_log USING btree (created_at DESC);

CREATE INDEX idx_automated_actions_log_target_user ON public.automated_actions_log USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX idx_bb_boards_parent ON public.bb_boards USING btree (parent_id, sort_order);

CREATE INDEX idx_bb_post_reactions_post ON public.bb_post_reactions USING btree (post_id);

CREATE INDEX idx_bb_posts_thread ON public.bb_posts USING btree (thread_id, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_bb_pot_claims_thread ON public.bb_pot_claims USING btree (thread_id);

CREATE INDEX idx_bb_threads_board ON public.bb_threads USING btree (board_id, is_pinned DESC, last_reply_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_bb_threads_slug ON public.bb_threads USING btree (slug) WHERE (deleted_at IS NULL);

CREATE INDEX idx_blog_posts_excerpt_trgm ON public.blog_posts USING gin (excerpt gin_trgm_ops);

CREATE INDEX idx_blog_posts_search_vector ON public.blog_posts USING gin (search_vector);

CREATE INDEX idx_blog_posts_title_trgm ON public.blog_posts USING gin (title gin_trgm_ops);

CREATE INDEX idx_boost_types_active ON public.boost_types USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_business_accounts_verification_status ON public.business_accounts USING btree (verification_status) WHERE (verification_status = ANY (ARRAY['pending'::text, 'rejected'::text]));

CREATE INDEX idx_classroom_enrolments_room ON public.classroom_enrolments USING btree (room_id);

CREATE INDEX idx_classroom_enrolments_user ON public.classroom_enrolments USING btree (user_id);

CREATE INDEX idx_classroom_events_room ON public.classroom_events USING btree (room_id, starts_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_classroom_lesson_completions_room ON public.classroom_lesson_completions USING btree (room_id, completed_at DESC);

CREATE INDEX idx_classroom_likes_room ON public.classroom_likes USING btree (room_id, created_at DESC);

CREATE INDEX idx_classroom_member_points_board ON public.classroom_member_points USING btree (room_id, points DESC, user_id);

CREATE INDEX idx_classroom_moderators_user ON public.classroom_moderators USING btree (user_id) WHERE (status = 'active'::text);

CREATE INDEX idx_classroom_points_ledger_room_time ON public.classroom_points_ledger USING btree (room_id, created_at DESC);

CREATE INDEX idx_classroom_post_comments_post ON public.classroom_post_comments USING btree (post_id, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_classroom_post_comments_room ON public.classroom_post_comments USING btree (room_id, created_at DESC);

CREATE INDEX idx_classroom_posts_author ON public.classroom_posts USING btree (author_id, created_at DESC);

CREATE INDEX idx_classroom_posts_feed ON public.classroom_posts USING btree (room_id, is_pinned DESC, last_activity_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_classroom_reports_escalated ON public.classroom_reports USING btree (created_at DESC) WHERE ((status = 'pending'::text) AND (escalated = true));

CREATE INDEX idx_classroom_reports_room_status ON public.classroom_reports USING btree (room_id, status, created_at DESC);

CREATE INDEX idx_classroom_slug_history_room ON public.classroom_slug_history USING btree (room_id, changed_at DESC);

CREATE INDEX idx_coin_ledger_archive_user ON public.coin_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX idx_coin_ledger_created_at ON public.coin_ledger USING btree (created_at DESC);

CREATE INDEX idx_coin_ledger_user_id ON public.coin_ledger USING btree (user_id);

CREATE INDEX idx_coin_ledger_user_type_created ON public.coin_ledger USING btree (user_id, transaction_type, created_at);

CREATE INDEX idx_community_notes_target ON public.community_notes USING btree (target_type, target_id);

CREATE INDEX idx_content_engagement_signals_user_created ON public.content_engagement_signals USING btree (user_id, created_at);

CREATE INDEX idx_content_hashtags_created ON public.content_hashtags USING btree (created_at DESC);

CREATE INDEX idx_content_hashtags_tag_created ON public.content_hashtags USING btree (hashtag_id, created_at DESC);

CREATE INDEX idx_content_hashtags_tag_type ON public.content_hashtags USING btree (hashtag_id, content_type, created_at DESC);

CREATE UNIQUE INDEX idx_content_hashtags_unique ON public.content_hashtags USING btree (content_type, content_id, hashtag_id);

CREATE INDEX idx_conversation_scores_score ON public.conversation_scores USING btree (score DESC) WHERE (score > 0);

CREATE INDEX idx_conversation_scores_u1 ON public.conversation_scores USING btree (user_id_1);

CREATE INDEX idx_conversation_scores_u2 ON public.conversation_scores USING btree (user_id_2);

CREATE INDEX idx_council_invitations_date ON public.council_invitations USING btree (invited_at DESC);

CREATE INDEX idx_council_invitations_user ON public.council_invitations USING btree (user_id);

CREATE INDEX idx_creator_bank_accounts_creator ON public.creator_bank_accounts USING btree (creator_id);

CREATE INDEX idx_creator_broadcasts_business_account_created ON public.creator_broadcasts USING btree (business_account_id, created_at) WHERE (business_account_id IS NOT NULL);

CREATE INDEX idx_creator_broadcasts_created ON public.creator_broadcasts USING btree (created_at DESC);

CREATE INDEX idx_creator_broadcasts_creator ON public.creator_broadcasts USING btree (creator_id);

CREATE INDEX idx_creator_broadcasts_recipient ON public.creator_broadcasts USING btree (recipient_id, created_at DESC) WHERE (recipient_id IS NOT NULL);

CREATE INDEX idx_creator_earnings_creator ON public.creator_earnings USING btree (creator_id, created_at DESC);

CREATE INDEX idx_creator_payouts_creator ON public.creator_payouts USING btree (creator_id, created_at DESC);

CREATE INDEX idx_creator_payouts_pending_bank ON public.creator_payouts USING btree (created_at) WHERE ((status = 'pending'::text) AND (payout_method = 'bank_transfer'::text));

CREATE INDEX idx_creator_payouts_provider_ref ON public.creator_payouts USING btree (provider_reference);

CREATE INDEX idx_creator_payouts_retry ON public.creator_payouts USING btree (next_retry_at) WHERE ((status = 'failed'::text) AND (next_retry_at IS NOT NULL));

CREATE INDEX idx_creator_payouts_status ON public.creator_payouts USING btree (status) WHERE (status <> ALL (ARRAY['completed'::text, 'failed'::text]));

CREATE INDEX idx_creator_spotlights_creator ON public.creator_spotlights USING btree (creator_id);

CREATE INDEX idx_creator_spotlights_is_active ON public.creator_spotlights USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_creator_spotlights_month ON public.creator_spotlights USING btree (month_year DESC);

CREATE INDEX idx_creator_wallet_addresses_creator ON public.creator_wallet_addresses USING btree (creator_id);

CREATE INDEX idx_crypto_balance_ledger_user ON public.crypto_balance_ledger USING btree (user_id, created_at);

CREATE INDEX idx_data_export_requests_status ON public.data_export_requests USING btree (status) WHERE (status = 'pending'::text);

CREATE INDEX idx_data_export_requests_user ON public.data_export_requests USING btree (user_id);

CREATE INDEX idx_dm_conversations_user1 ON public.dm_conversations USING btree (user_id_1);

CREATE INDEX idx_dm_conversations_user2 ON public.dm_conversations USING btree (user_id_2);

CREATE INDEX idx_dm_score_milestones ON public.dm_conversation_score_milestones USING btree (user_id_a, user_id_b);

CREATE INDEX idx_dm_sticker_unlocks_pair ON public.dm_score_sticker_unlocks USING btree (user_id_1, user_id_2);

CREATE INDEX idx_elder_mentorships_elder ON public.elder_mentorships USING btree (elder_id);

CREATE INDEX idx_elder_mentorships_mentee ON public.elder_mentorships USING btree (mentee_id);

CREATE INDEX idx_failed_webhooks_retry ON public.failed_webhooks USING btree (next_retry_at) WHERE ((resolved = false) AND (retry_count < 3));

CREATE INDEX idx_failed_xp_awards_pending ON public.failed_xp_awards USING btree (retry_count, last_retried_at) WHERE (resolved_at IS NULL);

CREATE INDEX idx_failed_xp_awards_retry ON public.failed_xp_awards USING btree (resolved_at, retry_count, last_retried_at) WHERE (resolved_at IS NULL);

CREATE INDEX idx_feature_flags_early_access_plans ON public.feature_flags USING gin (early_access_plans);

CREATE INDEX idx_flash_xp_events_announce ON public.flash_xp_events USING btree (announced_at, announcement_notification_sent, is_active);

CREATE INDEX idx_flash_xp_events_fires ON public.flash_xp_events USING btree (fires_at, fired, is_active);

CREATE INDEX idx_follows_follower ON public.follows USING btree (follower_id);

CREATE INDEX idx_follows_following ON public.follows USING btree (following_id);

CREATE INDEX idx_forum_answers_author ON public.forum_answers USING btree (author_id, created_at DESC);

CREATE INDEX idx_forum_answers_question ON public.forum_answers USING btree (question_id, parent_answer_id, vote_score DESC);

CREATE INDEX idx_forum_favorites_user ON public.forum_favorites USING btree (user_id, created_at DESC);

CREATE INDEX idx_forum_moderation_log_q ON public.forum_moderation_log USING btree (question_id);

CREATE INDEX idx_forum_questions_author ON public.forum_questions USING btree (author_id, created_at DESC);

CREATE INDEX idx_forum_questions_body_trgm ON public.forum_questions USING gin (body gin_trgm_ops);

CREATE INDEX idx_forum_questions_category ON public.forum_questions USING btree (category_id, created_at DESC);

CREATE INDEX idx_forum_questions_new ON public.forum_questions USING btree (status, created_at DESC);

CREATE INDEX idx_forum_questions_popular ON public.forum_questions USING btree (status, vote_score DESC, created_at DESC);

CREATE INDEX idx_forum_questions_search_vector ON public.forum_questions USING gin (search_vector);

CREATE INDEX idx_forum_questions_title_trgm ON public.forum_questions USING gin (title gin_trgm_ops);

CREATE INDEX idx_forum_questions_trending ON public.forum_questions USING btree (status, last_activity_at DESC);

CREATE INDEX idx_forum_votes_target ON public.forum_votes USING btree (target_type, target_id);

CREATE INDEX idx_friendships_addressee ON public.friendships USING btree (addressee_id);

CREATE INDEX idx_friendships_requester ON public.friendships USING btree (requester_id);

CREATE INDEX idx_game_challenges_archived ON public.game_challenges USING btree (archived_at) WHERE (archived_at IS NULL);

CREATE INDEX idx_game_favorites_game ON public.game_favorites USING btree (game_id);

CREATE INDEX idx_game_favorites_user_created ON public.game_favorites USING btree (user_id, created_at DESC);

CREATE INDEX idx_game_saves_user_updated ON public.game_saves USING btree (user_id, updated_at DESC);

CREATE INDEX idx_games_description_trgm ON public.games USING gin (description gin_trgm_ops);

CREATE INDEX idx_games_name_trgm ON public.games USING gin (name gin_trgm_ops);

CREATE INDEX idx_games_search_vector ON public.games USING gin (search_vector);

CREATE INDEX idx_games_tagline_trgm ON public.games USING gin (tagline gin_trgm_ops);

CREATE INDEX idx_group_chat_blocks_user ON public.group_chat_blocks USING btree (user_id);

CREATE INDEX idx_group_chat_members_muted ON public.group_chat_members USING btree (group_chat_id, muted_until) WHERE (muted_until IS NOT NULL);

CREATE INDEX idx_group_chats_creator_active ON public.group_chats USING btree (creator_id) WHERE ((is_active = true) AND (is_deactivated = false));

CREATE INDEX idx_guild_applications_guild ON public.guild_applications USING btree (guild_id, status);

CREATE INDEX idx_guild_applications_user ON public.guild_applications USING btree (user_id);

CREATE INDEX idx_guild_contribution_alerts_guild ON public.guild_contribution_alerts USING btree (guild_id);

CREATE INDEX idx_guild_invites_guild ON public.guild_invites USING btree (guild_id);

CREATE INDEX idx_guild_invites_token ON public.guild_invites USING btree (token);

CREATE INDEX idx_guild_members_active ON public.guild_members USING btree (guild_id) WHERE (left_at IS NULL);

CREATE INDEX idx_guild_members_guild ON public.guild_members USING btree (guild_id);

CREATE INDEX idx_guild_members_guild_contribution ON public.guild_members USING btree (guild_id, contribution_score);

CREATE INDEX idx_guild_members_moderator ON public.guild_members USING btree (guild_id) WHERE (is_moderator = true);

CREATE INDEX idx_guild_members_user ON public.guild_members USING btree (user_id);

CREATE INDEX idx_guild_members_user_joined ON public.guild_members USING btree (user_id, joined_at DESC);

CREATE INDEX idx_guild_messages_guild ON public.guild_messages USING btree (guild_id, created_at DESC);

CREATE INDEX idx_guild_messages_sender ON public.guild_messages USING btree (sender_id);

CREATE INDEX idx_guild_quest_contributions_quest ON public.guild_quest_contributions USING btree (quest_id);

CREATE INDEX idx_guild_quest_contributions_user ON public.guild_quest_contributions USING btree (user_id);

CREATE INDEX idx_guild_quests_active ON public.guild_quests USING btree (guild_id, is_active) WHERE (is_active = true);

CREATE INDEX idx_guild_quests_guild_week ON public.guild_quests USING btree (guild_id, week_start);

CREATE INDEX idx_guild_rooms_room ON public.guild_rooms USING btree (room_id);

CREATE INDEX idx_guild_treasury_ledger_guild ON public.guild_treasury_ledger USING btree (guild_id, created_at DESC);

CREATE INDEX idx_guild_treasury_ledger_ref ON public.guild_treasury_ledger USING btree (reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX idx_guild_wars_defender_active ON public.guild_wars USING btree (defender_guild_id) WHERE (status = ANY (ARRAY['active'::text, 'final_hour'::text]));

CREATE INDEX idx_guilds_banned ON public.guilds USING btree (is_banned) WHERE (is_banned = true);

CREATE INDEX idx_guilds_city ON public.guilds USING btree (city);

CREATE INDEX idx_guilds_suspended ON public.guilds USING btree (is_suspended) WHERE (is_suspended = true);

CREATE INDEX idx_guilds_tier ON public.guilds USING btree (tier);

CREATE INDEX idx_hall_of_fame_legacy ON public.hall_of_fame USING btree (legacy_score DESC);

CREATE INDEX idx_hall_of_fame_user ON public.hall_of_fame USING btree (user_id);

CREATE INDEX idx_hashtags_alias_of ON public.hashtags USING btree (alias_of) WHERE (alias_of IS NOT NULL);

CREATE INDEX idx_hashtags_last_used ON public.hashtags USING btree (last_used_at DESC) WHERE (is_blocked = false);

CREATE UNIQUE INDEX idx_hashtags_slug ON public.hashtags USING btree (slug);

CREATE INDEX idx_hashtags_slug_trgm ON public.hashtags USING gin (slug gin_trgm_ops);

CREATE INDEX idx_help_docs_category ON public.help_docs USING btree (category_id, sort_order) WHERE (deleted_at IS NULL);

CREATE INDEX idx_help_docs_published ON public.help_docs USING btree (published, updated_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_help_docs_search ON public.help_docs USING gin (search_vector);

CREATE INDEX idx_lb_rank_snapshots_scope ON public.leaderboard_rank_snapshots USING btree (scope, user_id);

CREATE INDEX idx_lb_snapshots_city ON public.leaderboard_snapshots USING btree (city, track, xp_value DESC) WHERE (city IS NOT NULL);

CREATE INDEX idx_lb_snapshots_scope ON public.leaderboard_snapshots USING btree (scope, track, xp_value DESC);

CREATE INDEX idx_lb_snapshots_scope_track_city ON public.leaderboard_snapshots USING btree (scope, track, city, xp_value DESC);

CREATE INDEX idx_lb_snapshots_user ON public.leaderboard_snapshots USING btree (user_id);

CREATE INDEX idx_leaderboard_rank_snapshots_user_scope ON public.leaderboard_rank_snapshots USING btree (user_id, scope);

CREATE INDEX idx_learning_certs_recipient ON public.learning_certificates USING btree (recipient_user_id);

CREATE INDEX idx_learning_certs_room_id ON public.learning_certificates USING btree (room_id);

CREATE INDEX idx_merch_orders_buyer_status ON public.merch_orders USING btree (buyer_id, status);

CREATE INDEX idx_merch_orders_creator_status ON public.merch_orders USING btree (creator_id, status);

CREATE INDEX idx_merch_orders_store ON public.merch_orders USING btree (store_id) WHERE (store_id IS NOT NULL);

CREATE INDEX idx_merch_product_reviews_product ON public.merch_product_reviews USING btree (product_id);

CREATE INDEX idx_merch_products_admin_featured ON public.merch_products USING btree (is_admin_featured) WHERE (is_admin_featured = true);

CREATE INDEX idx_merch_products_market_listing ON public.merch_products USING btree (is_active, product_type) WHERE (is_active = true);

CREATE INDEX idx_merch_products_sponsored ON public.merch_products USING btree (is_sponsored) WHERE (is_sponsored = true);

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);

CREATE INDEX idx_messages_group_chat ON public.messages USING btree (group_chat_id, created_at DESC) WHERE (group_chat_id IS NOT NULL);

CREATE INDEX idx_messages_recipient_dm ON public.messages USING btree (recipient_id) WHERE (recipient_id IS NOT NULL);

CREATE INDEX idx_messages_sender_dm ON public.messages USING btree (sender_id);

CREATE INDEX idx_messages_sender_plan_created ON public.messages USING btree (sender_plan_at_creation, created_at);

CREATE INDEX idx_messages_unread ON public.messages USING btree (conversation_id, recipient_id, is_read, is_deleted) WHERE ((is_read = false) AND (is_deleted = false));

CREATE INDEX idx_mod_ai_escalations_report ON public.moderation_ai_escalations USING btree (report_id);

CREATE INDEX idx_moderation_actions_actor_type ON public.moderation_actions USING btree (actor_type, created_at DESC);

CREATE INDEX idx_moderation_actions_target ON public.moderation_actions USING btree (target_user_id);

CREATE INDEX idx_moderation_report_reporters_created_at ON public.moderation_report_reporters USING btree (created_at);

CREATE INDEX idx_moderation_report_reporters_report ON public.moderation_report_reporters USING btree (report_id);

CREATE INDEX idx_moderation_reports_cluster_pending ON public.moderation_reports USING btree (cluster_key, created_at DESC) WHERE ((status = 'pending'::text) AND (cluster_key IS NOT NULL));

CREATE INDEX idx_moderation_reports_forum_answer ON public.moderation_reports USING btree (reported_forum_answer_id) WHERE (reported_forum_answer_id IS NOT NULL);

CREATE INDEX idx_moderation_reports_forum_question ON public.moderation_reports USING btree (reported_forum_question_id) WHERE (reported_forum_question_id IS NOT NULL);

CREATE INDEX idx_moderation_reports_pipeline ON public.moderation_reports USING btree (pipeline_status, created_at DESC);

CREATE INDEX idx_moderation_reports_reported ON public.moderation_reports USING btree (reported_user_id) WHERE (reported_user_id IS NOT NULL);

CREATE INDEX idx_moderation_reports_reporter ON public.moderation_reports USING btree (reporter_id);

CREATE INDEX idx_moderation_reports_status ON public.moderation_reports USING btree (status, created_at DESC);

CREATE INDEX idx_moments_active_feed ON public.moments USING btree (expires_at, created_at DESC);

CREATE INDEX idx_moments_expires_at ON public.moments USING btree (expires_at) WHERE (expires_at IS NOT NULL);

CREATE INDEX idx_moments_user ON public.moments USING btree (user_id);

CREATE INDEX idx_moments_user_created ON public.moments USING btree (user_id, created_at DESC);

CREATE INDEX idx_monthly_gift_drops_active ON public.monthly_gift_drops USING btree (available_from, available_until) WHERE is_active;

CREATE INDEX idx_nemesis_assignments_last_notified ON public.nemesis_assignments USING btree (last_notified_at) WHERE (is_active = true);

CREATE INDEX idx_nemesis_assignments_nemesis_user_id ON public.nemesis_assignments USING btree (nemesis_user_id);

CREATE INDEX idx_nemesis_assignments_user_id ON public.nemesis_assignments USING btree (user_id);

CREATE INDEX idx_nemesis_challenges_challenged ON public.nemesis_challenges USING btree (challenged_id, status);

CREATE INDEX idx_nemesis_challenges_challenger ON public.nemesis_challenges USING btree (challenger_id, status);

CREATE INDEX idx_nemesis_user_id ON public.nemesis_assignments USING btree (user_id);

CREATE INDEX idx_notices_active_window ON public.notices USING btree (is_active, starts_at, ends_at);

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);

CREATE INDEX idx_notifications_user_read_created ON public.notifications USING btree (user_id, is_read, created_at DESC);

CREATE INDEX idx_password_reset_token_hash ON public.password_reset_tokens USING btree (token_hash);

CREATE INDEX idx_payments_provider_ref ON public.payments USING btree (provider_reference);

CREATE INDEX idx_payments_provider_status ON public.payments USING btree (provider, status);

CREATE INDEX idx_payments_status ON public.payments USING btree (status);

CREATE INDEX idx_payments_tx_hash ON public.payments USING btree (tx_hash) WHERE (tx_hash IS NOT NULL);

CREATE INDEX idx_payments_user_id ON public.payments USING btree (user_id);

CREATE INDEX idx_payout_dlq_unresolved ON public.payout_dead_letter_queue USING btree (created_at DESC) WHERE (resolved_at IS NULL);

CREATE INDEX idx_platform_events_recurring ON public.platform_events USING btree (is_recurring_annual, event_type) WHERE (is_recurring_annual = true);

CREATE INDEX idx_portal_follows_user ON public.portal_follows USING btree (user_id, created_at DESC);

CREATE INDEX idx_portals_boost ON public.portals USING btree (boost_weight DESC) WHERE (boost_weight > 0);

CREATE UNIQUE INDEX idx_portals_hashtag ON public.portals USING btree (hashtag_id);

CREATE UNIQUE INDEX idx_portals_slug ON public.portals USING btree (slug);

CREATE INDEX idx_portals_status_activity ON public.portals USING btree (status, last_activity_at DESC);

CREATE INDEX idx_portals_title_trgm ON public.portals USING gin (title gin_trgm_ops);

CREATE INDEX idx_push_tickets_pending ON public.push_tickets USING btree (created_at) WHERE (status = 'pending'::text);

CREATE INDEX idx_quest_feature_boosts_active ON public.quest_feature_boosts USING btree (feature_key, starts_at, ends_at);

CREATE INDEX idx_quest_templates_feature_key ON public.quest_templates USING btree (feature_key) WHERE (feature_key IS NOT NULL);

CREATE UNIQUE INDEX idx_quest_templates_sponsored_quest_id ON public.quest_templates USING btree (sponsored_quest_id) WHERE (sponsored_quest_id IS NOT NULL);

CREATE INDEX idx_rank_up_events_archive_user ON public.rank_up_events_archive USING btree (user_id, created_at DESC);

CREATE INDEX idx_rank_up_events_user ON public.rank_up_events USING btree (user_id, created_at DESC);

CREATE INDEX idx_rank_up_events_user_created ON public.rank_up_events USING btree (user_id, created_at DESC);

CREATE INDEX idx_reaction_set_items_set_id ON public.reaction_set_items USING btree (set_id);

CREATE INDEX idx_referral_commissions_referrer ON public.referral_commissions USING btree (referrer_id);

CREATE INDEX idx_referral_commissions_source_type ON public.referral_commissions USING btree (source_type);

CREATE INDEX idx_referrals_qualified ON public.referrals USING btree (referrer_id) WHERE (qualified = false);

CREATE INDEX idx_referrals_qualified_tier ON public.referrals USING btree (qualified, tier) WHERE (qualified = false);

CREATE INDEX idx_refunds_user ON public.refunds USING btree (user_id, created_at DESC);

CREATE INDEX idx_rematch_tokens_guild ON public.guild_war_rematch_tokens USING btree (guild_id) WHERE (NOT is_used);

CREATE INDEX idx_reports_poll ON public.reports USING btree (reported_poll_id) WHERE (reported_poll_id IS NOT NULL);

CREATE INDEX idx_reports_quiz ON public.reports USING btree (reported_quiz_id) WHERE (reported_quiz_id IS NOT NULL);

CREATE INDEX idx_reports_reported_user_id ON public.reports USING btree (reported_user_id) WHERE (reported_user_id IS NOT NULL);

CREATE INDEX idx_reports_reporter ON public.reports USING btree (reporter_id);

CREATE INDEX idx_reports_status ON public.reports USING btree (status);

CREATE INDEX idx_reports_tweet ON public.reports USING btree (reported_tweet_id) WHERE (reported_tweet_id IS NOT NULL);

CREATE INDEX idx_reports_wiki ON public.reports USING btree (reported_wiki_id) WHERE (reported_wiki_id IS NOT NULL);

CREATE INDEX idx_reports_wiki_page ON public.reports USING btree (reported_wiki_page_id) WHERE (reported_wiki_page_id IS NOT NULL);

CREATE INDEX idx_room_mau_room_id ON public.room_monthly_active_users USING btree (room_id, month DESC);

CREATE INDEX idx_room_member_highlights_room ON public.room_member_highlights USING btree (room_id, expires_at);

CREATE INDEX idx_room_members_room ON public.room_members USING btree (room_id);

CREATE INDEX idx_room_members_user ON public.room_members USING btree (user_id);

CREATE INDEX idx_room_messages_created_at ON public.room_messages USING btree (created_at);

CREATE INDEX idx_room_messages_pin_expiry ON public.room_messages USING btree (pin_expires_at) WHERE ((is_pinned = true) AND (pin_expires_at IS NOT NULL));

CREATE INDEX idx_room_messages_pinned ON public.room_messages USING btree (room_id) WHERE (is_pinned = true);

CREATE INDEX idx_room_messages_room ON public.room_messages USING btree (room_id, created_at DESC);

CREATE INDEX idx_room_messages_sender ON public.room_messages USING btree (sender_id);

CREATE INDEX idx_room_mod_log_room ON public.room_moderation_log USING btree (room_id, created_at DESC);

CREATE INDEX idx_room_mod_log_target ON public.room_moderation_log USING btree (target_user_id) WHERE (target_user_id IS NOT NULL);

CREATE INDEX idx_room_msg_reactions_msg ON public.room_message_reactions USING btree (message_id);

CREATE INDEX idx_room_msg_reactions_user ON public.room_message_reactions USING btree (user_id);

CREATE INDEX idx_room_pins_room ON public.room_pins USING btree (room_id);

CREATE INDEX idx_room_pins_user ON public.room_pins USING btree (user_id);

CREATE INDEX idx_room_promotions_active ON public.room_promotions USING btree (room_id, is_active, ends_at);

CREATE INDEX idx_room_subscriptions_expiry ON public.room_subscriptions USING btree (expires_at) WHERE (status = 'active'::text);

CREATE INDEX idx_room_subscriptions_room ON public.room_subscriptions USING btree (room_id, status);

CREATE INDEX idx_room_subscriptions_user ON public.room_subscriptions USING btree (user_id, status);

CREATE INDEX idx_room_visits_user_last_visited ON public.room_visits USING btree (user_id, last_visited_at DESC);

CREATE INDEX idx_rooms_banned ON public.rooms USING btree (is_banned) WHERE (is_banned = true);

CREATE INDEX idx_rooms_city ON public.rooms USING btree (city);

CREATE INDEX idx_rooms_classroom_creator ON public.rooms USING btree (creator_id, created_at DESC) WHERE ((type = 'classroom'::text) AND (deleted_at IS NULL));

CREATE INDEX idx_rooms_creator_id ON public.rooms USING btree (creator_id);

CREATE INDEX idx_rooms_flagged ON public.rooms USING btree (flagged_at) WHERE (flagged_at IS NOT NULL);

CREATE INDEX idx_rooms_guild_id ON public.rooms USING btree (guild_id) WHERE (guild_id IS NOT NULL);

CREATE INDEX idx_rooms_is_active ON public.rooms USING btree (is_active) WHERE (is_active = true);

CREATE INDEX idx_rooms_spotlight ON public.rooms USING btree (spotlight_until) WHERE (spotlight_until IS NOT NULL);

CREATE INDEX idx_rooms_suspended ON public.rooms USING btree (is_suspended) WHERE (is_suspended = true);

CREATE INDEX idx_rooms_type ON public.rooms USING btree (type);

CREATE INDEX idx_season_milestone_claims ON public.user_season_milestone_claims USING btree (user_id, season_id);

CREATE INDEX idx_season_pass_milestones_season ON public.season_pass_milestones USING btree (season_id, milestone_xp);

CREATE INDEX idx_season_rank_archives_season ON public.season_rank_archives USING btree (season_id);

CREATE INDEX idx_season_rank_archives_user ON public.season_rank_archives USING btree (user_id);

CREATE INDEX idx_sponsored_banners_active ON public.sponsored_leaderboard_banners USING btree (is_active, starts_at, ends_at);

CREATE INDEX idx_sponsored_quest_events_daily_spend ON public.sponsored_quest_events USING btree (quest_id, event_type, created_at);

CREATE UNIQUE INDEX idx_sponsored_quest_events_impression_dedupe ON public.sponsored_quest_events USING btree (quest_id, user_id, (((created_at AT TIME ZONE 'UTC'::text))::date)) WHERE ((event_type = 'impression'::text) AND (user_id IS NOT NULL));

CREATE INDEX idx_sponsored_quest_events_quest ON public.sponsored_quest_events USING btree (quest_id, created_at DESC);

CREATE INDEX idx_sponsored_quests_daily_eligible ON public.sponsored_quests USING btree (is_active, moderation_status, is_daily_quest_eligible) WHERE ((deleted_at IS NULL) AND (is_daily_quest_eligible = true));

CREATE INDEX idx_sponsored_quests_flag_status ON public.sponsored_quests USING btree (flag_status) WHERE (flag_status = 'flagged'::text);

CREATE INDEX idx_sponsored_quests_owner ON public.sponsored_quests USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);

CREATE INDEX idx_staff_alert_contacts_user ON public.staff_alert_contacts USING btree (user_id);

CREATE INDEX idx_star_ledger_archive_user ON public.star_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX idx_star_ledger_created_at ON public.star_ledger USING btree (created_at);

CREATE INDEX idx_star_ledger_user ON public.star_ledger USING btree (user_id, created_at DESC);

CREATE INDEX idx_store_items_type_active ON public.store_items USING btree (item_type, is_active);

CREATE INDEX idx_subscription_cancellation_feedback_created ON public.subscription_cancellation_feedback USING btree (created_at);

CREATE INDEX idx_subscription_plans_active ON public.subscription_plans USING btree (is_active, plan, "interval");

CREATE INDEX idx_support_ticket_events_ticket ON public.support_ticket_events USING btree (ticket_id, created_at);

CREATE INDEX idx_support_ticket_messages_ticket ON public.support_ticket_messages USING btree (ticket_id, created_at);

CREATE INDEX idx_support_tickets_assigned ON public.support_tickets USING btree (assigned_to, status) WHERE ((deleted_at IS NULL) AND (assigned_to IS NOT NULL));

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status, last_activity_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_support_tickets_user ON public.support_tickets USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX idx_system_alerts_dedupe_open ON public.system_alerts USING btree (type, dedupe_key) WHERE ((resolved = false) AND (dedupe_key IS NOT NULL));

CREATE INDEX idx_system_alerts_escalation_due ON public.system_alerts USING btree (next_escalation_at) WHERE ((resolved = false) AND (escalation_complete = false) AND (next_escalation_at IS NOT NULL));

CREATE INDEX idx_system_alerts_priority ON public.system_alerts USING btree (priority_level, created_at DESC) WHERE (resolved = false);

CREATE INDEX idx_system_alerts_unresolved ON public.system_alerts USING btree (severity, created_at DESC) WHERE (resolved = false);

CREATE INDEX idx_telegram_delivery_queue_undelivered ON public.telegram_delivery_queue USING btree (created_at) WHERE ((delivered_at IS NULL) AND (failed_attempts < 3));

CREATE INDEX idx_telegram_login_states_created ON public.telegram_login_states USING btree (created_at);

CREATE INDEX idx_track_milestone_unlocks_user ON public.track_milestone_unlocks USING btree (user_id, track);

CREATE UNIQUE INDEX idx_tweet_likes_tweet_user ON public.tweet_likes USING btree (tweet_id, user_id);

CREATE INDEX idx_tweet_likes_user ON public.tweet_likes USING btree (user_id);

CREATE UNIQUE INDEX idx_tweet_mentions_tweet_user ON public.tweet_mentions USING btree (tweet_id, mentioned_user_id);

CREATE INDEX idx_tweet_mentions_user_created ON public.tweet_mentions USING btree (mentioned_user_id, created_at DESC);

CREATE UNIQUE INDEX idx_tweet_retweets_tweet_user ON public.tweet_retweets USING btree (tweet_id, user_id);

CREATE INDEX idx_tweet_retweets_user_created ON public.tweet_retweets USING btree (user_id, created_at DESC);

CREATE INDEX idx_tweets_created_at ON public.tweets USING btree (created_at DESC) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX idx_tweets_one_pinned_per_user ON public.tweets USING btree (user_id) WHERE ((is_pinned = true) AND (deleted_at IS NULL));

CREATE INDEX idx_tweets_parent_id ON public.tweets USING btree (parent_tweet_id, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_tweets_user_id ON public.tweets USING btree (user_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX idx_user_ann_rotation_user ON public.user_announcement_rotation USING btree (user_id);

CREATE UNIQUE INDEX idx_user_badges_key ON public.user_badges USING btree (user_id, badge_key) WHERE (badge_key IS NOT NULL);

CREATE INDEX idx_user_badges_user_awarded ON public.user_badges USING btree (user_id, awarded_at DESC);

CREATE INDEX idx_user_banner_views_user ON public.user_banner_views USING btree (user_id);

CREATE INDEX idx_user_blocks_blocked ON public.user_blocks USING btree (blocked_id);

CREATE INDEX idx_user_blocks_blocker ON public.user_blocks USING btree (blocker_id);

CREATE INDEX idx_user_cosmetics_active ON public.user_cosmetics USING btree (user_id, is_active) WHERE (is_active = true);

CREATE INDEX idx_user_cosmetics_user ON public.user_cosmetics USING btree (user_id, cosmetic_type);

CREATE INDEX idx_user_crypto_wallets_user ON public.user_crypto_wallets USING btree (user_id);

CREATE INDEX idx_user_email_prefs_user ON public.user_email_preferences USING btree (user_id);

CREATE INDEX idx_user_inactivity_events_notified ON public.user_inactivity_events USING btree (push_email_notified, created_at) WHERE (push_email_notified = false);

CREATE INDEX idx_user_inactivity_events_telegram ON public.user_inactivity_events USING btree (telegram_notified, created_at) WHERE (telegram_notified = false);

CREATE INDEX idx_user_inactivity_notified ON public.user_inactivity_events USING btree (notified, created_at) WHERE (notified = false);

CREATE INDEX idx_user_interests_user ON public.user_interests USING btree (user_id);

CREATE INDEX idx_user_messages_recipient ON public.user_messages USING btree (recipient_id, created_at DESC);

CREATE INDEX idx_user_messages_unread ON public.user_messages USING btree (recipient_id) WHERE (is_read = false);

CREATE INDEX idx_user_pins_user ON public.user_pins USING btree (user_id);

CREATE INDEX idx_user_push_tokens_user ON public.user_push_tokens USING btree (user_id);

CREATE INDEX idx_user_quest_decks_user_date ON public.user_quest_decks USING btree (user_id, assigned_date);

CREATE INDEX idx_user_quest_progress_user_date ON public.user_quest_progress USING btree (user_id, quest_date);

CREATE INDEX idx_user_reaction_sets_user_id ON public.user_reaction_sets USING btree (user_id);

CREATE INDEX idx_user_sticker_packs_user_pack ON public.user_sticker_packs USING btree (user_id, pack_id);

CREATE INDEX idx_user_titles_user ON public.user_titles USING btree (user_id);

CREATE INDEX idx_user_xp_boosters_user_active ON public.user_xp_boosters USING btree (user_id, expires_at);

CREATE INDEX idx_username_change_history_user ON public.username_change_history USING btree (user_id, changed_at DESC);

CREATE INDEX idx_username_reservations_previous_user ON public.username_reservations USING btree (previous_user_id);

CREATE INDEX idx_users_bio_trgm ON public.users USING gin (bio gin_trgm_ops);

CREATE INDEX idx_users_city ON public.users USING btree (city) WHERE (city IS NOT NULL);

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX idx_users_display_name_trgm ON public.users USING gin (display_name gin_trgm_ops);

CREATE INDEX idx_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);

CREATE INDEX idx_users_export_country ON public.users USING btree (country) WHERE ((deleted_at IS NULL) AND (country IS NOT NULL));

CREATE INDEX idx_users_export_created_at ON public.users USING btree (deleted_at, created_at DESC, id DESC);

CREATE INDEX idx_users_export_filter ON public.users USING btree (deleted_at, plan, is_banned, is_suspended);

CREATE INDEX idx_users_export_trust_score ON public.users USING btree (trust_score) WHERE (deleted_at IS NULL);

CREATE INDEX idx_users_google_id ON public.users USING btree (google_id) WHERE (google_id IS NOT NULL);

CREATE INDEX idx_users_is_ad_moderator ON public.users USING btree (is_ad_moderator) WHERE (is_ad_moderator = true);

CREATE INDEX idx_users_is_senior_support ON public.users USING btree (is_senior_support) WHERE (is_senior_support = true);

CREATE INDEX idx_users_is_support ON public.users USING btree (is_support) WHERE (is_support = true);

CREATE INDEX idx_users_last_active ON public.users USING btree (last_active_at DESC);

CREATE INDEX idx_users_last_login_date ON public.users USING btree (last_login_date) WHERE (last_login_date IS NOT NULL);

CREATE INDEX idx_users_phone_number ON public.users USING btree (phone_number) WHERE (phone_number IS NOT NULL);

CREATE INDEX idx_users_plan ON public.users USING btree (plan);

CREATE INDEX idx_users_plan_deleted ON public.users USING btree (plan, deleted_at) WHERE (deleted_at IS NULL);

CREATE INDEX idx_users_prestige_boost ON public.users USING btree (prestige_cycle_boost_expires_at) WHERE (prestige_cycle_boost_expires_at IS NOT NULL);

CREATE INDEX idx_users_referral_code ON public.users USING btree (referral_code) WHERE (referral_code IS NOT NULL);

CREATE INDEX idx_users_referred_by ON public.users USING btree (referred_by) WHERE (referred_by IS NOT NULL);

CREATE INDEX idx_users_search_vector ON public.users USING gin (search_vector);

CREATE INDEX idx_users_telegram_id ON public.users USING btree (telegram_id) WHERE (telegram_id IS NOT NULL);

CREATE INDEX idx_users_username ON public.users USING btree (username);

CREATE INDEX idx_users_username_trgm ON public.users USING gin (username gin_trgm_ops);

CREATE INDEX idx_users_xp_total ON public.users USING btree (xp_total DESC);

CREATE INDEX idx_war_contributions_user ON public.war_contributions USING btree (user_id);

CREATE INDEX idx_war_contributions_war ON public.war_contributions USING btree (war_id);

CREATE INDEX idx_wiki_pages_search_vector ON public.wiki_pages USING gin (search_vector);

CREATE INDEX idx_wiki_pages_title_trgm ON public.wiki_pages USING gin (title gin_trgm_ops);

CREATE INDEX idx_xp_events_action ON public.xp_events USING btree (action);

CREATE INDEX idx_xp_events_archive_user ON public.xp_events_archive USING btree (user_id, created_at DESC);

CREATE INDEX idx_xp_events_created_at ON public.xp_events USING btree (created_at);

CREATE INDEX idx_xp_events_user ON public.xp_events USING btree (user_id, created_at DESC);

CREATE INDEX idx_xp_ledger_archive_user ON public.xp_ledger_archive USING btree (user_id, created_at DESC);

CREATE INDEX idx_xp_ledger_created_at ON public.xp_ledger USING btree (created_at DESC);

CREATE INDEX idx_xp_ledger_deck_completion ON public.xp_ledger USING btree (user_id, reference_id) WHERE ((source = 'deck_completion'::text) AND (reference_id IS NOT NULL));

CREATE INDEX idx_xp_ledger_track ON public.xp_ledger USING btree (track);

CREATE INDEX idx_xp_ledger_user_id ON public.xp_ledger USING btree (user_id);

CREATE INDEX idx_xp_ledger_user_source_date ON public.xp_ledger USING btree (user_id, source, (((created_at AT TIME ZONE 'UTC'::text))::date));

CREATE INDEX idx_xp_ledger_user_track_created ON public.xp_ledger USING btree (user_id, track, created_at);

CREATE INDEX kyc_documents_submission_idx ON public.kyc_documents USING btree (submission_id);

CREATE UNIQUE INDEX kyc_submissions_one_active_per_tier_idx ON public.kyc_submissions USING btree (user_id, tier) WHERE (status = ANY (ARRAY['pending'::text, 'ai_review'::text, 'manual_review'::text]));

CREATE INDEX kyc_submissions_status_idx ON public.kyc_submissions USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'ai_review'::text, 'manual_review'::text]));

CREATE INDEX kyc_submissions_submitted_idx ON public.kyc_submissions USING btree (submitted_at DESC);

CREATE INDEX kyc_submissions_user_idx ON public.kyc_submissions USING btree (user_id, tier);

CREATE UNIQUE INDEX leaderboard_snapshots_upsert_idx ON public.leaderboard_snapshots USING btree (user_id, track, scope, COALESCE(city, ''::text), COALESCE((season_id)::text, ''::text));

CREATE UNIQUE INDEX learning_certificates_room_recipient_idx ON public.learning_certificates USING btree (room_id, recipient_user_id);

CREATE UNIQUE INDEX messages_idempotency_key_unique ON public.messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX messages_retain_until_idx ON public.messages USING btree (retain_until) WHERE (retain_until IS NOT NULL);

CREATE UNIQUE INDEX messages_sender_idempotency_key_uq ON public.messages USING btree (sender_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX nemesis_assignments_active_idx ON public.nemesis_assignments USING btree (user_id, track) WHERE (is_active = true);

CREATE INDEX new_member_quests_user_id_idx ON public.new_member_quests USING btree (user_id);


CREATE INDEX object_deletion_due ON public.object_deletion_tasks USING btree (available_at) WHERE (attempts < 10);

CREATE INDEX play_purchase_receipts_user ON public.play_purchase_receipts USING btree (user_id);

CREATE INDEX poll_options_poll_idx ON public.poll_options USING btree (poll_id, "position");

CREATE UNIQUE INDEX poll_votes_poll_option_user_idx ON public.poll_votes USING btree (poll_id, option_id, user_id);

CREATE INDEX poll_votes_poll_user_idx ON public.poll_votes USING btree (poll_id, user_id);

CREATE INDEX polls_creator_idx ON public.polls USING btree (creator_id);

CREATE UNIQUE INDEX polls_slug_idx ON public.polls USING btree (slug) WHERE (deleted_at IS NULL);

CREATE INDEX polls_status_created_idx ON public.polls USING btree (status, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX push_tickets_unresolved_idx ON public.push_tickets USING btree (created_at) WHERE (resolved_at IS NULL);

CREATE INDEX quiz_attempt_answers_attempt_idx ON public.quiz_attempt_answers USING btree (attempt_id);

CREATE INDEX quiz_attempts_quiz_user_idx ON public.quiz_attempts USING btree (quiz_id, user_id);

CREATE INDEX quiz_question_options_question_idx ON public.quiz_question_options USING btree (question_id, "position");

CREATE INDEX quiz_questions_quiz_idx ON public.quiz_questions USING btree (quiz_id, "position");

CREATE INDEX quizzes_creator_idx ON public.quizzes USING btree (creator_id);

CREATE UNIQUE INDEX quizzes_slug_idx ON public.quizzes USING btree (slug) WHERE (deleted_at IS NULL);

CREATE INDEX quizzes_status_created_idx ON public.quizzes USING btree (status, created_at DESC) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX referral_visits_dedup_idx ON public.referral_visits USING btree (referrer_id, visitor_key, visited_date);

CREATE INDEX referral_visits_referrer_idx ON public.referral_visits USING btree (referrer_id, visited_at DESC);

CREATE UNIQUE INDEX room_subscriptions_room_user_idx ON public.room_subscriptions USING btree (room_id, user_id);

CREATE UNIQUE INDEX rooms_ceremony_season_idx ON public.rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX rooms_season_ceremony_id_idx ON public.rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX rooms_season_ceremony_id_unique ON public.rooms USING btree (((metadata ->> 'season_ceremony_id'::text))) WHERE ((metadata ->> 'season_ceremony_id'::text) IS NOT NULL);

CREATE UNIQUE INDEX rooms_slug_unique_idx ON public.rooms USING btree (slug) WHERE ((deleted_at IS NULL) AND (slug IS NOT NULL));

CREATE UNIQUE INDEX season_pass_milestones_season_tier_sort_idx ON public.season_pass_milestones USING btree (season_id, tier, sort_order);

CREATE INDEX site_contact_messages_created_idx ON public.site_contact_messages USING btree (created_at DESC);

CREATE INDEX site_contact_messages_unread_idx ON public.site_contact_messages USING btree (is_read, created_at DESC) WHERE (is_read = false);

CREATE INDEX slug_redirects_entity_idx ON public.slug_redirects USING btree (entity_type, entity_id);

CREATE INDEX sponsored_quests_business_idx ON public.sponsored_quests USING btree (business_account_id) WHERE (deleted_at IS NULL);

CREATE INDEX sponsored_quests_moderation_idx ON public.sponsored_quests USING btree (moderation_status) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX store_items_iap_product_id_unique ON public.store_items USING btree (iap_product_id) WHERE (iap_product_id IS NOT NULL);

CREATE UNIQUE INDEX subscriptions_user_id_idx ON public.subscriptions USING btree (user_id);

CREATE UNIQUE INDEX subscriptions_user_id_uq ON public.subscriptions USING btree (user_id);

CREATE UNIQUE INDEX tale_appeal_pending_idx ON public.tale_appeals USING btree (user_id, target_type, target_id) WHERE (status = 'pending'::text);

CREATE INDEX tale_comments_page_idx ON public.tale_comments USING btree (tale_id, created_at DESC, id DESC);

CREATE INDEX tales_discovery_idx ON public.tales USING btree (status, moderation, published_at DESC, id DESC);

CREATE UNIQUE INDEX uidx_ad_wallet_ledger_tx_type_ref ON public.ad_wallet_ledger USING btree (user_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_alliance_wars_active_pair ON public.alliance_wars USING btree (alliance_1_id, alliance_2_id) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX uidx_classroom_likes_comment ON public.classroom_likes USING btree (user_id, comment_id) WHERE (comment_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_classroom_likes_post ON public.classroom_likes USING btree (user_id, post_id) WHERE (post_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_classroom_points_ledger_ref ON public.classroom_points_ledger USING btree (room_id, user_id, source, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_classroom_reports_open_comment ON public.classroom_reports USING btree (reporter_id, comment_id) WHERE ((comment_id IS NOT NULL) AND (status = 'pending'::text));

CREATE UNIQUE INDEX uidx_classroom_reports_open_post ON public.classroom_reports USING btree (reporter_id, post_id) WHERE ((post_id IS NOT NULL) AND (status = 'pending'::text));

CREATE UNIQUE INDEX uidx_coin_ledger_tx_type_ref ON public.coin_ledger USING btree (user_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_creator_bank_accounts_primary ON public.creator_bank_accounts USING btree (creator_id) WHERE ((is_primary = true) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX uidx_creator_crypto_balances_user_currency ON public.creator_crypto_balances USING btree (user_id, currency);

CREATE UNIQUE INDEX uidx_creator_wallet_addresses_creator_network ON public.creator_wallet_addresses USING btree (creator_id, network);

CREATE UNIQUE INDEX uidx_crypto_balance_ledger_currency_reference ON public.crypto_balance_ledger USING btree (currency, reference_id);

CREATE UNIQUE INDEX uidx_failed_commissions_payment_id ON public.failed_commissions USING btree (payment_id) WHERE (payment_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_guild_tier_history_guild_war ON public.guild_tier_history USING btree (guild_id, war_id) WHERE (war_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_messages_sender_idempotency ON public.messages USING btree (sender_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX uidx_notifications_user_type_ref ON public.notifications USING btree (user_id, type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_star_ledger_tx_type_ref ON public.star_ledger USING btree (user_id, transaction_type, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_user_daily_logins_user_date ON public.user_daily_logins USING btree (user_id, login_date);

CREATE UNIQUE INDEX uidx_xp_ledger_source_ref ON public.xp_ledger USING btree (user_id, source, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX uq_failed_xp_reference_partial ON public.failed_xp_awards USING btree (user_id, source, reference_id) WHERE (reference_id IS NOT NULL);

CREATE UNIQUE INDEX user_push_tokens_user_token_idx ON public.user_push_tokens USING btree (user_id, token);

CREATE INDEX wiki_collaborators_user_idx ON public.wiki_collaborators USING btree (user_id);

CREATE INDEX wiki_collaborators_wiki_idx ON public.wiki_collaborators USING btree (wiki_id, status);

CREATE UNIQUE INDEX wiki_collaborators_wiki_user_idx ON public.wiki_collaborators USING btree (wiki_id, user_id);

CREATE INDEX wiki_invites_invited_user_idx ON public.wiki_invites USING btree (invited_user_id) WHERE (used_at IS NULL);

CREATE INDEX wiki_invites_wiki_idx ON public.wiki_invites USING btree (wiki_id);

CREATE INDEX wiki_moderation_log_wiki_idx ON public.wiki_moderation_log USING btree (wiki_id, created_at DESC);

CREATE INDEX wiki_page_revisions_page_created_idx ON public.wiki_page_revisions USING btree (page_id, created_at DESC);

CREATE UNIQUE INDEX wiki_page_revisions_page_number_idx ON public.wiki_page_revisions USING btree (page_id, revision_number);

CREATE INDEX wiki_pages_wiki_idx ON public.wiki_pages USING btree (wiki_id, updated_at DESC) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX wiki_pages_wiki_slug_idx ON public.wiki_pages USING btree (wiki_id, slug) WHERE (deleted_at IS NULL);

CREATE INDEX wikis_owner_idx ON public.wikis USING btree (owner_id);

CREATE UNIQUE INDEX wikis_slug_idx ON public.wikis USING btree (slug) WHERE (deleted_at IS NULL);

CREATE INDEX wikis_status_created_idx ON public.wikis USING btree (status, created_at DESC) WHERE (deleted_at IS NULL);


-- Triggers


CREATE TRIGGER automation_official_name BEFORE UPDATE OF display_name ON public.users FOR EACH ROW EXECUTE FUNCTION public.automation_official_name();

CREATE TRIGGER business_account_product BEFORE INSERT OR UPDATE OF tier, account_type_slug ON public.business_accounts FOR EACH ROW EXECUTE FUNCTION public.validate_account_product();

CREATE TRIGGER business_bookmark_entitlement AFTER INSERT OR UPDATE OF status, tier ON public.business_accounts FOR EACH ROW EXECUTE FUNCTION public.retain_bookmark_entitlement();

CREATE TRIGGER immutable_account_product_base BEFORE UPDATE ON public.account_types FOR EACH ROW EXECUTE FUNCTION public.immutable_account_product_base();

CREATE TRIGGER subscriptions_account_product BEFORE INSERT OR UPDATE OF plan, account_type_slug ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.validate_account_product();

CREATE TRIGGER trg_help_docs_search_vector BEFORE INSERT OR UPDATE OF title, body_markdown ON public.help_docs FOR EACH ROW EXECUTE FUNCTION public.help_docs_search_vector_update();

CREATE TRIGGER trg_system_alerts_default_priority BEFORE INSERT ON public.system_alerts FOR EACH ROW EXECUTE FUNCTION public.system_alerts_default_priority();

CREATE TRIGGER users_account_product BEFORE INSERT OR UPDATE OF plan, account_type_slug ON public.users FOR EACH ROW EXECUTE FUNCTION public.validate_account_product();

CREATE TRIGGER users_bookmark_entitlement AFTER INSERT OR UPDATE OF plan ON public.users FOR EACH ROW EXECUTE FUNCTION public.retain_bookmark_entitlement();


-- Row-level security


ALTER TABLE public.account_restore_uses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_type_play_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_message_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.announcement_banners ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.announcement_modals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_discrepancies_archive ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.automation_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.automation_generations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.blog_post_bundle_purchases ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bookmark_entitlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bookmark_folders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.coin_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.content_hashtags ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.creator_kyc ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.creator_payouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cron_job_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crypto_transfer_claims ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dm_conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.failed_xp_awards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_progress_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.game_score_attestations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gift_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.group_chat_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.group_chats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.guild_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.guild_wars ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.guilds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.hashtags ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.help_ai_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.nemesis_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.object_deletion_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.play_purchase_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.portal_follows ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.portal_stats_daily ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.portals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rank_up_events_archive ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.restore_email_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.room_visits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.star_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_account_restrictions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_appeals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_author_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_chapters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_comments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_moderation_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_unlocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tale_votes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tales ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.telegram_login_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_modal_views ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.x_manifest ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.xp_ledger ENABLE ROW LEVEL SECURITY;


-- Policies


DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('service_role');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY account_type_play_products_service ON public.account_type_play_products TO %s USING (true) WITH CHECK (true);$definition$, existing_roles);
 END IF;
END
$policy$;

DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('service_role');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY account_types_service ON public.account_types TO %s USING (true) WITH CHECK (true);$definition$, existing_roles);
 END IF;
END
$policy$;

CREATE POLICY admin_messages_insert_service ON public.admin_messages FOR INSERT WITH CHECK (true);

CREATE POLICY admin_msg_receipts_insert_service ON public.admin_message_receipts FOR INSERT WITH CHECK (true);

CREATE POLICY admin_msg_receipts_own ON public.admin_message_receipts FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY admin_msg_receipts_update_own ON public.admin_message_receipts FOR UPDATE USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY app_server_access ON public.account_restore_uses USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.account_type_play_products USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.account_types USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.admin_message_receipts USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.admin_messages USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.announcement_banners USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.announcement_modals USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.audit_discrepancies_archive USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.automation_accounts USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.automation_generations USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.automation_jobs USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.blog_post_bundle_purchases USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.bookmark_entitlements USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.bookmark_folders USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.bookmarks USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.coin_ledger USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.content_hashtags USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.creator_earnings USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.creator_kyc USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.creator_payouts USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.crypto_transfer_claims USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.dm_conversations USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.failed_xp_awards USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.follows USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.friendships USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.game_saves USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.gift_items USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.gifts USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.group_chat_members USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.group_chats USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.guild_members USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.guild_wars USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.guilds USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.hashtags USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.help_ai_requests USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.kyc_documents USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.kyc_submissions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.message_reactions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.messages USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.nemesis_assignments USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.notifications USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.payments USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.phone_verification_codes USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.play_purchase_receipts USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.portal_follows USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.portal_stats_daily USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.portals USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.rank_up_events_archive USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.referral_commissions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.referrals USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.reports USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.room_members USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.room_messages USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.room_visits USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.rooms USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.seasons USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.star_ledger USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.subscriptions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_account_restrictions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_appeals USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_author_subscriptions USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_chapters USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_comments USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_moderation_log USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_unlocks USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tale_votes USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.tales USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.telegram_login_states USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.user_modal_views USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.users USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.x_manifest USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY app_server_access ON public.xp_ledger USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY banners_select ON public.announcement_banners FOR SELECT USING (true);

CREATE POLICY classroom_chat_enrolment ON public.room_messages AS RESTRICTIVE FOR SELECT USING (((current_setting('app.is_system'::text, true) = 'true'::text) OR ((NOT (EXISTS ( SELECT 1
   FROM public.rooms r
  WHERE ((r.id = room_messages.room_id) AND (r.type = 'classroom'::text))))) OR (EXISTS ( SELECT 1
   FROM public.classroom_enrolments ce
  WHERE ((ce.room_id = room_messages.room_id) AND ((ce.user_id)::text = current_setting('app.current_user_id'::text, true))))) OR (EXISTS ( SELECT 1
   FROM public.rooms r
  WHERE ((r.id = room_messages.room_id) AND ((r.creator_id)::text = current_setting('app.current_user_id'::text, true))))) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE (((u.id)::text = current_setting('app.current_user_id'::text, true)) AND (u.is_admin OR u.is_moderator)))) OR (EXISTS ( SELECT 1
   FROM public.classroom_moderators cm
  WHERE ((cm.room_id = room_messages.room_id) AND ((cm.user_id)::text = current_setting('app.current_user_id'::text, true)) AND (cm.status = 'active'::text) AND cm.is_moderator))))));

CREATE POLICY coin_ledger_insert_service ON public.coin_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY coin_ledger_isolation ON public.coin_ledger USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY coin_ledger_owner_or_admin ON public.coin_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

CREATE POLICY coin_ledger_select_own ON public.coin_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('anon','authenticated');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY content_hashtags_public_read ON public.content_hashtags FOR SELECT TO %s USING (true);$definition$, existing_roles);
 END IF;
END
$policy$;

CREATE POLICY creator_kyc_self_or_admin ON public.creator_kyc USING (((creator_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY creator_payouts_isolation ON public.creator_payouts USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((creator_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY creator_payouts_self_or_admin ON public.creator_payouts USING (((creator_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY cron_run_server ON public.cron_job_runs USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY cron_step_server ON public.cron_job_steps USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY crypto_claims_system ON public.crypto_transfer_claims USING ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY dm_conversations_isolation ON public.dm_conversations USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id_1)::text = current_setting('app.current_user_id'::text, true)) OR ((user_id_2)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY earnings_insert_service ON public.creator_earnings FOR INSERT WITH CHECK (true);

CREATE POLICY earnings_own ON public.creator_earnings FOR SELECT USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY failed_xp_awards_admin_or_system ON public.failed_xp_awards USING (((current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY follows_delete ON public.follows FOR DELETE USING (((follower_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY follows_insert ON public.follows FOR INSERT WITH CHECK (((follower_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY follows_select ON public.follows FOR SELECT USING (true);

CREATE POLICY friendships_insert ON public.friendships FOR INSERT WITH CHECK (((requester_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY friendships_own ON public.friendships FOR SELECT USING ((((requester_id)::text = current_setting('app.current_user_id'::text, true)) OR ((addressee_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY friendships_update_own ON public.friendships FOR UPDATE USING ((((requester_id)::text = current_setting('app.current_user_id'::text, true)) OR ((addressee_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY game_attestation_server ON public.game_score_attestations USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY game_progress_server ON public.game_progress_tasks USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY game_saves_isolation ON public.game_saves USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY gift_items_select ON public.gift_items FOR SELECT USING (true);

CREATE POLICY gifts_insert_service ON public.gifts FOR INSERT WITH CHECK (true);

CREATE POLICY gifts_own ON public.gifts FOR SELECT USING ((((sender_id)::text = current_setting('app.current_user_id'::text, true)) OR ((recipient_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY gifts_self_or_admin ON public.gifts USING (((sender_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (recipient_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY group_chat_members_insert_service ON public.group_chat_members FOR INSERT WITH CHECK (true);

CREATE POLICY group_chat_members_select ON public.group_chat_members FOR SELECT USING (public.app_group_member(group_chat_id));

CREATE POLICY group_chats_insert ON public.group_chats FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY group_chats_select ON public.group_chats FOR SELECT USING ((id IN ( SELECT group_chat_members.group_chat_id
   FROM public.group_chat_members
  WHERE ((group_chat_members.user_id)::text = current_setting('app.current_user_id'::text, true)))));

CREATE POLICY guild_members_delete_service ON public.guild_members FOR DELETE USING (true);

CREATE POLICY guild_members_insert_service ON public.guild_members FOR INSERT WITH CHECK (true);

CREATE POLICY guild_members_isolation ON public.guild_members USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY guild_members_read_public ON public.guild_members FOR SELECT USING (((current_setting('app.current_user_id'::text, true) = ''::text) AND (left_at IS NULL)));

CREATE POLICY guild_members_select ON public.guild_members FOR SELECT USING ((((user_id)::text = current_setting('app.current_user_id'::text, true)) OR public.app_guild_member(guild_id)));

CREATE POLICY guild_members_update_service ON public.guild_members FOR UPDATE USING (true);

CREATE POLICY guild_wars_insert_service ON public.guild_wars FOR INSERT WITH CHECK (true);

CREATE POLICY guild_wars_select ON public.guild_wars FOR SELECT USING (true);

CREATE POLICY guild_wars_update_service ON public.guild_wars FOR UPDATE USING (true);

CREATE POLICY guilds_insert ON public.guilds FOR INSERT WITH CHECK (((captain_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY guilds_select ON public.guilds FOR SELECT USING (true);

CREATE POLICY guilds_update_captain ON public.guilds FOR UPDATE USING (((captain_id)::text = current_setting('app.current_user_id'::text, true)));

DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('anon','authenticated');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY hashtags_public_read ON public.hashtags FOR SELECT TO %s USING ((is_blocked = false));$definition$, existing_roles);
 END IF;
END
$policy$;

CREATE POLICY kyc_documents_self_or_admin ON public.kyc_documents USING ((((user_id)::text = COALESCE(NULLIF(current_setting('app.user_id'::text, true), ''::text), NULLIF(current_setting('app.current_user_id'::text, true), ''::text))) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY kyc_submissions_self_or_admin ON public.kyc_submissions USING ((((user_id)::text = COALESCE(NULLIF(current_setting('app.user_id'::text, true), ''::text), NULLIF(current_setting('app.current_user_id'::text, true), ''::text))) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY manifest_select ON public.x_manifest FOR SELECT USING (true);

CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT WITH CHECK (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT USING (true);

CREATE POLICY messages_dm_select ON public.messages FOR SELECT USING ((((sender_id)::text = current_setting('app.current_user_id'::text, true)) OR ((recipient_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY messages_self_or_admin ON public.messages USING (((sender_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (recipient_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY messages_update_own ON public.messages FOR UPDATE USING (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY modal_views_own ON public.user_modal_views USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY modals_select ON public.announcement_modals FOR SELECT USING (true);

CREATE POLICY nemesis_own ON public.nemesis_assignments FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY notifications_isolation ON public.notifications USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY object_deletion_server ON public.object_deletion_tasks USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY payments_insert_service ON public.payments FOR INSERT WITH CHECK (true);

CREATE POLICY payments_own ON public.payments FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY payments_self_or_admin ON public.payments USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text) OR (current_setting('app.is_system'::text, true) = 'true'::text)));

CREATE POLICY payments_update_service ON public.payments FOR UPDATE USING (true);

CREATE POLICY payouts_insert_own ON public.creator_payouts FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY payouts_own ON public.creator_payouts FOR SELECT USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY phone_codes_system ON public.phone_verification_codes USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('service_role');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY play_purchase_receipts_service ON public.play_purchase_receipts TO %s USING (true) WITH CHECK (true);$definition$, existing_roles);
 END IF;
END
$policy$;

DO $policy$
DECLARE existing_roles text;
BEGIN
 SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO existing_roles FROM pg_roles WHERE rolname IN ('anon','authenticated');
 IF existing_roles IS NOT NULL THEN
  EXECUTE format($definition$CREATE POLICY portals_public_read ON public.portals FOR SELECT TO %s USING ((status <> 'suppressed'::text));$definition$, existing_roles);
 END IF;
END
$policy$;

CREATE POLICY referral_commissions_owner ON public.referral_commissions FOR SELECT USING (((referrer_id)::text = current_setting('app.user_id'::text, true)));

CREATE POLICY referrals_insert_service ON public.referrals FOR INSERT WITH CHECK (true);

CREATE POLICY referrals_own ON public.referrals FOR SELECT USING ((((referrer_id)::text = current_setting('app.current_user_id'::text, true)) OR ((referred_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY referrals_update_service ON public.referrals FOR UPDATE USING (true);

CREATE POLICY reports_insert ON public.reports FOR INSERT WITH CHECK (((reporter_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY reports_select_own ON public.reports FOR SELECT USING (((reporter_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY restore_mail_server ON public.restore_email_tasks USING ((current_setting('app.is_system'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY restore_uses_system ON public.account_restore_uses USING ((current_setting('app.is_system'::text, true) = 'true'::text));

CREATE POLICY room_members_insert_service ON public.room_members FOR INSERT WITH CHECK (true);

CREATE POLICY room_members_select ON public.room_members FOR SELECT USING ((room_id IN ( SELECT room_members_1.room_id
   FROM public.room_members room_members_1
  WHERE ((room_members_1.user_id)::text = current_setting('app.current_user_id'::text, true)))));

CREATE POLICY room_messages_insert ON public.room_messages FOR INSERT WITH CHECK (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY room_messages_select ON public.room_messages FOR SELECT USING (((room_id IN ( SELECT rooms.id
   FROM public.rooms
  WHERE (rooms.is_public = true))) OR (room_id IN ( SELECT room_members.room_id
   FROM public.room_members
  WHERE ((room_members.user_id)::text = current_setting('app.current_user_id'::text, true)))) OR ((sender_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY room_messages_update_own ON public.room_messages FOR UPDATE USING (((sender_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY room_visits_isolation ON public.room_visits USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY rooms_insert ON public.rooms FOR INSERT WITH CHECK (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY rooms_select ON public.rooms FOR SELECT USING (((is_public = true) OR ((creator_id)::text = current_setting('app.current_user_id'::text, true)) OR (id IN ( SELECT room_members.room_id
   FROM public.room_members
  WHERE ((room_members.user_id)::text = current_setting('app.current_user_id'::text, true))))));

CREATE POLICY rooms_update_creator ON public.rooms FOR UPDATE USING (((creator_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY seasons_select ON public.seasons FOR SELECT USING (true);

CREATE POLICY star_ledger_insert_service ON public.star_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY star_ledger_isolation ON public.star_ledger USING (((current_setting('app.current_user_id'::text, true) = ''::text) OR ((user_id)::text = current_setting('app.current_user_id'::text, true))));

CREATE POLICY star_ledger_owner_or_admin ON public.star_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

CREATE POLICY star_ledger_select_own ON public.star_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY subscriptions_insert_service ON public.subscriptions FOR INSERT WITH CHECK (true);

CREATE POLICY subscriptions_own ON public.subscriptions FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY subscriptions_update_service ON public.subscriptions FOR UPDATE USING (true);

CREATE POLICY telegram_login_states_service_only ON public.telegram_login_states USING (false) WITH CHECK (false);

CREATE POLICY users_select_public ON public.users FOR SELECT USING (true);

CREATE POLICY users_self_or_admin ON public.users USING (((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

CREATE POLICY users_update_own ON public.users FOR UPDATE USING (((id)::text = current_setting('app.current_user_id'::text, true)));

CREATE POLICY xp_ledger_insert_service ON public.xp_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY xp_ledger_owner_or_admin ON public.xp_ledger USING (((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid) OR (current_setting('app.is_admin'::text, true) = 'true'::text)));

CREATE POLICY xp_ledger_select_own ON public.xp_ledger FOR SELECT USING (((user_id)::text = current_setting('app.current_user_id'::text, true)));


CREATE TABLE public.transactional_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL,
 operation_key text NOT NULL,
 user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT NOW(),
 lease_token uuid,
 lease_until timestamptz,
 completed_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT NOW(),
 UNIQUE(kind,operation_key)
);
CREATE INDEX transactional_tasks_ready_idx ON public.transactional_tasks(status,available_at);
ALTER TABLE public.transactional_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactional_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY transactional_tasks_server ON public.transactional_tasks USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');

CREATE UNIQUE INDEX user_push_tokens_ownership_key_unique ON public.user_push_tokens(ownership_key);
CREATE UNIQUE INDEX creator_payouts_crypto_transfer_unique ON public.creator_payouts(crypto_chain,crypto_tx_hash) WHERE crypto_tx_hash IS NOT NULL;

-- Explicit Data API grants; neutralize inherited client/default grants first.


REVOKE ALL ON TABLE
  public.account_appeals,
  public.account_restore_uses,
  public.account_type_play_products,
  public.account_types,
  public.ad_ai_escalations,
  public.ad_campaign_daily_stats,
  public.ad_campaigns,
  public.ad_coupon_redemptions,
  public.ad_coupons,
  public.ad_creatives,
  public.ad_events,
  public.ad_placements,
  public.ad_wallet_ledger,
  public.admin_actions,
  public.admin_audit_log,
  public.admin_data_import_jobs,
  public.admin_message_receipts,
  public.admin_messages,
  public.admin_roles,
  public.ai_call_log,
  public.alert_notification_log,
  public.alliance_wars,
  public.announcement_banners,
  public.announcement_modals,
  public.app_settings,
  public.audit_discrepancies,
  public.audit_discrepancies_archive,
  public.audit_log,
  public.automated_actions_log,
  public.automation_accounts,
  public.automation_generations,
  public.automation_jobs,
  public.bb_boards,
  public.bb_post_reactions,
  public.bb_posts,
  public.bb_pot_claims,
  public.bb_threads,
  public.blog_categories,
  public.blog_contact_messages,
  public.blog_gift_claims,
  public.blog_gift_purchases,
  public.blog_gift_tiers,
  public.blog_moderation_log,
  public.blog_post_bundle_purchases,
  public.blog_post_comments,
  public.blog_post_daily_stats,
  public.blog_post_likes,
  public.blog_post_shares,
  public.blog_post_treasuries,
  public.blog_post_treasury_claims,
  public.blog_post_unlocks,
  public.blog_posts,
  public.blog_subscriptions,
  public.blog_themes,
  public.blogs,
  public.bookmark_entitlements,
  public.bookmark_folders,
  public.bookmarks,
  public.boost_types,
  public.branded_rooms,
  public.business_accounts,
  public.business_page_daily_stats,
  public.business_page_posts,
  public.business_pages,
  public.classroom_daily_stats,
  public.classroom_enrolments,
  public.classroom_events,
  public.classroom_lesson_completions,
  public.classroom_likes,
  public.classroom_member_badges,
  public.classroom_member_points,
  public.classroom_moderators,
  public.classroom_points_ledger,
  public.classroom_post_comments,
  public.classroom_posts,
  public.classroom_quiz_attempts,
  public.classroom_quiz_questions,
  public.classroom_quizzes,
  public.classroom_reports,
  public.classroom_shares,
  public.classroom_slug_history,
  public.coin_ledger,
  public.coin_ledger_archive,
  public.community_note_votes,
  public.community_notes,
  public.content_engagement_signals,
  public.content_hashtags,
  public.content_shares,
  public.content_treasuries,
  public.content_treasury_claims,
  public.conversation_scores,
  public.council_invitations,
  public.creator_bank_accounts,
  public.creator_broadcasts,
  public.creator_crypto_balances,
  public.creator_earnings,
  public.creator_kyc,
  public.creator_payouts,
  public.creator_spotlights,
  public.creator_wallet_addresses,
  public.cron_job_runs,
  public.cron_job_steps,
  public.cron_state,
  public.crypto_balance_ledger,
  public.crypto_exchange_rate_overrides,
  public.crypto_price_cache,
  public.crypto_transfer_claims,
  public.data_export_requests,
  public.dm_conversation_score_milestones,
  public.dm_conversation_unlocks,
  public.dm_conversations,
  public.dm_score_sticker_unlocks,
  public.drop_room_replays,
  public.elder_mentorships,
  public.elder_requests,
  public.failed_commissions,
  public.failed_webhooks,
  public.failed_xp_awards,
  public.feature_flags,
  public.flash_xp_events,
  public.follows,
  public.footer_scripts,
  public.forum_answers,
  public.forum_categories,
  public.forum_favorites,
  public.forum_moderation_log,
  public.forum_questions,
  public.forum_votes,
  public.friendships,
  public.game_best_scores,
  public.game_challenge_rounds,
  public.game_challenges,
  public.game_favorites,
  public.game_milestone_claims,
  public.game_play_milestones,
  public.game_plays,
  public.game_progress_tasks,
  public.game_ratings,
  public.game_saves,
  public.game_score_attestations,
  public.games,
  public.gift_items,
  public.gift_reward_grants,
  public.gift_types,
  public.gifts,
  public.group_chat_blocks,
  public.group_chat_members,
  public.group_chat_reactivation_choices,
  public.group_chats,
  public.guild_alliance_members,
  public.guild_alliances,
  public.guild_applications,
  public.guild_contribution_alerts,
  public.guild_invites,
  public.guild_members,
  public.guild_messages,
  public.guild_quest_contributions,
  public.guild_quests,
  public.guild_rooms,
  public.guild_tier_history,
  public.guild_treasury_ledger,
  public.guild_war_rematch_tokens,
  public.guild_wars,
  public.guilds,
  public.hall_of_fame,
  public.hashtags,
  public.help_ai_requests,
  public.help_categories,
  public.help_docs,
  public.kyc_documents,
  public.kyc_submissions,
  public.leaderboard_rank_snapshots,
  public.leaderboard_snapshots,
  public.learning_certificates,
  public.merch_orders,
  public.merch_product_reviews,
  public.merch_products,
  public.merch_stores,
  public.message_reactions,
  public.messages,
  public.moderation_actions,
  public.moderation_ai_escalations,
  public.moderation_report_reporters,
  public.moderation_reports,
  public.moment_reactions,
  public.moment_views,
  public.moments,
  public.monthly_gift_drops,
  public.nemesis_assignments,
  public.nemesis_challenges,
  public.new_member_quest_dismissals,
  public.new_member_quests,
  public.notices,
  public.notifications,
  public.object_deletion_tasks,
  public.password_reset_tokens,
  public.payment_context_settings,
  public.payments,
  public.payout_dead_letter_queue,
  public.phone_verification_codes,
  public.platform_council_ideas,
  public.platform_council_members,
  public.platform_events,
  public.play_purchase_receipts,
  public.poll_options,
  public.poll_votes,
  public.polls,
  public.portal_follows,
  public.portal_stats_daily,
  public.portals,
  public.profile_themes,
  public.push_tickets,
  public.quest_feature_boosts,
  public.quest_templates,
  public.quiz_attempt_answers,
  public.quiz_attempts,
  public.quiz_question_options,
  public.quiz_questions,
  public.quizzes,
  public.rank_up_events,
  public.rank_up_events_archive,
  public.reaction_set_items,
  public.reaction_sets,
  public.referral_commissions,
  public.referral_visits,
  public.referrals,
  public.refunds,
  public.reports,
  public.restore_email_tasks,
  public.room_member_highlights,
  public.room_members,
  public.room_message_reactions,
  public.room_messages,
  public.room_moderation_log,
  public.room_monthly_active_users,
  public.room_pins,
  public.room_promotions,
  public.room_subscriptions,
  public.room_visits,
  public.rooms,
  public.season_pass_milestones,
  public.season_rank_archives,
  public.seasons,
  public.site_contact_messages,
  public.slug_redirects,
  public.sponsored_leaderboard_banners,
  public.sponsored_quest_applications,
  public.sponsored_quest_events,
  public.sponsored_quests,
  public.staff_alert_contacts,
  public.star_ledger,
  public.star_ledger_archive,
  public.sticker_packs,
  public.stickers,
  public.store_items,
  public.subscription_cancellation_feedback,
  public.subscription_plans,
  public.subscriptions,
  public.support_ticket_events,
  public.support_ticket_messages,
  public.support_tickets,
  public.system_alerts,
  public.tale_account_restrictions,
  public.tale_appeals,
  public.tale_author_subscriptions,
  public.tale_chapters,
  public.tale_comments,
  public.tale_moderation_log,
  public.tale_unlocks,
  public.tale_votes,
  public.tales,
  public.telegram_delivery_queue,
  public.telegram_login_states,
  public.track_milestone_unlocks,
  public.tweet_likes,
  public.tweet_mentions,
  public.tweet_retweets,
  public.tweets,
  public.user_announcement_rotation,
  public.user_badges,
  public.user_banner_views,
  public.user_blocks,
  public.user_cosmetics,
  public.user_crypto_wallets,
  public.user_daily_logins,
  public.user_email_preferences,
  public.user_inactivity_events,
  public.user_interests,
  public.user_messages,
  public.user_modal_views,
  public.user_pins,
  public.user_push_tokens,
  public.user_quest_decks,
  public.user_quest_progress,
  public.user_reaction_sets,
  public.user_season_milestone_claims,
  public.user_season_passes,
  public.user_sticker_packs,
  public.user_subscriptions,
  public.user_titles,
  public.user_xp_boosters,
  public.username_change_history,
  public.username_reservations,
  public.users,
  public.war_contributions,
  public.wiki_collaborators,
  public.wiki_invites,
  public.wiki_moderation_log,
  public.wiki_page_revisions,
  public.wiki_pages,
  public.wikis,
  public.x_manifest,
  public.xp_events,
  public.xp_events_archive,
  public.xp_ledger,
  public.xp_ledger_archive,
  public.zobian_of_month,
  public.coin_ledger_history,
  public.star_ledger_history,
  public.xp_ledger_history
FROM PUBLIC;

DO $private$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON TABLE
  public.account_appeals,
  public.account_restore_uses,
  public.account_type_play_products,
  public.account_types,
  public.ad_ai_escalations,
  public.ad_campaign_daily_stats,
  public.ad_campaigns,
  public.ad_coupon_redemptions,
  public.ad_coupons,
  public.ad_creatives,
  public.ad_events,
  public.ad_placements,
  public.ad_wallet_ledger,
  public.admin_actions,
  public.admin_audit_log,
  public.admin_data_import_jobs,
  public.admin_message_receipts,
  public.admin_messages,
  public.admin_roles,
  public.ai_call_log,
  public.alert_notification_log,
  public.alliance_wars,
  public.announcement_banners,
  public.announcement_modals,
  public.app_settings,
  public.audit_discrepancies,
  public.audit_discrepancies_archive,
  public.audit_log,
  public.automated_actions_log,
  public.automation_accounts,
  public.automation_generations,
  public.automation_jobs,
  public.bb_boards,
  public.bb_post_reactions,
  public.bb_posts,
  public.bb_pot_claims,
  public.bb_threads,
  public.blog_categories,
  public.blog_contact_messages,
  public.blog_gift_claims,
  public.blog_gift_purchases,
  public.blog_gift_tiers,
  public.blog_moderation_log,
  public.blog_post_bundle_purchases,
  public.blog_post_comments,
  public.blog_post_daily_stats,
  public.blog_post_likes,
  public.blog_post_shares,
  public.blog_post_treasuries,
  public.blog_post_treasury_claims,
  public.blog_post_unlocks,
  public.blog_posts,
  public.blog_subscriptions,
  public.blog_themes,
  public.blogs,
  public.bookmark_entitlements,
  public.bookmark_folders,
  public.bookmarks,
  public.boost_types,
  public.branded_rooms,
  public.business_accounts,
  public.business_page_daily_stats,
  public.business_page_posts,
  public.business_pages,
  public.classroom_daily_stats,
  public.classroom_enrolments,
  public.classroom_events,
  public.classroom_lesson_completions,
  public.classroom_likes,
  public.classroom_member_badges,
  public.classroom_member_points,
  public.classroom_moderators,
  public.classroom_points_ledger,
  public.classroom_post_comments,
  public.classroom_posts,
  public.classroom_quiz_attempts,
  public.classroom_quiz_questions,
  public.classroom_quizzes,
  public.classroom_reports,
  public.classroom_shares,
  public.classroom_slug_history,
  public.coin_ledger,
  public.coin_ledger_archive,
  public.community_note_votes,
  public.community_notes,
  public.content_engagement_signals,
  public.content_hashtags,
  public.content_shares,
  public.content_treasuries,
  public.content_treasury_claims,
  public.conversation_scores,
  public.council_invitations,
  public.creator_bank_accounts,
  public.creator_broadcasts,
  public.creator_crypto_balances,
  public.creator_earnings,
  public.creator_kyc,
  public.creator_payouts,
  public.creator_spotlights,
  public.creator_wallet_addresses,
  public.cron_job_runs,
  public.cron_job_steps,
  public.cron_state,
  public.crypto_balance_ledger,
  public.crypto_exchange_rate_overrides,
  public.crypto_price_cache,
  public.crypto_transfer_claims,
  public.data_export_requests,
  public.dm_conversation_score_milestones,
  public.dm_conversation_unlocks,
  public.dm_conversations,
  public.dm_score_sticker_unlocks,
  public.drop_room_replays,
  public.elder_mentorships,
  public.elder_requests,
  public.failed_commissions,
  public.failed_webhooks,
  public.failed_xp_awards,
  public.feature_flags,
  public.flash_xp_events,
  public.follows,
  public.footer_scripts,
  public.forum_answers,
  public.forum_categories,
  public.forum_favorites,
  public.forum_moderation_log,
  public.forum_questions,
  public.forum_votes,
  public.friendships,
  public.game_best_scores,
  public.game_challenge_rounds,
  public.game_challenges,
  public.game_favorites,
  public.game_milestone_claims,
  public.game_play_milestones,
  public.game_plays,
  public.game_progress_tasks,
  public.game_ratings,
  public.game_saves,
  public.game_score_attestations,
  public.games,
  public.gift_items,
  public.gift_reward_grants,
  public.gift_types,
  public.gifts,
  public.group_chat_blocks,
  public.group_chat_members,
  public.group_chat_reactivation_choices,
  public.group_chats,
  public.guild_alliance_members,
  public.guild_alliances,
  public.guild_applications,
  public.guild_contribution_alerts,
  public.guild_invites,
  public.guild_members,
  public.guild_messages,
  public.guild_quest_contributions,
  public.guild_quests,
  public.guild_rooms,
  public.guild_tier_history,
  public.guild_treasury_ledger,
  public.guild_war_rematch_tokens,
  public.guild_wars,
  public.guilds,
  public.hall_of_fame,
  public.hashtags,
  public.help_ai_requests,
  public.help_categories,
  public.help_docs,
  public.kyc_documents,
  public.kyc_submissions,
  public.leaderboard_rank_snapshots,
  public.leaderboard_snapshots,
  public.learning_certificates,
  public.merch_orders,
  public.merch_product_reviews,
  public.merch_products,
  public.merch_stores,
  public.message_reactions,
  public.messages,
  public.moderation_actions,
  public.moderation_ai_escalations,
  public.moderation_report_reporters,
  public.moderation_reports,
  public.moment_reactions,
  public.moment_views,
  public.moments,
  public.monthly_gift_drops,
  public.nemesis_assignments,
  public.nemesis_challenges,
  public.new_member_quest_dismissals,
  public.new_member_quests,
  public.notices,
  public.notifications,
  public.object_deletion_tasks,
  public.password_reset_tokens,
  public.payment_context_settings,
  public.payments,
  public.payout_dead_letter_queue,
  public.phone_verification_codes,
  public.platform_council_ideas,
  public.platform_council_members,
  public.platform_events,
  public.play_purchase_receipts,
  public.poll_options,
  public.poll_votes,
  public.polls,
  public.portal_follows,
  public.portal_stats_daily,
  public.portals,
  public.profile_themes,
  public.push_tickets,
  public.quest_feature_boosts,
  public.quest_templates,
  public.quiz_attempt_answers,
  public.quiz_attempts,
  public.quiz_question_options,
  public.quiz_questions,
  public.quizzes,
  public.rank_up_events,
  public.rank_up_events_archive,
  public.reaction_set_items,
  public.reaction_sets,
  public.referral_commissions,
  public.referral_visits,
  public.referrals,
  public.refunds,
  public.reports,
  public.restore_email_tasks,
  public.room_member_highlights,
  public.room_members,
  public.room_message_reactions,
  public.room_messages,
  public.room_moderation_log,
  public.room_monthly_active_users,
  public.room_pins,
  public.room_promotions,
  public.room_subscriptions,
  public.room_visits,
  public.rooms,
  public.season_pass_milestones,
  public.season_rank_archives,
  public.seasons,
  public.site_contact_messages,
  public.slug_redirects,
  public.sponsored_leaderboard_banners,
  public.sponsored_quest_applications,
  public.sponsored_quest_events,
  public.sponsored_quests,
  public.staff_alert_contacts,
  public.star_ledger,
  public.star_ledger_archive,
  public.sticker_packs,
  public.stickers,
  public.store_items,
  public.subscription_cancellation_feedback,
  public.subscription_plans,
  public.subscriptions,
  public.support_ticket_events,
  public.support_ticket_messages,
  public.support_tickets,
  public.system_alerts,
  public.tale_account_restrictions,
  public.tale_appeals,
  public.tale_author_subscriptions,
  public.tale_chapters,
  public.tale_comments,
  public.tale_moderation_log,
  public.tale_unlocks,
  public.tale_votes,
  public.tales,
  public.telegram_delivery_queue,
  public.telegram_login_states,
  public.track_milestone_unlocks,
  public.tweet_likes,
  public.tweet_mentions,
  public.tweet_retweets,
  public.tweets,
  public.user_announcement_rotation,
  public.user_badges,
  public.user_banner_views,
  public.user_blocks,
  public.user_cosmetics,
  public.user_crypto_wallets,
  public.user_daily_logins,
  public.user_email_preferences,
  public.user_inactivity_events,
  public.user_interests,
  public.user_messages,
  public.user_modal_views,
  public.user_pins,
  public.user_push_tokens,
  public.user_quest_decks,
  public.user_quest_progress,
  public.user_reaction_sets,
  public.user_season_milestone_claims,
  public.user_season_passes,
  public.user_sticker_packs,
  public.user_subscriptions,
  public.user_titles,
  public.user_xp_boosters,
  public.username_change_history,
  public.username_reservations,
  public.users,
  public.war_contributions,
  public.wiki_collaborators,
  public.wiki_invites,
  public.wiki_moderation_log,
  public.wiki_page_revisions,
  public.wiki_pages,
  public.wikis,
  public.x_manifest,
  public.xp_events,
  public.xp_events_archive,
  public.xp_ledger,
  public.xp_ledger_archive,
  public.zobian_of_month,
  public.coin_ledger_history,
  public.star_ledger_history,
  public.xp_ledger_history
 FROM anon;
END IF; END $private$;

DO $private$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON TABLE
  public.account_appeals,
  public.account_restore_uses,
  public.account_type_play_products,
  public.account_types,
  public.ad_ai_escalations,
  public.ad_campaign_daily_stats,
  public.ad_campaigns,
  public.ad_coupon_redemptions,
  public.ad_coupons,
  public.ad_creatives,
  public.ad_events,
  public.ad_placements,
  public.ad_wallet_ledger,
  public.admin_actions,
  public.admin_audit_log,
  public.admin_data_import_jobs,
  public.admin_message_receipts,
  public.admin_messages,
  public.admin_roles,
  public.ai_call_log,
  public.alert_notification_log,
  public.alliance_wars,
  public.announcement_banners,
  public.announcement_modals,
  public.app_settings,
  public.audit_discrepancies,
  public.audit_discrepancies_archive,
  public.audit_log,
  public.automated_actions_log,
  public.automation_accounts,
  public.automation_generations,
  public.automation_jobs,
  public.bb_boards,
  public.bb_post_reactions,
  public.bb_posts,
  public.bb_pot_claims,
  public.bb_threads,
  public.blog_categories,
  public.blog_contact_messages,
  public.blog_gift_claims,
  public.blog_gift_purchases,
  public.blog_gift_tiers,
  public.blog_moderation_log,
  public.blog_post_bundle_purchases,
  public.blog_post_comments,
  public.blog_post_daily_stats,
  public.blog_post_likes,
  public.blog_post_shares,
  public.blog_post_treasuries,
  public.blog_post_treasury_claims,
  public.blog_post_unlocks,
  public.blog_posts,
  public.blog_subscriptions,
  public.blog_themes,
  public.blogs,
  public.bookmark_entitlements,
  public.bookmark_folders,
  public.bookmarks,
  public.boost_types,
  public.branded_rooms,
  public.business_accounts,
  public.business_page_daily_stats,
  public.business_page_posts,
  public.business_pages,
  public.classroom_daily_stats,
  public.classroom_enrolments,
  public.classroom_events,
  public.classroom_lesson_completions,
  public.classroom_likes,
  public.classroom_member_badges,
  public.classroom_member_points,
  public.classroom_moderators,
  public.classroom_points_ledger,
  public.classroom_post_comments,
  public.classroom_posts,
  public.classroom_quiz_attempts,
  public.classroom_quiz_questions,
  public.classroom_quizzes,
  public.classroom_reports,
  public.classroom_shares,
  public.classroom_slug_history,
  public.coin_ledger,
  public.coin_ledger_archive,
  public.community_note_votes,
  public.community_notes,
  public.content_engagement_signals,
  public.content_hashtags,
  public.content_shares,
  public.content_treasuries,
  public.content_treasury_claims,
  public.conversation_scores,
  public.council_invitations,
  public.creator_bank_accounts,
  public.creator_broadcasts,
  public.creator_crypto_balances,
  public.creator_earnings,
  public.creator_kyc,
  public.creator_payouts,
  public.creator_spotlights,
  public.creator_wallet_addresses,
  public.cron_job_runs,
  public.cron_job_steps,
  public.cron_state,
  public.crypto_balance_ledger,
  public.crypto_exchange_rate_overrides,
  public.crypto_price_cache,
  public.crypto_transfer_claims,
  public.data_export_requests,
  public.dm_conversation_score_milestones,
  public.dm_conversation_unlocks,
  public.dm_conversations,
  public.dm_score_sticker_unlocks,
  public.drop_room_replays,
  public.elder_mentorships,
  public.elder_requests,
  public.failed_commissions,
  public.failed_webhooks,
  public.failed_xp_awards,
  public.feature_flags,
  public.flash_xp_events,
  public.follows,
  public.footer_scripts,
  public.forum_answers,
  public.forum_categories,
  public.forum_favorites,
  public.forum_moderation_log,
  public.forum_questions,
  public.forum_votes,
  public.friendships,
  public.game_best_scores,
  public.game_challenge_rounds,
  public.game_challenges,
  public.game_favorites,
  public.game_milestone_claims,
  public.game_play_milestones,
  public.game_plays,
  public.game_progress_tasks,
  public.game_ratings,
  public.game_saves,
  public.game_score_attestations,
  public.games,
  public.gift_items,
  public.gift_reward_grants,
  public.gift_types,
  public.gifts,
  public.group_chat_blocks,
  public.group_chat_members,
  public.group_chat_reactivation_choices,
  public.group_chats,
  public.guild_alliance_members,
  public.guild_alliances,
  public.guild_applications,
  public.guild_contribution_alerts,
  public.guild_invites,
  public.guild_members,
  public.guild_messages,
  public.guild_quest_contributions,
  public.guild_quests,
  public.guild_rooms,
  public.guild_tier_history,
  public.guild_treasury_ledger,
  public.guild_war_rematch_tokens,
  public.guild_wars,
  public.guilds,
  public.hall_of_fame,
  public.hashtags,
  public.help_ai_requests,
  public.help_categories,
  public.help_docs,
  public.kyc_documents,
  public.kyc_submissions,
  public.leaderboard_rank_snapshots,
  public.leaderboard_snapshots,
  public.learning_certificates,
  public.merch_orders,
  public.merch_product_reviews,
  public.merch_products,
  public.merch_stores,
  public.message_reactions,
  public.messages,
  public.moderation_actions,
  public.moderation_ai_escalations,
  public.moderation_report_reporters,
  public.moderation_reports,
  public.moment_reactions,
  public.moment_views,
  public.moments,
  public.monthly_gift_drops,
  public.nemesis_assignments,
  public.nemesis_challenges,
  public.new_member_quest_dismissals,
  public.new_member_quests,
  public.notices,
  public.notifications,
  public.object_deletion_tasks,
  public.password_reset_tokens,
  public.payment_context_settings,
  public.payments,
  public.payout_dead_letter_queue,
  public.phone_verification_codes,
  public.platform_council_ideas,
  public.platform_council_members,
  public.platform_events,
  public.play_purchase_receipts,
  public.poll_options,
  public.poll_votes,
  public.polls,
  public.portal_follows,
  public.portal_stats_daily,
  public.portals,
  public.profile_themes,
  public.push_tickets,
  public.quest_feature_boosts,
  public.quest_templates,
  public.quiz_attempt_answers,
  public.quiz_attempts,
  public.quiz_question_options,
  public.quiz_questions,
  public.quizzes,
  public.rank_up_events,
  public.rank_up_events_archive,
  public.reaction_set_items,
  public.reaction_sets,
  public.referral_commissions,
  public.referral_visits,
  public.referrals,
  public.refunds,
  public.reports,
  public.restore_email_tasks,
  public.room_member_highlights,
  public.room_members,
  public.room_message_reactions,
  public.room_messages,
  public.room_moderation_log,
  public.room_monthly_active_users,
  public.room_pins,
  public.room_promotions,
  public.room_subscriptions,
  public.room_visits,
  public.rooms,
  public.season_pass_milestones,
  public.season_rank_archives,
  public.seasons,
  public.site_contact_messages,
  public.slug_redirects,
  public.sponsored_leaderboard_banners,
  public.sponsored_quest_applications,
  public.sponsored_quest_events,
  public.sponsored_quests,
  public.staff_alert_contacts,
  public.star_ledger,
  public.star_ledger_archive,
  public.sticker_packs,
  public.stickers,
  public.store_items,
  public.subscription_cancellation_feedback,
  public.subscription_plans,
  public.subscriptions,
  public.support_ticket_events,
  public.support_ticket_messages,
  public.support_tickets,
  public.system_alerts,
  public.tale_account_restrictions,
  public.tale_appeals,
  public.tale_author_subscriptions,
  public.tale_chapters,
  public.tale_comments,
  public.tale_moderation_log,
  public.tale_unlocks,
  public.tale_votes,
  public.tales,
  public.telegram_delivery_queue,
  public.telegram_login_states,
  public.track_milestone_unlocks,
  public.tweet_likes,
  public.tweet_mentions,
  public.tweet_retweets,
  public.tweets,
  public.user_announcement_rotation,
  public.user_badges,
  public.user_banner_views,
  public.user_blocks,
  public.user_cosmetics,
  public.user_crypto_wallets,
  public.user_daily_logins,
  public.user_email_preferences,
  public.user_inactivity_events,
  public.user_interests,
  public.user_messages,
  public.user_modal_views,
  public.user_pins,
  public.user_push_tokens,
  public.user_quest_decks,
  public.user_quest_progress,
  public.user_reaction_sets,
  public.user_season_milestone_claims,
  public.user_season_passes,
  public.user_sticker_packs,
  public.user_subscriptions,
  public.user_titles,
  public.user_xp_boosters,
  public.username_change_history,
  public.username_reservations,
  public.users,
  public.war_contributions,
  public.wiki_collaborators,
  public.wiki_invites,
  public.wiki_moderation_log,
  public.wiki_page_revisions,
  public.wiki_pages,
  public.wikis,
  public.x_manifest,
  public.xp_events,
  public.xp_events_archive,
  public.xp_ledger,
  public.xp_ledger_archive,
  public.zobian_of_month,
  public.coin_ledger_history,
  public.star_ledger_history,
  public.xp_ledger_history
 FROM authenticated;
END IF; END $private$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT USAGE ON SCHEMA public TO service_role;
END IF; END $grant$;

REVOKE ALL ON FUNCTION public.automation_official_name() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.retain_bookmark_entitlement() FROM PUBLIC;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_appeals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_restore_uses TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_type_play_products TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_types TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_ai_escalations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_campaign_daily_stats TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_campaigns TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_coupon_redemptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_coupons TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_creatives TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_placements TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ad_wallet_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_actions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_audit_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_data_import_jobs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_message_receipts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_roles TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_call_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alert_notification_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.alliance_wars TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcement_banners TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcement_modals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_discrepancies TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_discrepancies_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automated_actions_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_accounts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_generations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_jobs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bb_boards TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bb_post_reactions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bb_posts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bb_pot_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bb_threads TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_categories TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_contact_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_gift_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_gift_purchases TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_gift_tiers TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_moderation_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_bundle_purchases TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_comments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_daily_stats TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_likes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_shares TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_treasuries TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_treasury_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_post_unlocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_posts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_subscriptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blog_themes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.blogs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bookmark_entitlements TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bookmark_folders TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bookmarks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.boost_types TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.branded_rooms TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_accounts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_page_daily_stats TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_page_posts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_pages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_daily_stats TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_enrolments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_lesson_completions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_likes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_member_badges TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_member_points TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_moderators TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_points_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_post_comments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_posts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_quiz_attempts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_quiz_questions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_quizzes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_reports TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_shares TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.classroom_slug_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coin_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coin_ledger_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT ON TABLE public.coin_ledger_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_note_votes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.community_notes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_engagement_signals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 GRANT SELECT ON TABLE public.content_hashtags TO anon;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_hashtags TO authenticated;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_hashtags TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_shares TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_treasuries TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_treasury_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversation_scores TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.council_invitations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_bank_accounts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_broadcasts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_crypto_balances TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_earnings TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_kyc TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_payouts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_spotlights TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.creator_wallet_addresses TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cron_job_runs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cron_job_steps TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cron_state TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crypto_balance_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crypto_exchange_rate_overrides TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crypto_price_cache TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crypto_transfer_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_export_requests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dm_conversation_score_milestones TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dm_conversation_unlocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dm_conversations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dm_score_sticker_unlocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.drop_room_replays TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.elder_mentorships TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.elder_requests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.failed_commissions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.failed_webhooks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.failed_xp_awards TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feature_flags TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.flash_xp_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.follows TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.footer_scripts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_answers TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_categories TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_favorites TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_moderation_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_questions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.forum_votes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.friendships TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_best_scores TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_challenge_rounds TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_challenges TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_favorites TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_milestone_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_play_milestones TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_plays TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_progress_tasks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_ratings TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_saves TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.game_score_attestations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.games TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gift_items TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gift_reward_grants TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gift_types TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gifts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.group_chat_blocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.group_chat_members TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.group_chat_reactivation_choices TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.group_chats TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_alliance_members TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_alliances TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_applications TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_contribution_alerts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_invites TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_members TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_quest_contributions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_quests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_rooms TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_tier_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_treasury_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_war_rematch_tokens TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guild_wars TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.guilds TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hall_of_fame TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 GRANT SELECT ON TABLE public.hashtags TO anon;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hashtags TO authenticated;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hashtags TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.help_ai_requests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.help_categories TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.help_docs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kyc_documents TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kyc_submissions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leaderboard_rank_snapshots TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leaderboard_snapshots TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.learning_certificates TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merch_orders TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merch_product_reviews TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merch_products TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merch_stores TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.message_reactions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_actions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_ai_escalations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_report_reporters TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moderation_reports TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moment_reactions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moment_views TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.moments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.monthly_gift_drops TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.nemesis_assignments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.nemesis_challenges TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.new_member_quest_dismissals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.new_member_quests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notices TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.object_deletion_tasks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.password_reset_tokens TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payment_context_settings TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payout_dead_letter_queue TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.phone_verification_codes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_council_ideas TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_council_members TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.play_purchase_receipts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.poll_options TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.poll_votes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.polls TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 GRANT SELECT ON TABLE public.portal_follows TO anon;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_follows TO authenticated;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_follows TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 GRANT SELECT ON TABLE public.portal_stats_daily TO anon;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_stats_daily TO authenticated;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_stats_daily TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 GRANT SELECT ON TABLE public.portals TO anon;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portals TO authenticated;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_themes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.push_tickets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quest_feature_boosts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quest_templates TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quiz_attempt_answers TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quiz_attempts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quiz_question_options TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quiz_questions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quizzes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rank_up_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rank_up_events_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reaction_set_items TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reaction_sets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.referral_commissions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.referral_visits TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.referrals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.refunds TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reports TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.restore_email_tasks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_member_highlights TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_members TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_message_reactions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_moderation_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_monthly_active_users TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_pins TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_promotions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_subscriptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.room_visits TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rooms TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.season_pass_milestones TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.season_rank_archives TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.seasons TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.site_contact_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.slug_redirects TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sponsored_leaderboard_banners TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sponsored_quest_applications TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sponsored_quest_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sponsored_quests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.staff_alert_contacts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.star_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.star_ledger_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT ON TABLE public.star_ledger_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sticker_packs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stickers TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.store_items TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscription_cancellation_feedback TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscription_plans TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscriptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_ticket_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_ticket_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.support_tickets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.system_alerts TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_account_restrictions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_appeals TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_author_subscriptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_chapters TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_comments TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_moderation_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_unlocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tale_votes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tales TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.telegram_delivery_queue TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.telegram_login_states TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.track_milestone_unlocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tweet_likes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tweet_mentions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tweet_retweets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tweets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_announcement_rotation TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_badges TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_banner_views TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_blocks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_cosmetics TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_crypto_wallets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_daily_logins TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_email_preferences TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_inactivity_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_interests TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_messages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_modal_views TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_pins TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_push_tokens TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_quest_decks TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_quest_progress TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_reaction_sets TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_season_milestone_claims TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_season_passes TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_sticker_packs TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_subscriptions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_titles TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_xp_boosters TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.username_change_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.username_reservations TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.war_contributions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wiki_collaborators TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wiki_invites TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wiki_moderation_log TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wiki_page_revisions TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wiki_pages TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.wikis TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.x_manifest TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xp_events TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xp_events_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xp_ledger TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.xp_ledger_archive TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT ON TABLE public.xp_ledger_history TO service_role;
END IF; END $grant$;

DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.zobian_of_month TO service_role;
END IF; END $grant$;

DO $server_grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT USAGE ON SCHEMA public TO service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.account_appeals,
  public.account_restore_uses,
  public.account_type_play_products,
  public.account_types,
  public.ad_ai_escalations,
  public.ad_campaign_daily_stats,
  public.ad_campaigns,
  public.ad_coupon_redemptions,
  public.ad_coupons,
  public.ad_creatives,
  public.ad_events,
  public.ad_placements,
  public.ad_wallet_ledger,
  public.admin_actions,
  public.admin_audit_log,
  public.admin_data_import_jobs,
  public.admin_message_receipts,
  public.admin_messages,
  public.admin_roles,
  public.ai_call_log,
  public.alert_notification_log,
  public.alliance_wars,
  public.announcement_banners,
  public.announcement_modals,
  public.app_settings,
  public.audit_discrepancies,
  public.audit_discrepancies_archive,
  public.audit_log,
  public.automated_actions_log,
  public.automation_accounts,
  public.automation_generations,
  public.automation_jobs,
  public.bb_boards,
  public.bb_post_reactions,
  public.bb_posts,
  public.bb_pot_claims,
  public.bb_threads,
  public.blog_categories,
  public.blog_contact_messages,
  public.blog_gift_claims,
  public.blog_gift_purchases,
  public.blog_gift_tiers,
  public.blog_moderation_log,
  public.blog_post_bundle_purchases,
  public.blog_post_comments,
  public.blog_post_daily_stats,
  public.blog_post_likes,
  public.blog_post_shares,
  public.blog_post_treasuries,
  public.blog_post_treasury_claims,
  public.blog_post_unlocks,
  public.blog_posts,
  public.blog_subscriptions,
  public.blog_themes,
  public.blogs,
  public.bookmark_entitlements,
  public.bookmark_folders,
  public.bookmarks,
  public.boost_types,
  public.branded_rooms,
  public.business_accounts,
  public.business_page_daily_stats,
  public.business_page_posts,
  public.business_pages,
  public.classroom_daily_stats,
  public.classroom_enrolments,
  public.classroom_events,
  public.classroom_lesson_completions,
  public.classroom_likes,
  public.classroom_member_badges,
  public.classroom_member_points,
  public.classroom_moderators,
  public.classroom_points_ledger,
  public.classroom_post_comments,
  public.classroom_posts,
  public.classroom_quiz_attempts,
  public.classroom_quiz_questions,
  public.classroom_quizzes,
  public.classroom_reports,
  public.classroom_shares,
  public.classroom_slug_history,
  public.coin_ledger,
  public.coin_ledger_archive,
  public.community_note_votes,
  public.community_notes,
  public.content_engagement_signals,
  public.content_hashtags,
  public.content_shares,
  public.content_treasuries,
  public.content_treasury_claims,
  public.conversation_scores,
  public.council_invitations,
  public.creator_bank_accounts,
  public.creator_broadcasts,
  public.creator_crypto_balances,
  public.creator_earnings,
  public.creator_kyc,
  public.creator_payouts,
  public.creator_spotlights,
  public.creator_wallet_addresses,
  public.cron_job_runs,
  public.cron_job_steps,
  public.cron_state,
  public.crypto_balance_ledger,
  public.crypto_exchange_rate_overrides,
  public.crypto_price_cache,
  public.crypto_transfer_claims,
  public.data_export_requests,
  public.dm_conversation_score_milestones,
  public.dm_conversation_unlocks,
  public.dm_conversations,
  public.dm_score_sticker_unlocks,
  public.drop_room_replays,
  public.elder_mentorships,
  public.elder_requests,
  public.failed_commissions,
  public.failed_webhooks,
  public.failed_xp_awards,
  public.feature_flags,
  public.flash_xp_events,
  public.follows,
  public.footer_scripts,
  public.forum_answers,
  public.forum_categories,
  public.forum_favorites,
  public.forum_moderation_log,
  public.forum_questions,
  public.forum_votes,
  public.friendships,
  public.game_best_scores,
  public.game_challenge_rounds,
  public.game_challenges,
  public.game_favorites,
  public.game_milestone_claims,
  public.game_play_milestones,
  public.game_plays,
  public.game_progress_tasks,
  public.game_ratings,
  public.game_saves,
  public.game_score_attestations,
  public.games,
  public.gift_items,
  public.gift_reward_grants,
  public.gift_types,
  public.gifts,
  public.group_chat_blocks,
  public.group_chat_members,
  public.group_chat_reactivation_choices,
  public.group_chats,
  public.guild_alliance_members,
  public.guild_alliances,
  public.guild_applications,
  public.guild_contribution_alerts,
  public.guild_invites,
  public.guild_members,
  public.guild_messages,
  public.guild_quest_contributions,
  public.guild_quests,
  public.guild_rooms,
  public.guild_tier_history,
  public.guild_treasury_ledger,
  public.guild_war_rematch_tokens,
  public.guild_wars,
  public.guilds,
  public.hall_of_fame,
  public.hashtags,
  public.help_ai_requests,
  public.help_categories,
  public.help_docs,
  public.kyc_documents,
  public.kyc_submissions,
  public.leaderboard_rank_snapshots,
  public.leaderboard_snapshots,
  public.learning_certificates,
  public.merch_orders,
  public.merch_product_reviews,
  public.merch_products,
  public.merch_stores,
  public.message_reactions,
  public.messages,
  public.moderation_actions,
  public.moderation_ai_escalations,
  public.moderation_report_reporters,
  public.moderation_reports,
  public.moment_reactions,
  public.moment_views,
  public.moments,
  public.monthly_gift_drops,
  public.nemesis_assignments,
  public.nemesis_challenges,
  public.new_member_quest_dismissals,
  public.new_member_quests,
  public.notices,
  public.notifications,
  public.object_deletion_tasks,
  public.password_reset_tokens,
  public.payment_context_settings,
  public.payments,
  public.payout_dead_letter_queue,
  public.phone_verification_codes,
  public.platform_council_ideas,
  public.platform_council_members,
  public.platform_events,
  public.play_purchase_receipts,
  public.poll_options,
  public.poll_votes,
  public.polls,
  public.portal_follows,
  public.portal_stats_daily,
  public.portals,
  public.profile_themes,
  public.push_tickets,
  public.quest_feature_boosts,
  public.quest_templates,
  public.quiz_attempt_answers,
  public.quiz_attempts,
  public.quiz_question_options,
  public.quiz_questions,
  public.quizzes,
  public.rank_up_events,
  public.rank_up_events_archive,
  public.reaction_set_items,
  public.reaction_sets,
  public.referral_commissions,
  public.referral_visits,
  public.referrals,
  public.refunds,
  public.reports,
  public.restore_email_tasks,
  public.room_member_highlights,
  public.room_members,
  public.room_message_reactions,
  public.room_messages,
  public.room_moderation_log,
  public.room_monthly_active_users,
  public.room_pins,
  public.room_promotions,
  public.room_subscriptions,
  public.room_visits,
  public.rooms,
  public.season_pass_milestones,
  public.season_rank_archives,
  public.seasons,
  public.site_contact_messages,
  public.slug_redirects,
  public.sponsored_leaderboard_banners,
  public.sponsored_quest_applications,
  public.sponsored_quest_events,
  public.sponsored_quests,
  public.staff_alert_contacts,
  public.star_ledger,
  public.star_ledger_archive,
  public.sticker_packs,
  public.stickers,
  public.store_items,
  public.subscription_cancellation_feedback,
  public.subscription_plans,
  public.subscriptions,
  public.support_ticket_events,
  public.support_ticket_messages,
  public.support_tickets,
  public.system_alerts,
  public.tale_account_restrictions,
  public.tale_appeals,
  public.tale_author_subscriptions,
  public.tale_chapters,
  public.tale_comments,
  public.tale_moderation_log,
  public.tale_unlocks,
  public.tale_votes,
  public.tales,
  public.telegram_delivery_queue,
  public.telegram_login_states,
  public.track_milestone_unlocks,
  public.tweet_likes,
  public.tweet_mentions,
  public.tweet_retweets,
  public.tweets,
  public.user_announcement_rotation,
  public.user_badges,
  public.user_banner_views,
  public.user_blocks,
  public.user_cosmetics,
  public.user_crypto_wallets,
  public.user_daily_logins,
  public.user_email_preferences,
  public.user_inactivity_events,
  public.user_interests,
  public.user_messages,
  public.user_modal_views,
  public.user_pins,
  public.user_push_tokens,
  public.user_quest_decks,
  public.user_quest_progress,
  public.user_reaction_sets,
  public.user_season_milestone_claims,
  public.user_season_passes,
  public.user_sticker_packs,
  public.user_subscriptions,
  public.user_titles,
  public.user_xp_boosters,
  public.username_change_history,
  public.username_reservations,
  public.users,
  public.war_contributions,
  public.wiki_collaborators,
  public.wiki_invites,
  public.wiki_moderation_log,
  public.wiki_page_revisions,
  public.wiki_pages,
  public.wikis,
  public.x_manifest,
  public.xp_events,
  public.xp_events_archive,
  public.xp_ledger,
  public.xp_ledger_archive,
  public.zobian_of_month,
  public.coin_ledger_history,
  public.star_ledger_history,
  public.xp_ledger_history
  TO service_role;
 END IF;
END
$server_grants$;

-- Private outbox records never belong to the client Data API.
REVOKE ALL ON public.transactional_tasks FROM PUBLIC;
DO $task_grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.transactional_tasks FROM anon'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON public.transactional_tasks FROM authenticated'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON public.transactional_tasks TO service_role'; END IF;
END
$task_grants$;

COMMIT;
