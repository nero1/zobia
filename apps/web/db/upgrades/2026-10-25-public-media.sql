BEGIN;
CREATE TABLE public.public_media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 storage_key text NOT NULL UNIQUE,
 public_url text NOT NULL UNIQUE,
 size_bytes bigint NOT NULL CHECK(size_bytes>0),
 content_type text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting')),
 unreferenced_at timestamptz DEFAULT NOW(),
 created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX public_media_assets_user_idx ON public.public_media_assets(user_id,created_at);
CREATE INDEX public_media_assets_cleanup_idx ON public.public_media_assets(unreferenced_at,created_at);
CREATE TABLE public.public_media_references (
 asset_id uuid NOT NULL REFERENCES public.public_media_assets(id) ON DELETE CASCADE,
 entity_table text NOT NULL,
 entity_id uuid NOT NULL,
 expires_at timestamptz,
 PRIMARY KEY(asset_id,entity_table,entity_id)
);
CREATE INDEX public_media_references_entity_idx ON public.public_media_references(entity_table,entity_id);
CREATE INDEX public_media_references_expiry_idx ON public.public_media_references(expires_at) WHERE expires_at IS NOT NULL;
ALTER TABLE public.public_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.public_media_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_media_references FORCE ROW LEVEL SECURITY;
CREATE POLICY public_media_assets_server ON public.public_media_assets USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
CREATE POLICY public_media_references_server ON public.public_media_references USING(current_setting('app.is_system',true)='true') WITH CHECK(current_setting('app.is_system',true)='true');
CREATE OR REPLACE FUNCTION public.app_track_public_media() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE
 payload jsonb;
 entity uuid;
 urls text[];
 prior uuid[];
 asset record;
 expiry timestamptz;
BEGIN
 IF TG_TABLE_NAME='users' AND TG_OP='UPDATE' THEN
  IF NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
 END IF;
 entity=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 payload=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 IF payload->>'deleted_at' IS NOT NULL THEN payload='{}'::jsonb; END IF;
 IF TG_TABLE_NAME='moments' THEN expiry=(payload->>'expires_at')::timestamptz; END IF;
 -- Exact JSON scalar URLs and URLs embedded in HTML/Markdown are indexed
 -- against known managed objects. External URLs create no registry entries.
 SELECT array_agg(DISTINCT url) INTO urls FROM (
  SELECT value #>> '{}' AS url FROM jsonb_path_query(payload,'$.** ? (@.type() == "string")') value
  UNION
  SELECT match[1] FROM jsonb_path_query(payload,'$.** ? (@.type() == "string")') value,
   LATERAL regexp_matches(value #>> '{}','https?://[A-Za-z0-9._~:/?#@!$&*+,;=%-]+','g') AS match
 ) found;
 SELECT array_agg(asset_id) INTO prior FROM public.public_media_references WHERE entity_table=TG_TABLE_NAME AND entity_id=entity;
 -- Serialize attachment/detachment with deletion claims in a stable order.
 FOR asset IN SELECT id,state,public_url FROM public.public_media_assets
  WHERE id=ANY(COALESCE(prior,'{}'::uuid[])) OR public_url=ANY(COALESCE(urls,'{}'::text[])) ORDER BY id FOR UPDATE
 LOOP
  IF asset.public_url=ANY(COALESCE(urls,'{}'::text[])) THEN
   IF asset.state<>'ready' THEN RAISE EXCEPTION 'Media is unavailable; upload it again' USING ERRCODE='23514',CONSTRAINT='public_media_not_ready'; END IF;
   INSERT INTO public.public_media_references(asset_id,entity_table,entity_id,expires_at) VALUES(asset.id,TG_TABLE_NAME,entity,expiry)
    ON CONFLICT(asset_id,entity_table,entity_id) DO UPDATE SET expires_at=EXCLUDED.expires_at;
   UPDATE public.public_media_assets SET unreferenced_at=NULL WHERE id=asset.id;
  ELSE
   DELETE FROM public.public_media_references WHERE asset_id=asset.id AND entity_table=TG_TABLE_NAME AND entity_id=entity;
   UPDATE public.public_media_assets SET unreferenced_at=COALESCE(unreferenced_at,NOW()) WHERE id=asset.id
    AND NOT EXISTS(SELECT 1 FROM public.public_media_references WHERE asset_id=asset.id);
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.app_track_public_media() FROM PUBLIC;
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.tweets FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.moments FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.tales FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.bb_threads FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.bb_posts FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
CREATE TRIGGER track_public_media AFTER INSERT OR UPDATE OR DELETE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.app_track_public_media();
REVOKE ALL ON public.public_media_assets,public.public_media_references FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.public_media_assets,public.public_media_references FROM anon'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON public.public_media_assets,public.public_media_references FROM authenticated'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON public.public_media_assets,public.public_media_references TO service_role'; END IF;
END
$grants$;
COMMIT;
