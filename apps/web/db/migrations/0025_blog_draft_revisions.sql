BEGIN;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS draft_content jsonb;
COMMIT;
