BEGIN;
CREATE TABLE play_purchase_receipts (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 -- Keep a token tombstone if the account is permanently removed, so the
 -- same purchase cannot credit a newly created account a second time.
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 product_id text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX play_purchase_receipts_user ON play_purchase_receipts(user_id);
ALTER TABLE play_purchase_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON play_purchase_receipts FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON play_purchase_receipts FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON play_purchase_receipts FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON play_purchase_receipts TO service_role;
  CREATE POLICY play_purchase_receipts_service ON play_purchase_receipts TO service_role USING(true) WITH CHECK(true);
 END IF;
END $$;
COMMIT;
