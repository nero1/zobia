-- 0026_rewarded_gifts.sql
--
-- Rewarded Gifts (sitewide gifts economy): an admin can mark any gift_items
-- row as "rewarded" and attach a reward_config describing what sending it
-- unlocks. The SAME gift item can be sent to either a room owner or a blog
-- owner — the send context (room vs blog) determines where the unlocked
-- reward applies, it is not baked into the gift item itself.
--
-- reward_config shape (admin-authored, validated by Zod at the API layer):
--   {
--     benefitType: "sender_badge" | "room_privilege" | "blog_privilege" | "custom_text",
--     label: string,                 -- shown as the badge/reward name, e.g. "VIP Supporter"
--     description?: string,          -- shown to the sender before they send
--     durationDays?: number | null,  -- null/omitted = permanent
--     customText?: string            -- only relevant when benefitType = "custom_text"
--   }
--
-- gift_reward_grants is the durable "this user unlocked this reward by
-- sending this gift here" ledger, written atomically alongside the gift send
-- in the existing gifts-send transaction (app/api/economy/gifts/send/route.ts).
-- Not to be confused with the unrelated per-blog blog_gift_tiers/
-- blog_gift_purchases/blog_gift_claims system (migration 0024) — that is a
-- completely separate, owner-defined per-blog feature.

ALTER TABLE gift_items
  ADD COLUMN IF NOT EXISTS is_rewarded boolean NOT NULL DEFAULT false;
ALTER TABLE gift_items
  ADD COLUMN IF NOT EXISTS reward_config jsonb;

CREATE TABLE IF NOT EXISTS gift_reward_grants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type text NOT NULL,
  context_id uuid NOT NULL,
  benefit_type text NOT NULL,
  label text NOT NULL,
  description text,
  custom_text text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  revoked_at timestamptz
);

ALTER TABLE gift_reward_grants
  DROP CONSTRAINT IF EXISTS gift_reward_grants_context_type_check;
ALTER TABLE gift_reward_grants
  ADD CONSTRAINT gift_reward_grants_context_type_check
  CHECK (context_type = ANY (ARRAY['room'::text, 'blog'::text]));

ALTER TABLE gift_reward_grants
  DROP CONSTRAINT IF EXISTS gift_reward_grants_benefit_type_check;
ALTER TABLE gift_reward_grants
  ADD CONSTRAINT gift_reward_grants_benefit_type_check
  CHECK (benefit_type = ANY (ARRAY['sender_badge'::text, 'room_privilege'::text, 'blog_privilege'::text, 'custom_text'::text]));

-- One row per (gift send), but the common "does this user hold an active
-- reward badge in this room/blog" lookup needs a fast index.
CREATE INDEX IF NOT EXISTS gift_reward_grants_active_lookup_idx
  ON gift_reward_grants (context_type, context_id, sender_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS gift_reward_grants_sender_idx
  ON gift_reward_grants (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gift_reward_grants_gift_id_idx
  ON gift_reward_grants (gift_id);
