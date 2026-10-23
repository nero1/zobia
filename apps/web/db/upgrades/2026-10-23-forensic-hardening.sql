BEGIN;
-- Server-side verification secrets must never be reachable via a client API role.
ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_verification_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY phone_codes_system ON public.phone_verification_codes USING (current_setting('app.is_system',true)='true') WITH CHECK (current_setting('app.is_system',true)='true');
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.phone_verification_codes FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.phone_verification_codes FROM authenticated; END IF;
END $$;
ALTER TABLE public.payments ADD COLUMN sender_address text;
-- Preserve legacy ambiguity for operator reconciliation instead of silently crediting it.
UPDATE payments SET provider_reference=idempotency_key WHERE provider='crypto' AND provider_reference IS NULL;
UPDATE payments SET status='failed' WHERE provider='crypto' AND tx_hash IS NOT NULL AND status='pending';
CREATE TABLE crypto_transfer_claims(chain text NOT NULL, tx_hash text NOT NULL, payment_id uuid NOT NULL UNIQUE REFERENCES payments(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chain,tx_hash));
INSERT INTO crypto_transfer_claims(chain,tx_hash,payment_id) SELECT DISTINCT ON(chain,CASE WHEN chain='bsc' THEN lower(tx_hash) ELSE tx_hash END) chain,CASE WHEN chain='bsc' THEN lower(tx_hash) ELSE tx_hash END,id FROM payments WHERE provider='crypto' AND chain IS NOT NULL AND tx_hash IS NOT NULL ORDER BY chain,CASE WHEN chain='bsc' THEN lower(tx_hash) ELSE tx_hash END,created_at,id ON CONFLICT DO NOTHING;
ALTER TABLE crypto_transfer_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY crypto_claims_system ON crypto_transfer_claims USING(current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON crypto_transfer_claims TO service_role; END IF; END $$;
ALTER TABLE payments DROP CONSTRAINT payments_payment_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check CHECK(payment_type IN ('coin_purchase','star_purchase','subscription','season_pass','booster_pack','room_entry','room_subscription','business_upgrade'));
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK(status IN ('pending','processing','completed','failed','refunded','cancelled','underpaid'));
ALTER TABLE push_tickets ADD COLUMN token text;
ALTER TABLE telegram_login_states ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '5 minutes');
ALTER TABLE guilds ADD COLUMN below_minimum_days integer NOT NULL DEFAULT 0;
ALTER TABLE guild_wars ADD COLUMN resolved_at timestamptz;
ALTER TABLE guild_alliances ADD COLUMN wars_drawn integer NOT NULL DEFAULT 0;
ALTER TABLE seasons ADD COLUMN status text NOT NULL DEFAULT 'active';
UPDATE seasons SET status='ended' WHERE ends_at <= now();
ALTER TABLE store_items ADD COLUMN slug text;
ALTER TABLE sponsored_quests ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE failed_webhooks ADD COLUMN max_attempts integer NOT NULL DEFAULT 5;
CREATE TABLE account_restore_uses(jti text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE account_restore_uses ENABLE ROW LEVEL SECURITY;
CREATE POLICY restore_uses_system ON account_restore_uses USING (current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON account_restore_uses TO service_role; END IF; END $$;
ALTER TABLE failed_webhooks ADD COLUMN event_key text UNIQUE;
ALTER TABLE failed_webhooks ADD COLUMN processing_token uuid;
CREATE INDEX failed_webhooks_due_idx ON failed_webhooks(next_retry_at,created_at) WHERE resolved_at IS NULL;
-- The server pool is an explicit system principal. Browser roles have no private grants.
DO $policies$ DECLARE r record; q record; BEGIN
 FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity AND c.relkind='r' LOOP
   EXECUTE format('CREATE POLICY app_server_access ON public.%I USING (current_setting(''app.is_system'',true)=''true'') WITH CHECK (current_setting(''app.is_system'',true)=''true'')',r.relname);
 END LOOP;
 FOR q IN SELECT c.relname,p.polname,pg_get_expr(p.polqual,p.polrelid) expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT p.polpermissive LOOP
   EXECUTE format('ALTER POLICY %I ON public.%I USING (current_setting(''app.is_system'',true)=''true'' OR (%s))',q.polname,q.relname,q.expression);
 END LOOP;
END $policies$;
CREATE FUNCTION app_group_member(group_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT FROM public.group_chat_members WHERE group_chat_id=group_id AND user_id::text=current_setting('app.current_user_id',true)) $$;
CREATE FUNCTION app_guild_member(target_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT EXISTS(SELECT FROM public.guild_members WHERE guild_id=target_id AND user_id::text=current_setting('app.current_user_id',true) AND left_at IS NULL) $$;
ALTER POLICY group_chat_members_select ON group_chat_members USING (app_group_member(group_chat_id));
ALTER POLICY guild_members_select ON guild_members USING (user_id::text=current_setting('app.current_user_id',true) OR app_guild_member(guild_id));
-- Compatibility with transaction-scoped identity on either spelling.
ALTER POLICY kyc_documents_self_or_admin ON kyc_documents USING(user_id::text=COALESCE(NULLIF(current_setting('app.user_id',true),''),NULLIF(current_setting('app.current_user_id',true),'')) OR current_setting('app.is_admin',true)='true' OR current_setting('app.is_system',true)='true');
ALTER POLICY kyc_submissions_self_or_admin ON kyc_submissions USING(user_id::text=COALESCE(NULLIF(current_setting('app.user_id',true),''),NULLIF(current_setting('app.current_user_id',true),'')) OR current_setting('app.is_admin',true)='true' OR current_setting('app.is_system',true)='true');
ALTER TABLE users ADD COLUMN contact_discovery_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN contact_discovery_consented_at timestamptz;
ALTER TABLE public.xp_ledger_archive ALTER COLUMN amount TYPE bigint;
ALTER TABLE public.xp_ledger_archive ALTER COLUMN base_amount TYPE bigint;

-- Accounting readers must include immutable archived history in the same snapshot.
CREATE VIEW public.coin_ledger_history WITH (security_invoker=true) AS
 SELECT id,user_id,amount FROM public.coin_ledger UNION ALL SELECT id,user_id,amount FROM public.coin_ledger_archive;
CREATE VIEW public.star_ledger_history WITH (security_invoker=true) AS
 SELECT id,user_id,amount FROM public.star_ledger UNION ALL SELECT id,user_id,amount FROM public.star_ledger_archive;
CREATE VIEW public.xp_ledger_history WITH (security_invoker=true) AS
 SELECT id,user_id,amount FROM public.xp_ledger UNION ALL SELECT id,user_id,amount FROM public.xp_ledger_archive;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT SELECT ON public.coin_ledger_history, public.star_ledger_history, public.xp_ledger_history TO service_role;
END IF; END $$;
ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS upload_state text NOT NULL DEFAULT 'ready' CHECK(upload_state IN ('uploading','ready'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS purged_at timestamptz;
CREATE TABLE public.object_deletion_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), storage_key text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_deletion_due ON public.object_deletion_tasks(available_at) WHERE attempts<10;
ALTER TABLE public.object_deletion_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY object_deletion_server ON public.object_deletion_tasks USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.object_deletion_tasks TO service_role; END IF; END $$;
CREATE TABLE public.restore_email_tasks (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,delivered_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.restore_email_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY restore_mail_server ON public.restore_email_tasks USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.restore_email_tasks TO service_role; END IF; END $$;
CREATE TABLE public.cron_job_runs(job_key text NOT NULL,run_date date NOT NULL,lease_token uuid NOT NULL,lease_until timestamptz NOT NULL,completed_at timestamptz,PRIMARY KEY(job_key,run_date));
CREATE TABLE public.cron_job_steps(job_key text NOT NULL,run_date date NOT NULL,step text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_key,run_date,step),FOREIGN KEY(job_key,run_date) REFERENCES public.cron_job_runs(job_key,run_date) ON DELETE CASCADE);
ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_job_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY cron_run_server ON public.cron_job_runs USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
CREATE POLICY cron_step_server ON public.cron_job_steps USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.cron_job_runs,public.cron_job_steps TO service_role; END IF; END $$;
ALTER TABLE public.games ADD COLUMN score_verification text NOT NULL DEFAULT 'practice' CHECK(score_verification IN ('practice','server'));
CREATE TABLE public.game_score_attestations(play_id uuid PRIMARY KEY REFERENCES public.game_plays(id) ON DELETE CASCADE,score bigint NOT NULL CHECK(score>=0),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.game_progress_tasks(play_id uuid PRIMARY KEY REFERENCES public.game_plays(id) ON DELETE CASCADE,attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,completed_at timestamptz);
ALTER TABLE public.game_score_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_progress_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY game_attestation_server ON public.game_score_attestations USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
CREATE POLICY game_progress_server ON public.game_progress_tasks USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON public.game_score_attestations,public.game_progress_tasks TO service_role; END IF; END $$;
-- Align numeric contracts; do not silently coerce ambiguous legacy tiers.
ALTER TABLE public.referral_commissions ALTER COLUMN tier DROP DEFAULT;
ALTER TABLE public.referral_commissions ALTER COLUMN tier TYPE integer USING tier::integer;
ALTER TABLE public.referral_commissions ALTER COLUMN tier SET DEFAULT 1;
-- Keep operational queues private even under inherited Data API default grants.
REVOKE ALL ON crypto_transfer_claims,account_restore_uses,object_deletion_tasks,restore_email_tasks,cron_job_runs,cron_job_steps,game_score_attestations,game_progress_tasks FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON crypto_transfer_claims,account_restore_uses,object_deletion_tasks,restore_email_tasks,cron_job_runs,cron_job_steps,game_score_attestations,game_progress_tasks FROM %I',r); END IF; END LOOP; END $$;

-- Revoke retained inline exports; only newly signed streaming downloads are supported.
UPDATE data_export_requests SET download_url=NULL,expires_at=LEAST(COALESCE(expires_at,NOW()),NOW()) WHERE download_url LIKE 'data:%';
COMMIT;
