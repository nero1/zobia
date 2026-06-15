-- Migration 015: Add missing columns to announcement tables, create failed_webhooks, fix subscriptions unique index
-- Fixes: B-07, B-08, B-09, B-11, B-12, N-04

-- 1. Add missing columns to announcement_banners (B-07, B-08, N-04)
ALTER TABLE announcement_banners
  ADD COLUMN IF NOT EXISTS title      TEXT,
  ADD COLUMN IF NOT EXISTS link_url   TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 2. Add deleted_at and created_by to announcement_modals (B-07)
ALTER TABLE announcement_modals
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 3. Create failed_webhooks table (B-09)
CREATE TABLE IF NOT EXISTS failed_webhooks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider   TEXT        NOT NULL,
  event_type TEXT,
  payload    JSONB,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Add UNIQUE index to subscriptions(user_id) so webhook ON CONFLICT clauses work (B-11, B-12)
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_uq
  ON subscriptions (user_id);
