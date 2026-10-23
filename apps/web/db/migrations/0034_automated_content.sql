BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS automation_accounts (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS automation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES automation_accounts(user_id),
 name text NOT NULL, target_type text NOT NULL CHECK(target_type IN ('forum','wiki','blog','room')),target_id uuid NOT NULL,
 instructions text NOT NULL DEFAULT '',providers jsonb NOT NULL DEFAULT '[]'::jsonb,
 interval_hours integer NOT NULL DEFAULT 24 CHECK(interval_hours BETWEEN 1 AND 8760),
 publication_mode text NOT NULL DEFAULT 'review' CHECK(publication_mode IN ('review','auto')),
 enabled boolean NOT NULL DEFAULT false,next_run_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,lease_until timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_jobs_due_idx ON automation_jobs(next_run_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS automation_generations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES automation_jobs(id) ON DELETE SET NULL,
 account_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,target_type text NOT NULL,target_id uuid NOT NULL,
 title text NOT NULL,body text NOT NULL,normalized text NOT NULL,fingerprint text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','published','rejected')),
 review_reason text NOT NULL,provider text NOT NULL,published_content_id uuid,published_url text,
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz
);
CREATE INDEX IF NOT EXISTS automation_generations_similarity_idx ON automation_generations USING gin(normalized gin_trgm_ops);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['automation_accounts','automation_jobs','automation_generations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO service_role',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION automation_official_name() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM automation_accounts WHERE user_id=NEW.id) THEN
   NEW.display_name := regexp_replace(COALESCE(NEW.display_name,NEW.username),'( Ⓩ)+$','') || ' Ⓩ';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION automation_official_name() FROM PUBLIC;
CREATE TRIGGER automation_official_name BEFORE UPDATE OF display_name ON users FOR EACH ROW EXECUTE FUNCTION automation_official_name();
COMMIT;
