-- 0030_site_contact_messages.sql
--
-- Site-wide "Contact Us" page (app/contact) submissions. Distinct from
-- blog_contact_messages (0023_blog_default_pages.sql), which is a per-blog
-- inbox read by that blog's owner — this is the platform-level inbox, read
-- by admins. Deliberately minimal, mirroring blog_contact_messages'
-- shape/notification pattern (notifications table, not email) since no
-- prior sitewide "contact us" table exists (confirmed in the 0023 comment).

CREATE TABLE IF NOT EXISTS site_contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    sender_name text,
    sender_email text,
    subject text,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS site_contact_messages_created_idx ON site_contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS site_contact_messages_unread_idx ON site_contact_messages (is_read, created_at DESC) WHERE is_read = false;
