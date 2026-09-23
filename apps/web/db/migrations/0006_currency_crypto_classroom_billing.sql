-- 0006_currency_crypto_classroom_billing.sql
--
-- Currency display fix (NGN vs USD by region), crypto payouts ledger,
-- classroom draft/publish workflow, and subscription cancellation feedback.

-- ---------------------------------------------------------------------------
-- Currency / region
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS country_source text NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_preference text;

-- ---------------------------------------------------------------------------
-- Classroom draft/publish workflow
-- ---------------------------------------------------------------------------

-- NULL = never published (created as a draft, PRD-required default going
-- forward). Existing classrooms are backfilled to "published now" so nothing
-- already live silently disappears from the directory.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE rooms SET published_at = created_at WHERE type = 'classroom' AND published_at IS NULL;

INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_free', '3', 'Max classrooms (draft + live) a Free plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_plus', '10', 'Max classrooms (draft + live) a Plus plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_pro', '15', 'Max classrooms (draft + live) a Pro plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_max', '20', 'Max classrooms (draft + live) a Max plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_free_min_level', '5', 'Creator-track level a Free plan user must reach before creating any classroom.', NOW()) ON CONFLICT DO NOTHING;
