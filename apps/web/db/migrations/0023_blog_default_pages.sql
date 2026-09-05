-- 0023_blog_default_pages.sql
--
-- Default blog pages (About/Privacy/Contact) + the Contact form inbox.
--
-- About/Privacy/Contact are ordinary `blog_posts` rows with type='page' —
-- they get all of the existing page CRUD (edit/draft/delete) for free. The
-- only new piece of state is `page_key`, which tags a page as one of the
-- three auto-generated defaults so:
--   (a) "Reset to default" (lib/blogs/service.ts resetDefaultPage) can find
--       and regenerate the right template regardless of title/slug edits;
--   (b) the Contact page can be rendered as a live form (not body_html) by
--       the public post page, keyed off page_key = 'contact' rather than a
--       slug string that an owner could rename.
-- page_key survives a rename/retitle; it's cleared if the owner ever
-- deletes the page (the row's own deleted_at handles that — no cleanup
-- needed here).

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS page_key text,
  ADD CONSTRAINT blog_posts_page_key_check CHECK (page_key IS NULL OR page_key IN ('about', 'privacy', 'contact'));

-- One default page per key per blog (guards against the auto-creation
-- accidentally double-inserting, and gives resetDefaultPage/lookup a fast
-- unique target). Partial index since page_key is NULL for ordinary posts.
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_blog_page_key_idx ON blog_posts (blog_id, page_key) WHERE page_key IS NOT NULL AND deleted_at IS NULL;

-- Contact form submissions. No existing generic "contact us" table covers
-- per-blog messages (the sitewide support flow, if any, is a different
-- inbox entirely) — this is intentionally minimal: one row per submission,
-- read by the blog owner's dashboard inbox, notified via the existing
-- `notifications` table (see lib/notifications/insert.ts).
CREATE TABLE IF NOT EXISTS blog_contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    sender_name text,
    sender_email text,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS blog_contact_messages_blog_idx ON blog_contact_messages (blog_id, created_at DESC);
