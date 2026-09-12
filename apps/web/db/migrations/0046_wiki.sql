-- 0046_wiki.sql
--
-- Wikis: users can create collaborative wikis (standard wiki behaviour —
-- multiple contributors editing shared pages with full revision history) at
-- /w/<slug>. Discovery mirrors Blogs (0018_blogs_multi.sql) — Popular /
-- Trending / New / Random tabs + search, cursor pagination.
--
-- Permissions model:
--   * Who may CREATE a wiki at all is gated site-wide by an admin (role,
--     plan, and/or creator level — see wiki_create_* x_manifest keys below),
--     same shape as lib/blogs/limits.ts's creator-level gate.
--   * Each wiki's creator (owner) may assign per-wiki moderators — boolean +
--     grant audit columns on wiki_collaborators, mirroring guild_members'
--     is_moderator/moderator_granted_by/moderator_granted_at (0037).
--   * Each wiki's owner picks a contribute_policy: 'everyone' (any signed-in
--     user), 'friends' (the owner's accepted friendships), or 'selected'
--     (only users explicitly added as a collaborator row).
--   * The owner may invite collaborators by username — token-based, optional
--     target user, expiry, single-use — mirroring guild_invites (§13).
--
-- Reward pot ("treasury"): reuses the generic content_treasuries /
-- content_treasury_claims / content_shares tables introduced in
-- 0038_polls_quizzes.sql rather than duplicating the pattern — the owner
-- funds a Credits pot on a wiki, the first N distinct people who contribute
-- (create/edit a page) or share the wiki split it evenly, recomputed at
-- claim time.
--
-- Baseline XP/Credits for creating a wiki or contributing to one are
-- separate, always-on, and admin-configurable (default 1 XP / 0 Credits per
-- the product spec) — same shape as the Blogs/Polls/Quizzes reward config.

-- ---------------------------------------------------------------------------
-- Wikis
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wikis (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  avatar_url text,
  cover_image_url text,
  -- 'everyone' | 'friends' | 'selected' — who may contribute pages/edits
  -- beyond the owner and assigned moderators (who can always contribute).
  contribute_policy text NOT NULL DEFAULT 'everyone',
  status text NOT NULL DEFAULT 'active',
  status_reason text,
  page_count integer NOT NULL DEFAULT 0,
  contributor_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  edit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS wikis_slug_idx ON wikis (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wikis_owner_idx ON wikis (owner_id);
CREATE INDEX IF NOT EXISTS wikis_status_created_idx ON wikis (status, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE wikis DROP CONSTRAINT IF EXISTS wikis_status_check;
ALTER TABLE wikis ADD CONSTRAINT wikis_status_check CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'suspended'::text, 'banned'::text, 'deactivated'::text]));
ALTER TABLE wikis DROP CONSTRAINT IF EXISTS wikis_contribute_policy_check;
ALTER TABLE wikis ADD CONSTRAINT wikis_contribute_policy_check CHECK (contribute_policy = ANY (ARRAY['everyone'::text, 'friends'::text, 'selected'::text]));

-- ---------------------------------------------------------------------------
-- Pages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_pages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  wiki_id uuid NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  -- Raw author input (markdown or plaintext, see content_format) and its
  -- sanitized rendered HTML — same split as blog_posts.body_markdown/body_html.
  content_markdown text NOT NULL,
  content_html text NOT NULL,
  content_format text NOT NULL DEFAULT 'markdown',
  status text NOT NULL DEFAULT 'published',
  revision_count integer NOT NULL DEFAULT 1,
  view_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_wiki_slug_idx ON wiki_pages (wiki_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wiki_pages_wiki_idx ON wiki_pages (wiki_id, updated_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE wiki_pages DROP CONSTRAINT IF EXISTS wiki_pages_status_check;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_status_check CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'locked'::text]));
