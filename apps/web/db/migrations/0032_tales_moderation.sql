BEGIN;
CREATE TABLE IF NOT EXISTS tale_moderation_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES users(id),
 target_type text NOT NULL, target_id uuid NOT NULL, decision text NOT NULL,reason text NOT NULL,
 version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tale_moderation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tale_moderation_log FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON tale_moderation_log TO service_role;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_tale_id uuid REFERENCES tales(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_tale_chapter_id uuid REFERENCES tale_chapters(id) ON DELETE SET NULL;
INSERT INTO x_manifest(key,value,description) VALUES('tales_creator_share_pct','70','Share of paid chapter credits transferred to the author (0–100).') ON CONFLICT(key) DO NOTHING;
COMMIT;
