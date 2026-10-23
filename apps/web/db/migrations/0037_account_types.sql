BEGIN;
CREATE TABLE account_types (
 slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,47}$'),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 description text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK (kind IN ('personal','business')),
 base_plan text NOT NULL,
 monthly_price_kobo bigint NOT NULL CHECK (monthly_price_kobo BETWEEN 0 AND 100000000000),
 annual_price_kobo bigint NOT NULL CHECK (annual_price_kobo BETWEEN 0 AND 1200000000000),
 play_monthly_product_id text UNIQUE, play_annual_product_id text UNIQUE,
 is_active boolean NOT NULL DEFAULT true,
 built_in boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='personal' AND base_plan IN ('free','plus','pro','max')) OR (kind='business' AND base_plan IN ('starter','growth','enterprise'))),
 CHECK (base_plan <> 'free' OR (monthly_price_kobo=0 AND annual_price_kobo=0))
);
INSERT INTO account_types(slug,name,kind,base_plan,monthly_price_kobo,annual_price_kobo,built_in)
 SELECT p,initcap(p),'personal',p,
 COALESCE((SELECT price_kobo FROM subscription_plans WHERE plan=p AND interval='monthly'),0),
 COALESCE((SELECT price_kobo FROM subscription_plans WHERE plan=p AND interval='annual'),0),true
 FROM unnest(ARRAY['free','plus','pro','max']) p;
INSERT INTO account_types(slug,name,kind,base_plan,monthly_price_kobo,annual_price_kobo,built_in)
 SELECT 'business_'||p,'Business '||initcap(p),'business',p,price,price*10,true FROM (
 SELECT p,COALESCE((SELECT CASE WHEN value ~ '^[0-9]{1,11}$' THEN value::bigint END FROM x_manifest WHERE key='business_'||p||'_price_kobo'),default_price) price
 FROM (VALUES ('starter',500000::bigint),('growth',1500000),('enterprise',5000000)) defaults(p,default_price)) priced;
UPDATE account_types SET play_monthly_product_id='sub_'||slug||'_monthly',play_annual_product_id='sub_'||slug||'_annual' WHERE kind='personal' AND slug<>'free';
UPDATE account_types SET play_monthly_product_id='biz_'||base_plan||'_monthly' WHERE kind='business';
-- Keep historical SKU mappings so removing a product from sale never breaks
-- restore or makes a paid token activate a different entitlement later.
CREATE TABLE account_type_play_products (
 product_id text PRIMARY KEY,
 account_type_slug text NOT NULL REFERENCES account_types(slug),
 interval text NOT NULL CHECK(interval IN ('monthly','annual')),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO account_type_play_products(product_id,account_type_slug,interval)
 SELECT play_monthly_product_id,slug,'monthly' FROM account_types WHERE play_monthly_product_id IS NOT NULL
 UNION ALL SELECT play_annual_product_id,slug,'annual' FROM account_types WHERE play_annual_product_id IS NOT NULL;
ALTER TABLE account_type_play_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_type_play_products FROM PUBLIC;
ALTER TABLE users ADD COLUMN account_type_slug text REFERENCES account_types(slug);
ALTER TABLE subscriptions ADD COLUMN account_type_slug text REFERENCES account_types(slug);
ALTER TABLE business_accounts ADD COLUMN account_type_slug text REFERENCES account_types(slug),
 ADD COLUMN pending_account_type_slug text REFERENCES account_types(slug),
 ADD COLUMN downgrade_account_type_slug text REFERENCES account_types(slug);
-- Tier checks remain in force. Product identity is deliberately separate.
CREATE FUNCTION validate_account_product() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
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
CREATE TRIGGER users_account_product BEFORE INSERT OR UPDATE OF plan,account_type_slug ON users FOR EACH ROW EXECUTE FUNCTION validate_account_product();
CREATE TRIGGER subscriptions_account_product BEFORE INSERT OR UPDATE OF plan,account_type_slug ON subscriptions FOR EACH ROW EXECUTE FUNCTION validate_account_product();
CREATE TRIGGER business_account_product BEFORE INSERT OR UPDATE OF tier,account_type_slug ON business_accounts FOR EACH ROW EXECUTE FUNCTION validate_account_product();
CREATE FUNCTION immutable_account_product_base() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (NEW.slug,NEW.kind,NEW.base_plan,NEW.built_in) IS DISTINCT FROM (OLD.slug,OLD.kind,OLD.base_plan,OLD.built_in) THEN
  RAISE EXCEPTION 'Product identity and entitlement tier cannot be changed; create another account type';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_account_product_base BEFORE UPDATE ON account_types FOR EACH ROW EXECUTE FUNCTION immutable_account_product_base();
ALTER TABLE account_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_types FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON account_types,account_type_play_products FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON account_types,account_type_play_products FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON account_types TO service_role;
  GRANT SELECT,INSERT,UPDATE,DELETE ON account_type_play_products TO service_role;
  CREATE POLICY account_type_play_products_service ON account_type_play_products TO service_role USING(true) WITH CHECK(true);
  CREATE POLICY account_types_service ON account_types TO service_role USING(true) WITH CHECK(true);
 END IF;
END $$;
COMMIT;
