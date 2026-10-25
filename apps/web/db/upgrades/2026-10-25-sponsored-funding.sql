BEGIN;
CREATE TABLE public.sponsored_quest_funding (
 quest_id uuid PRIMARY KEY REFERENCES public.sponsored_quests(id) ON DELETE RESTRICT,
 payer_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 reserved_coins bigint NOT NULL CHECK(reserved_coins>=0),
 refunded_coins bigint NOT NULL DEFAULT 0 CHECK(refunded_coins>=0 AND refunded_coins<=reserved_coins),
 marketing_balance_micros bigint NOT NULL CHECK(marketing_balance_micros>=0),
 application_balance_coins bigint NOT NULL CHECK(application_balance_coins>=0),
 marketing_closed boolean NOT NULL DEFAULT false,
 applications_closed boolean NOT NULL DEFAULT false,
 rounding_micros bigint NOT NULL DEFAULT 0 CHECK(rounding_micros>=0 AND rounding_micros<1000000),
 created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE public.sponsored_daily_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quest_id uuid NOT NULL REFERENCES public.sponsored_quest_funding(quest_id) ON DELETE RESTRICT,
 user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 assigned_date date NOT NULL,
 reward_coins bigint NOT NULL CHECK(reward_coins>=0),
 impression_micros bigint NOT NULL CHECK(impression_micros>0),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','paid','released')),
 created_at timestamptz NOT NULL DEFAULT NOW(),
 UNIQUE(quest_id,user_id,assigned_date)
);
CREATE INDEX sponsored_daily_reservations_expiry_idx ON public.sponsored_daily_reservations(assigned_date,quest_id) WHERE state='reserved';
ALTER TABLE public.sponsored_quest_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsored_quest_funding FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sponsored_daily_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsored_daily_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY sponsored_quest_funding_server ON public.sponsored_quest_funding USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
CREATE POLICY sponsored_daily_reservations_server ON public.sponsored_daily_reservations USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
REVOKE ALL ON public.sponsored_quest_funding,public.sponsored_daily_reservations FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sponsored_quest_funding,public.sponsored_daily_reservations FROM anon'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON public.sponsored_quest_funding,public.sponsored_daily_reservations FROM authenticated'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON public.sponsored_quest_funding,public.sponsored_daily_reservations TO service_role'; END IF;
END
$grants$;
-- Existing declarations are not proof of payment. Never debit an old advertiser
-- silently; keep historical work and counters, but require explicit funding.
UPDATE public.sponsored_quests SET is_active=false,auto_paused=true,pause_reason='funding_required' WHERE deleted_at IS NULL;
UPDATE public.quest_templates SET is_active=false WHERE sponsored_quest_id IS NOT NULL;
COMMIT;