ALTER TABLE wiki_pages DROP CONSTRAINT IF EXISTS wiki_pages_content_format_check;
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_content_format_check CHECK (content_format = ANY (ARRAY['markdown'::text, 'plaintext'::text]));

-- Append-only revision history — one row per saved edit, never updated or
-- deleted. wiki_pages holds the current/live content redundantly (rather
-- than always joining to the latest revision) so page reads stay a single
-- cheap row lookup; revisions exist purely for history/diff/restore.
CREATE TABLE IF NOT EXISTS wiki_page_revisions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  title text NOT NULL,
  content_markdown text NOT NULL,
  content_format text NOT NULL DEFAULT 'markdown',
  edit_summary text,
  edited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_page_revisions_page_number_idx ON wiki_page_revisions (page_id, revision_number);
CREATE INDEX IF NOT EXISTS wiki_page_revisions_page_created_idx ON wiki_page_revisions (page_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Collaborators — membership + per-wiki moderator flag + how a 'selected'
-- contributor got access. The owner is not required to have a row here
-- (owner_id on wikis is authoritative); a row is created for the owner at
-- creation time anyway so listing "collaborators" and moderator lookups stay
-- a single table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_collaborators (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  wiki_id uuid NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'contributor',
  is_moderator boolean NOT NULL DEFAULT false,
  moderator_granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  moderator_granted_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  page_edit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_collaborators_wiki_user_idx ON wiki_collaborators (wiki_id, user_id);
CREATE INDEX IF NOT EXISTS wiki_collaborators_wiki_idx ON wiki_collaborators (wiki_id, status);
CREATE INDEX IF NOT EXISTS wiki_collaborators_user_idx ON wiki_collaborators (user_id);
ALTER TABLE wiki_collaborators DROP CONSTRAINT IF EXISTS wiki_collaborators_role_check;
ALTER TABLE wiki_collaborators ADD CONSTRAINT wiki_collaborators_role_check CHECK (role = ANY (ARRAY['owner'::text, 'moderator'::text, 'contributor'::text]));
ALTER TABLE wiki_collaborators DROP CONSTRAINT IF EXISTS wiki_collaborators_status_check;
ALTER TABLE wiki_collaborators ADD CONSTRAINT wiki_collaborators_status_check CHECK (status = ANY (ARRAY['active'::text, 'removed'::text]));

-- ---------------------------------------------------------------------------
-- Invites — token-based, optional target user (open link when null),
-- expiry, single-use. Mirrors guild_invites (0037).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  wiki_id uuid NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  invited_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wiki_invites_wiki_idx ON wiki_invites (wiki_id);
CREATE INDEX IF NOT EXISTS wiki_invites_invited_user_idx ON wiki_invites (invited_user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Moderation log — mirrors blog_moderation_log.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wiki_moderation_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  moderator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wiki_id uuid REFERENCES wikis(id) ON DELETE CASCADE,
  page_id uuid REFERENCES wiki_pages(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wiki_moderation_log_wiki_idx ON wiki_moderation_log (wiki_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Reuse the generic content_shares / content_treasuries / content_treasury_claims
-- tables (0038_polls_quizzes.sql) for the wiki reward pot — extend their
-- content_type check constraints to accept 'wiki'.
-- ---------------------------------------------------------------------------

ALTER TABLE content_shares DROP CONSTRAINT IF EXISTS content_shares_type_check;
ALTER TABLE content_shares ADD CONSTRAINT content_shares_type_check CHECK (content_type = ANY (ARRAY['poll'::text, 'quiz'::text, 'wiki'::text]));

ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_type_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_type_check CHECK (content_type = ANY (ARRAY['poll'::text, 'quiz'::text, 'wiki'::text]));

ALTER TABLE content_treasury_claims DROP CONSTRAINT IF EXISTS content_treasury_claims_type_check;
ALTER TABLE content_treasury_claims ADD CONSTRAINT content_treasury_claims_type_check CHECK (claim_type = ANY (ARRAY['vote'::text, 'share'::text, 'pass'::text, 'contribute'::text]));

-- ---------------------------------------------------------------------------
-- Moderation — plug wikis into the existing generic report tables, same
-- shape as reported_poll_id/reported_quiz_id (0038).
-- ---------------------------------------------------------------------------

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_wiki_id uuid REFERENCES wikis(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_wiki_page_id uuid REFERENCES wiki_pages(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_wiki_id uuid REFERENCES wikis(id) ON DELETE SET NULL;
ALTER TABLE moderation_reports ADD COLUMN IF NOT EXISTS reported_wiki_page_id uuid REFERENCES wiki_pages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_wiki ON reports (reported_wiki_id) WHERE reported_wiki_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_wiki_page ON reports (reported_wiki_page_id) WHERE reported_wiki_page_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Slug redirects — reuse the existing shared slug_redirects table
-- (entity_type discriminator) for wiki renames, same mechanism as blogs.
-- No schema change needed here; entity_type = 'wiki' rows are just inserted
-- by the service layer (see lib/slug.ts recordSlugRedirect).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Manifest defaults (idempotent seed; an admin who already set these keeps
-- their value).
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_wiki', 'true', 'Master toggle for the Wiki feature. When off, all /api/wiki endpoints and /w/* pages return unavailable.'),
  ('wiki_monetization_enabled', 'true', 'Master kill-switch for Wiki reward pots (treasuries). When off, funding/claiming a pot is disabled but wikis still work.'),

  -- Who may create a wiki: plan + creator-level gate (mirrors blog_creator_level_threshold),
  -- plus an optional staff-only restriction. All admin-editable at /gate44/wiki.
  ('wiki_create_required_plan', 'free', 'Minimum plan (free/plus/pro/max) required to create a wiki.'),
  ('wiki_create_min_level', '0', 'Minimum creator level (users.level_creator) required to create a wiki.'),
  ('wiki_create_restricted_to_staff', 'false', 'When true, only moderators/admins may create wikis, regardless of plan/level.'),

  -- Baseline XP/Credits — per product spec, default 1 XP / 0 Credits, admin-configurable.
  ('wiki_create_reward_xp', '1', 'XP awarded to a user for creating a wiki.'),
  ('wiki_create_reward_credits', '0', 'Credits awarded to a user for creating a wiki.'),
  ('wiki_contribute_reward_xp', '1', 'XP awarded to a user for creating or editing a wiki page.'),
  ('wiki_contribute_reward_credits', '0', 'Credits awarded to a user for creating or editing a wiki page.'),
  ('wiki_daily_reward_cap_credits', '50', 'Ceiling on total wiki-sourced credit rewards a user can earn per rolling 24h.'),

  -- Per-plan limits (max wikis a user may own, max pages per wiki, max
  -- explicitly-invited/selected collaborators per wiki).
  ('wiki_max_owned_free', '1', 'Max wikis a Free-plan user may own.'),
  ('wiki_max_owned_plus', '3', 'Max wikis a Plus-plan user may own.'),
  ('wiki_max_owned_pro', '10', 'Max wikis a Pro-plan user may own.'),
  ('wiki_max_owned_max', '25', 'Max wikis a Max-plan user may own.'),
  ('wiki_max_pages_free', '20', 'Max pages per wiki for a Free-plan owner.'),
  ('wiki_max_pages_plus', '75', 'Max pages per wiki for a Plus-plan owner.'),
  ('wiki_max_pages_pro', '250', 'Max pages per wiki for a Pro-plan owner.'),
  ('wiki_max_pages_max', '1000', 'Max pages per wiki for a Max-plan owner.'),
  ('wiki_max_selected_collaborators', '100', 'Max explicitly-selected/invited collaborators per wiki (contribute_policy = selected).'),
  ('wiki_invite_expiry_hours', '168', 'Hours a wiki collaborator invite link remains valid (default 7 days).')
ON CONFLICT (key) DO NOTHING;
