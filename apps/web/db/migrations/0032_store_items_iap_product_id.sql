-- Migration 0032: Add iap_product_id to store_items
--
-- BUG-MED-20: CoinProduct rows need a server-side field linking each
-- store_items coin pack to its Google Play product ID so the client can
-- do an exact match instead of the fragile coin-count fallback.
--
-- The column is nullable so existing rows are unaffected and can be
-- back-filled via the admin panel or a one-time data script.

ALTER TABLE store_items
  ADD COLUMN IF NOT EXISTS iap_product_id TEXT;

-- Partial unique index: no two active coin packs may share the same
-- Play Store product ID, but NULL is allowed (non-IAP items).
CREATE UNIQUE INDEX IF NOT EXISTS store_items_iap_product_id_unique
  ON store_items (iap_product_id)
  WHERE iap_product_id IS NOT NULL;
