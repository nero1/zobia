-- 0019_blog_post_content_format.sql
--
-- Blog post editor: let authors write in plain text OR Markdown per post/page.
-- body_markdown keeps holding the raw source either way (name unchanged to
-- avoid touching every existing reader of that column); content_format says
-- how to interpret it when regenerating body_html or re-populating the
-- editor. Existing rows default to 'markdown' (the only mode that existed
-- before this migration).

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown';

ALTER TABLE blog_posts
  DROP CONSTRAINT IF EXISTS blog_posts_content_format_check;
ALTER TABLE blog_posts
  ADD CONSTRAINT blog_posts_content_format_check CHECK (content_format = ANY (ARRAY['markdown'::text, 'plaintext'::text]));
