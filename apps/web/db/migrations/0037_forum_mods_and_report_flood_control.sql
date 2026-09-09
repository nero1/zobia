-- 0037_forum_mods_and_report_flood_control.sql
--
-- Adds three related moderation features:
--
-- 1. Forum Mods (guild-scoped moderators). "Forum" here means a Guild —
--    Guilds already have a creator/owner (guilds.captain_id) and member
--    roles (guild_members.role). A guild's captain can now additionally
--    flag any member `is_moderator`, granting them a scoped moderation
--    surface for that guild only (chat messages + membership), separate
--    from sitewide Platform Mods (users.is_moderator). Forum Mods do NOT
--    gain any sitewide jurisdiction.
--
-- 2. Reporting rewards + malicious-report trust penalty. Tracks every
--    distinct reporter of a report (not just the first) via
--    moderation_report_reporters, so accepted/rejected outcomes can pay
--    out Credits/XP to each reporter per the PRD's tiered rule (first
--    accepted reporter gets Credits+XP, every subsequent accepted
--    reporter gets XP only, a not-accepted report pays 1 XP, a report
--    marked malicious/spammy costs the original reporter trust score).
--
-- 3. Report flood control. Multiple reports against the same target within
--    a rolling window are folded into a single queue entry
--    (moderation_reports.duplicate_count) instead of creating N separate
--    rows, and a target that crosses an admin-configurable duplicate
--    threshold is automatically quarantined (soft-hidden) pending review —
--    logged as an `automated` moderation_actions row so it is visible in
--    the existing Audit Log and reversible via the existing
--    POST /api/admin/moderation/actions/[actionId]/reverse endpoint.

-- ---------------------------------------------------------------------------
-- 1. Forum (Guild) Mods
-- ---------------------------------------------------------------------------

ALTER TABLE guild_members
    ADD COLUMN IF NOT EXISTS is_moderator boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS moderator_granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS moderator_granted_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS is_muted boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS muted_until timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_guild_members_moderator ON guild_members(guild_id) WHERE is_moderator = true;

ALTER TABLE guild_messages
    ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN guild_members.is_moderator IS 'Forum Mod (guild-scoped moderator) — assigned by the guild captain (or platform admin) at POST /api/guilds/[guildId]/moderators. No sitewide jurisdiction; capabilities are admin-configured at /gate44/moderation/settings (guildModActions.*).';

-- ---------------------------------------------------------------------------
-- 1b. moderation_actions.target_user_id was NOT NULL, but a growing share of
--     reports target content with no reported user (e.g. bb_posts reported
--     via reportedBbPostId only — see components/bbforum/PostCard.tsx). Any
--     action taken against such a report (including the new automated
--     auto-quarantine action below) would violate the NOT NULL constraint.
-- ---------------------------------------------------------------------------

ALTER TABLE moderation_actions ALTER COLUMN target_user_id DROP NOT NULL;

-- Forum Mod (guild-scoped) actions aren't in the action_type CHECK yet.
ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_action_type_check;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_action_type_check
    CHECK (action_type = ANY (ARRAY[
        'warn'::text, 'suspend'::text, 'ban'::text, 'remove_content'::text,
        'escalate'::text, 'dismiss'::text,
        'suspend_user'::text, 'ban_user'::text, 'escalate_ai'::text,
        'mute_member'::text, 'kick_member'::text
    ]));

-- ---------------------------------------------------------------------------
-- 2. Report targets, clustering, and reward bookkeeping
-- ---------------------------------------------------------------------------

-- moderation_reports had no `deleted_at` despite both
-- app/api/admin/moderation/[reportId]/action/route.ts and the reverse-action
-- route already filtering `WHERE ... AND deleted_at IS NULL` — every action
-- attempt was throwing "column deleted_at does not exist". Adding it here
-- (soft-delete for reports later found to be junk/duplicate) fixes that and
-- matches the pattern in every other moderated table.
ALTER TABLE moderation_reports
    ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS reported_guild_message_id uuid REFERENCES guild_messages(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS cluster_key text,
    ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_malicious boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reward_applied boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS auto_quarantined boolean NOT NULL DEFAULT false;

-- Used to find the current pending cluster for a target quickly when a new
-- report comes in (see lib/moderation/clustering.ts).
CREATE INDEX IF NOT EXISTS idx_moderation_reports_cluster_pending
    ON moderation_reports(cluster_key, created_at DESC)
    WHERE status = 'pending' AND cluster_key IS NOT NULL;

-- Every reporter of a clustered report (including the first — the first
-- reporter is duplicated here too so reward fan-out can treat the table as
-- the single source of truth for "who reported this and were they first").
CREATE TABLE IF NOT EXISTS moderation_report_reporters (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    report_id uuid NOT NULL REFERENCES moderation_reports(id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_first boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (report_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_report_reporters_report ON moderation_report_reporters(report_id);

-- ---------------------------------------------------------------------------
-- 3. Admin configuration (x_manifest) — reasonable defaults, all editable at
--    /gate44/moderation/settings (also under /gate44/config).
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
    ('report_reward_credits_first_accepted', '50', 'Credits awarded to the FIRST reporter of a report that is accepted (any resolution other than dismiss).'),
    ('report_reward_xp_first_accepted', '50', 'XP awarded to the FIRST reporter of an accepted report.'),
    ('report_reward_xp_subsequent_accepted', '50', 'XP awarded to every reporter AFTER the first on an accepted report (no Credits).'),
    ('report_reward_xp_not_accepted', '1', 'XP awarded to a reporter when their report is dismissed (not accepted).'),
    ('report_malicious_trust_penalty', '1', 'Trust Score points deducted from the original reporter when a moderator marks a report malicious/spammy.'),
    ('report_duplicate_auto_quarantine_threshold', '5', 'Number of distinct reporters against the same target (within the cluster window) that triggers automatic quarantine pending review. 0 disables auto-quarantine.'),
    ('report_duplicate_cluster_window_hours', '24', 'Rolling window (hours) during which new reports against the same target are folded into the existing pending report instead of creating a new one.'),
    -- Platform Mod (sitewide) capabilities — every action is admin-configurable; admins can always perform all actions regardless of these flags.
    ('modcap_platform_dismiss', 'true', 'Platform Mods may dismiss reports.'),
    ('modcap_platform_warn', 'true', 'Platform Mods may warn the reported user.'),
    ('modcap_platform_remove_content', 'true', 'Platform Mods may remove reported content.'),
    ('modcap_platform_suspend_user', 'true', 'Platform Mods may temporarily suspend the reported user.'),
    ('modcap_platform_ban_user', 'false', 'Platform Mods may permanently ban the reported user. Default off — admin can grant it.'),
    ('modcap_platform_escalate_ai', 'false', 'Platform Mods may trigger a paid AI re-escalation. Default off (costs an API call) — admin can grant it.'),
    -- Forum Mod (guild-scoped) capabilities.
    ('modcap_guild_dismiss', 'true', 'Forum Mods may dismiss reports scoped to their guild.'),
    ('modcap_guild_warn', 'true', 'Forum Mods may warn a guild member.'),
    ('modcap_guild_remove_content', 'true', 'Forum Mods may remove a reported guild chat message.'),
    ('modcap_guild_mute_member', 'true', 'Forum Mods may temporarily mute a guild member from guild chat.'),
    ('modcap_guild_kick_member', 'false', 'Forum Mods may remove a member from the guild. Default off — admin (or the guild captain) can grant it.')
ON CONFLICT (key) DO NOTHING;
