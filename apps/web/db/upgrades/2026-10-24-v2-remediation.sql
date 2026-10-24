BEGIN;
ALTER TABLE public.users ADD COLUMN session_valid_after timestamptz NOT NULL DEFAULT '1970-01-01 00:00:00+00';
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
-- Private outbox records never belong to the client Data API.
REVOKE ALL ON public.transactional_tasks FROM PUBLIC;
DO $task_grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.transactional_tasks FROM anon'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON public.transactional_tasks FROM authenticated'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON public.transactional_tasks TO service_role'; END IF;
END
$task_grants$;


ALTER TABLE public.creator_payouts ADD COLUMN reservation_version integer NOT NULL DEFAULT 0 CHECK(reservation_version>=0);
ALTER TABLE public.user_push_tokens ADD COLUMN ownership_key varchar(64);
UPDATE public.user_push_tokens SET ownership_key=encode(sha256(convert_to(CASE WHEN platform='web' THEN 'web:'||(token::jsonb->>'endpoint') ELSE 'native:'||token END,'UTF8')),'hex');
DELETE FROM public.user_push_tokens WHERE id IN (SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY ownership_key ORDER BY updated_at DESC NULLS LAST,id DESC) rank FROM public.user_push_tokens) duplicates WHERE rank>1);
ALTER TABLE public.user_push_tokens ALTER COLUMN ownership_key SET NOT NULL;
CREATE UNIQUE INDEX user_push_tokens_ownership_key_unique ON public.user_push_tokens(ownership_key);
CREATE UNIQUE INDEX creator_payouts_crypto_transfer_unique ON public.creator_payouts(crypto_chain,crypto_tx_hash) WHERE crypto_tx_hash IS NOT NULL;
DROP INDEX IF EXISTS public.notifications_type_null_ref_unique;
ALTER TABLE public.payments DROP CONSTRAINT payments_payment_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check CHECK(payment_type IN ('coin_purchase','star_purchase','subscription','season_pass','booster_pack','room_entry','room_subscription','business_upgrade','merch_purchase'));
UPDATE public.creator_payouts SET status='awaiting_approval' WHERE payout_method='crypto' AND crypto_amount_base_units IS NOT NULL AND status='pending' AND requires_manual_approval;

ALTER TABLE public.sponsored_quests ALTER COLUMN spent_credits TYPE numeric(18,6);
ALTER TABLE public.sponsored_quest_events ALTER COLUMN cost_credits TYPE numeric(18,6);
ALTER TABLE public.sponsored_quests ALTER COLUMN total_budget_credits TYPE numeric(18,6);
ALTER TABLE public.sponsored_quests ALTER COLUMN daily_budget_credits TYPE numeric(18,6);
UPDATE public.merch_orders AS o SET
 store_id=COALESCE(o.store_id,p.store_id),creator_id=COALESCE(o.creator_id,s.creator_id),
 amount_kobo=COALESCE(o.amount_kobo,o.price_kobo),price_kobo=COALESCE(o.price_kobo,o.amount_kobo),
 creator_share_kobo=COALESCE(o.creator_share_kobo,o.creator_net_kobo),creator_net_kobo=COALESCE(o.creator_net_kobo,o.creator_share_kobo)
 FROM public.merch_products p JOIN public.merch_stores s ON s.id=p.store_id WHERE o.product_id=p.id;
ALTER TABLE public.merch_orders DROP CONSTRAINT merch_orders_status_check;
ALTER TABLE public.merch_orders ADD CONSTRAINT merch_orders_status_check CHECK(status IN ('awaiting_payment','pending','shipped','in_transit','delivered','completed','refunded'));
-- Keep the canonical account referrer first; unqualified stray claims cannot
-- become new future rewards. Historical paid rewards are never silently debited.
INSERT INTO public.referrals(referrer_id,referred_id,tier)
 SELECT u.referred_by,u.id,1 FROM public.users u JOIN public.users parent ON parent.id=u.referred_by
 WHERE u.referred_by IS NOT NULL AND u.referred_by<>u.id
 ON CONFLICT(referrer_id,referred_id) DO UPDATE SET tier=1;
WITH ranked AS (
 SELECT r.id,ROW_NUMBER() OVER(PARTITION BY r.referred_id ORDER BY (r.referrer_id=u.referred_by) DESC NULLS LAST,r.created_at,r.id) position
 FROM public.referrals r JOIN public.users u ON u.id=r.referred_id WHERE r.tier=1
), quarantined AS (
 INSERT INTO public.transactional_tasks(kind,operation_key,user_id,payload,status,last_error)
 SELECT 'referral_reconciliation','legacy-claim:'||r.id::text,r.referred_id,to_jsonb(r),'dead','LegacyDuplicateReferralClaim'
 FROM public.referrals r JOIN ranked d ON d.id=r.id AND d.position>1
 ON CONFLICT(kind,operation_key) DO NOTHING
) DELETE FROM public.referrals r USING ranked d WHERE r.id=d.id AND d.position>1;
UPDATE public.users u SET referred_by=r.referrer_id FROM public.referrals r WHERE r.referred_id=u.id AND r.tier=1 AND u.referred_by IS NULL;
CREATE UNIQUE INDEX referrals_one_direct_referrer ON public.referrals(referred_id) WHERE tier=1;
COMMIT;
