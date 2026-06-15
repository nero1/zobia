-- Migration 009: Bug Fixes (BUG-03, BUG-25, BUG-26, BUG-27, BUG-28, BUG-35)

-- BUG-28: Ensure gen_random_uuid() is always available (no extension needed)
-- BUG-26: Add is_active to gift_items
ALTER TABLE gift_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- BUG-26: Update gifts table FK column name (guard: migration 001 already uses gift_item_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'gifts' AND column_name = 'gift_type_id'
  ) THEN
    ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id;
    ALTER TABLE gifts DROP CONSTRAINT IF EXISTS gifts_gift_type_id_fkey;
    ALTER TABLE gifts ADD CONSTRAINT gifts_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES gift_items(id);
  END IF;
END $$;

-- BUG-03: Add tier column to referral_commissions
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard';

-- BUG-25: Consolidate user_badges timestamps (keep granted_at, backfill from awarded_at)
UPDATE user_badges SET granted_at = awarded_at WHERE granted_at IS NULL AND awarded_at IS NOT NULL;
ALTER TABLE user_badges DROP COLUMN IF EXISTS awarded_at;

-- BUG-35: Add missing tables
CREATE TABLE IF NOT EXISTS store_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL,
  price_coins INTEGER NOT NULL DEFAULT 0,
  price_kobo BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id UUID,
  gross_amount_kobo BIGINT NOT NULL,
  platform_fee_kobo BIGINT NOT NULL DEFAULT 0,
  net_amount_kobo BIGINT NOT NULL,
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsored_quest_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL REFERENCES quest_templates(id) ON DELETE CASCADE,
  sponsor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_coins INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BUG-35: system_alerts table (needed for DLQ monitoring - BUG-47)
CREATE TABLE IF NOT EXISTS system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
