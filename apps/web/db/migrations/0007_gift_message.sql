-- 0007_gift_message.sql
--
-- Optional "add a message" box when sending a gift (click to reveal, with a
-- confirm/preview step before the final send). Word-limit and on/off are
-- admin-configurable per plan (free/plus/pro/max) and business tier
-- (starter/growth/enterprise); free-plan users additionally need a minimum
-- account level (default Level 5).
--
--   1. gifts gains `message` (the sent text, nullable) and
--      `message_word_count` (denormalized for fast reporting/moderation
--      queries without re-tokenizing the text).
--   2. x_manifest seeds the default giftMessage config read by
--      lib/manifest/index.ts.

BEGIN;

ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS message_word_count integer;

ALTER TABLE gifts
  ADD CONSTRAINT gifts_message_length_check CHECK (message IS NULL OR char_length(message) <= 4000);

-- Manifest defaults for the Gift Message feature. Admin-editable at
-- /gate44/gifts/message-settings.
INSERT INTO x_manifest (key, value, description) VALUES
  ('gift_message_enabled', 'true', 'Master on/off switch for the optional gift message feature.'),
  ('gift_message_free_min_level', '5', 'Minimum account level (main rank number) a Free-plan user needs to unlock the gift message box.'),
  ('gift_message_max_words_free', '40', 'Max words in a gift message for Free-plan users who meet the level requirement.'),
  ('gift_message_max_words_plus', '50', 'Max words in a gift message for Plus-plan users.'),
  ('gift_message_max_words_pro', '100', 'Max words in a gift message for Pro-plan users.'),
  ('gift_message_max_words_max', '250', 'Max words in a gift message for Max-plan users.'),
  ('gift_message_max_words_business_starter', '50', 'Max words in a gift message for Business Starter accounts.'),
  ('gift_message_max_words_business_growth', '100', 'Max words in a gift message for Business Growth accounts.'),
  ('gift_message_max_words_business_enterprise', '250', 'Max words in a gift message for Business Enterprise accounts.'),
  ('gift_message_enabled_free', 'true', 'Whether Free-plan users can use the gift message feature at all (still gated by gift_message_free_min_level).'),
  ('gift_message_enabled_plus', 'true', 'Whether Plus-plan users can use the gift message feature.'),
  ('gift_message_enabled_pro', 'true', 'Whether Pro-plan users can use the gift message feature.'),
  ('gift_message_enabled_max', 'true', 'Whether Max-plan users can use the gift message feature.'),
  ('gift_message_enabled_business_starter', 'true', 'Whether Business Starter accounts can use the gift message feature.'),
  ('gift_message_enabled_business_growth', 'true', 'Whether Business Growth accounts can use the gift message feature.'),
  ('gift_message_enabled_business_enterprise', 'true', 'Whether Business Enterprise accounts can use the gift message feature.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
