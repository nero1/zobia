-- 0035_group_chats_v2.sql
--
-- Group chat hardening: concurrent-presence capacity (mirrors rooms),
-- plan/guild-gated creation, business join/first-N-message credit config,
-- moderation (mute/suspend, remove, self-leave, block-group), and
-- invitations (admin + selected participants, or any member; invitee
-- privacy setting).
--
-- See lib/manifest/index.ts (groupChatCaps, groupChatCapacityUpgrade,
-- groupChatCreationLimits, groupChatInvite) for the admin-configurable
-- defaults these columns interact with.

-- ---------------------------------------------------------------------------
-- users: who can invite me to a group chat?
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS group_invite_privacy text NOT NULL DEFAULT 'friends';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_group_invite_privacy_check;
ALTER TABLE users
  ADD CONSTRAINT users_group_invite_privacy_check
  CHECK (group_invite_privacy = ANY (ARRAY['anybody'::text, 'friends'::text, 'nobody'::text]));

-- ---------------------------------------------------------------------------
-- group_chats: capacity override, business credit config, invite policy,
-- grace-period deactivation
-- ---------------------------------------------------------------------------
ALTER TABLE group_chats
  ADD COLUMN IF NOT EXISTS creator_plan_at_creation text,
  ADD COLUMN IF NOT EXISTS creator_business_tier_at_creation text,
  ADD COLUMN IF NOT EXISTS concurrent_cap integer,
  ADD COLUMN IF NOT EXISTS is_business boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_join_credit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_join_credit_amount integer,
  ADD COLUMN IF NOT EXISTS business_message_credit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_message_credit_amount integer,
  ADD COLUMN IF NOT EXISTS business_message_credit_threshold integer,
  ADD COLUMN IF NOT EXISTS allow_any_member_invite boolean,
  ADD COLUMN IF NOT EXISTS is_deactivated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deactivated_reason text;

COMMENT ON COLUMN group_chats.concurrent_cap IS
  'Soft concurrent-presence cap override (mirrors rooms.max_members). NULL = use manifest groupChatCaps.concurrentDefault. Raised via paid capacity upgrade (POST /api/messages/group/[groupId]/capacity).';
COMMENT ON COLUMN group_chats.allow_any_member_invite IS
  'Per-group override of manifest groupChatInvite.anyMemberCanInvite. NULL = use manifest default.';

-- ---------------------------------------------------------------------------
-- group_chat_members: per-member invite permission, mute/suspension,
-- first-N-message credit progress
-- ---------------------------------------------------------------------------
ALTER TABLE group_chat_members
  ADD COLUMN IF NOT EXISTS can_invite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_until timestamp with time zone,
  ADD COLUMN IF NOT EXISTS muted_by uuid,
  ADD COLUMN IF NOT EXISTS muted_reason text,
  ADD COLUMN IF NOT EXISTS credited_message_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN group_chat_members.credited_message_count IS
  'Messages counted toward business_message_credit_threshold for this member in this group. Stops incrementing once the threshold is reached (one-time credit).';

-- ---------------------------------------------------------------------------
-- group_chat_blocks: a user blocking a group (hides it, blocks invites)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_chat_blocks (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  group_chat_id uuid NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_chat_blocks_unique UNIQUE (group_chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_chat_blocks_user ON group_chat_blocks(user_id);

-- ---------------------------------------------------------------------------
-- group_chat_reactivation_choices: per-group opt-in when a user renews a
-- subscription after their groups were deactivated past the grace period.
-- One row per (group, decision) so the renewal flow can show each group's
-- resolved choice; rows are written once the user answers, not before.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_chat_reactivation_choices (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  group_chat_id uuid NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reactivated boolean NOT NULL,
  decided_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_chat_reactivation_choices_unique UNIQUE (group_chat_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes for the new moderation/capacity lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_group_chats_creator_active ON group_chats(creator_id) WHERE is_active = true AND is_deactivated = false;
CREATE INDEX IF NOT EXISTS idx_group_chat_members_muted ON group_chat_members(group_chat_id, muted_until) WHERE muted_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- x_manifest seed rows — without these, the new group chat settings would
-- exist only as code defaults (lib/manifest/index.ts DEFAULT_MANIFEST) and
-- never appear as editable fields at /gate44/config (which only lists rows
-- that already exist in this table). ON CONFLICT DO NOTHING so re-running
-- this migration, or an admin who already changed a value, is a no-op.
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('group_chat_concurrent_cap', '20', 'Default soft cap on concurrently-active users per group chat.'),
  ('group_chat_capacity_upgrade_step', '10', 'Extra concurrent slots added per paid capacity-upgrade step.'),
  ('group_chat_capacity_upgrade_cost', '300', 'Coin cost per group chat capacity-upgrade step.'),
  ('group_chat_capacity_hard_max', '300', 'Absolute ceiling a group chat concurrent cap can be raised to.'),
  ('group_chat_limit_free', '0', 'Concurrently-active group chats a Free plan user may create.'),
  ('group_chat_limit_plus', '0', 'Concurrently-active group chats a Plus plan user may create.'),
  ('group_chat_limit_pro', '3', 'Concurrently-active group chats a Pro plan user may create.'),
  ('group_chat_limit_max', '10', 'Concurrently-active group chats a Max plan user may create.'),
  ('group_chat_limit_business_starter', '5', 'Concurrently-active group chats a Business Starter account may create.'),
  ('group_chat_limit_business_growth', '10', 'Concurrently-active group chats a Business Growth account may create.'),
  ('group_chat_limit_business_enterprise', '20', 'Concurrently-active group chats a Business Enterprise account may create.'),
  ('group_chat_any_member_can_invite', 'false', 'Default: only the group admin and admin-selected participants may invite. When true, any member may invite by default.')
ON CONFLICT (key) DO NOTHING;
