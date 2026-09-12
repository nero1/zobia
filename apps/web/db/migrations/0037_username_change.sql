-- 0037_username_change.sql
--
-- Username Change feature:
--   - username_change_history: audit-queryable record of every username
--     change (admin/mod-facing "Username history" list — separate from the
--     generic audit_log so it can be browsed per-user without a log-text scan).
--   - username_reservations: holds an old username after a change so it
--     cannot be re-registered by anyone (including the original owner)
--     while the hold is active. Two shapes, both driven by one row:
--       * redirect_to_username IS NOT NULL  -> indefinite hold; the old
--         username permanently redirects to the new one (reserved_until is
--         NULL, i.e. "forever" — never lazily released).
--       * redirect_to_username IS NULL      -> temporary hold; reserved_until
--         is a real timestamp. Availability/redirect logic must always
--         compare against NOW() at read time (lazy expiry) rather than
--         relying on any cleanup job for correctness.
--
-- users.username already has a UNIQUE constraint (users_username_key, added
-- in 0001_consolidated_schema.sql) and a supporting btree index
-- (idx_users_username) — no new constraint needed there. Usernames are
-- always lowercased by the application before insert/update, so a
-- case-sensitive UNIQUE constraint is sufficient in practice; this migration
-- does not change that.

CREATE TABLE IF NOT EXISTS username_change_history (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    old_username text NOT NULL,
    new_username text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    redirect_enabled boolean NOT NULL,
    -- NULL when redirect_enabled = true (indefinite hold, no expiry to track).
    reserved_until timestamp with time zone,
    cost_paid_credits integer DEFAULT 0 NOT NULL,
    cost_paid_stars integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT username_change_history_pkey PRIMARY KEY (id),
    CONSTRAINT username_change_history_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_username_change_history_user
    ON username_change_history USING btree (user_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS username_reservations (
    -- Lowercased old username — this is the natural key: at most one active
    -- hold per old username at a time.
    old_username text NOT NULL,
    previous_user_id uuid NOT NULL,
    -- Set when the user opted to have the old username redirect to the new
    -- one; that hold never expires. NULL means "no redirect" — the old
    -- username just shows the "no longer exists" message until reserved_until.
    redirect_to_username text,
    -- NULL = indefinite (redirect case). A real timestamp = temporary hold;
    -- always compare to NOW() at read time, never rely on a cleanup job.
    reserved_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT username_reservations_pkey PRIMARY KEY (old_username),
    CONSTRAINT username_reservations_previous_user_id_fkey FOREIGN KEY (previous_user_id)
        REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT username_reservations_redirect_or_expiry_chk CHECK (
        (redirect_to_username IS NOT NULL AND reserved_until IS NULL)
        OR
        (redirect_to_username IS NULL AND reserved_until IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_username_reservations_previous_user
    ON username_reservations USING btree (previous_user_id);

-- x_manifest seeds — admin-configurable eligibility, cost and cooldown for
-- the Username Change feature. Follows the exact JSON-array-as-text
-- convention already used by privacy_can_lock_profile etc.
INSERT INTO x_manifest (key, value, description) VALUES
  ('username_change_min_level', '5', 'Minimum account level (main rank number) that makes a user eligible to change their username, independent of plan/business tier'),
  ('username_change_plans', '["max"]', 'Plans that are eligible to change their username regardless of level. JSON array of plan slugs.'),
  ('username_change_business_tiers', '["growth","enterprise"]', 'Business account tiers (business_accounts.tier) eligible to change their username regardless of level. JSON array.'),
  ('username_change_cost_credits', '5000', 'Credits charged to change username (0 = not payable with Credits)'),
  ('username_change_cost_stars', '50', 'Stars charged to change username (0 = not payable with Stars)'),
  ('username_change_cooldown_days', '90', 'Minimum days a user must wait between username changes')
ON CONFLICT (key) DO NOTHING;
