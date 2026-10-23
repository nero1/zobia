BEGIN;
CREATE TABLE IF NOT EXISTS bookmark_entitlements (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 included_limit integer NOT NULL DEFAULT 0 CHECK (included_limit >= 0),
 purchased_slots integer NOT NULL DEFAULT 0 CHECK (purchased_slots >= 0)
);
CREATE TABLE IF NOT EXISTS bookmark_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bookmark_folders_name_idx ON bookmark_folders(user_id, lower(name));
CREATE TABLE IF NOT EXISTS bookmarks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 folder_id uuid REFERENCES bookmark_folders(id) ON DELETE SET NULL,
 content_type text NOT NULL, content_id uuid NOT NULL, title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,content_type,content_id)
);
CREATE INDEX IF NOT EXISTS bookmarks_user_created_idx ON bookmarks(user_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS bookmarks_folder_idx ON bookmarks(user_id,folder_id);
ALTER TABLE bookmark_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmark_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bookmark_entitlements, bookmark_folders, bookmarks FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON bookmark_entitlements, bookmark_folders, bookmarks TO service_role;
INSERT INTO x_manifest(key,value,description) VALUES
 ('bookmark_folders_plus','5','Permanently unlocked bookmark folder slots on Plus.'),
 ('bookmark_folders_pro','15','Permanently unlocked bookmark folder slots on Pro.'),
 ('bookmark_folders_max','30','Permanently unlocked bookmark folder slots on Max.'),
 ('bookmark_folders_business','30','Permanently unlocked bookmark folder slots for Business accounts.'),
 ('bookmark_folder_first_cost','100','Credits for the first purchased bookmark folder slot.'),
 ('bookmark_folder_extra_cost','50','Credits for each subsequent purchased bookmark folder slot.')
ON CONFLICT(key) DO NOTHING;
-- Capture upgrades at the account transition, even if Bookmarks is never opened.
CREATE OR REPLACE FUNCTION retain_bookmark_entitlement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
END $$;
REVOKE ALL ON FUNCTION retain_bookmark_entitlement() FROM PUBLIC;
DROP TRIGGER IF EXISTS users_bookmark_entitlement ON users;
CREATE TRIGGER users_bookmark_entitlement AFTER INSERT OR UPDATE OF plan ON users FOR EACH ROW EXECUTE FUNCTION retain_bookmark_entitlement();
DROP TRIGGER IF EXISTS business_bookmark_entitlement ON business_accounts;
CREATE TRIGGER business_bookmark_entitlement AFTER INSERT OR UPDATE OF status,tier ON business_accounts FOR EACH ROW EXECUTE FUNCTION retain_bookmark_entitlement();
-- Reuse the same configurable entitlement rules for pre-existing accounts.
UPDATE users SET plan=plan WHERE plan IN ('plus','pro','max');
UPDATE business_accounts SET status=status WHERE status IN ('active','grace');
COMMIT;
