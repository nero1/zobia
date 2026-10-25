-- Recovery ONLY after intentionally deleting all public application tables.
-- Run in the provider's SQL editor, then run the complete consolidated baseline.
-- Never use this as an upgrade or against an installed application.
BEGIN;
DO $empty_schema$
BEGIN
 IF EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
       WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
     )
 ) THEN
   RAISE EXCEPTION 'Cleanup refused: public still contains application tables, views or sequences. Use the existing-database upgrade instructions instead; no functions were removed.';
 END IF;
END
$empty_schema$;

-- Exact application-owned signatures only. No CASCADE: remaining dependencies
-- abort and roll back the complete cleanup instead of deleting other objects.
DROP FUNCTION IF EXISTS public.app_group_member(uuid);
DROP FUNCTION IF EXISTS public.app_guild_member(uuid);
DROP FUNCTION IF EXISTS public.automation_official_name();
DROP FUNCTION IF EXISTS public.help_docs_search_vector_update();
DROP FUNCTION IF EXISTS public.immutable_account_product_base();
DROP FUNCTION IF EXISTS public.retain_bookmark_entitlement();
DROP FUNCTION IF EXISTS public.system_alerts_default_priority();
DROP FUNCTION IF EXISTS public.validate_account_product();
COMMIT;
