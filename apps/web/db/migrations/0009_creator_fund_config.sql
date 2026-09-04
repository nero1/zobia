-- 0009_creator_fund_config.sql
--
-- Creator Fund per-activity revenue split, admin-configurable.
--
-- Every place that contributes to the Creator Fund (room subscriptions,
-- room entry fees, coin pack purchases, branded-room sponsorships, rewarded
-- ad payouts) hard-coded the same 5% literal inline (PRD §14). These keys
-- let admin adjust each activity's contribution rate independently from
-- the existing generic x_manifest config panel (/admin/config) — no new
-- admin UI plumbing needed, since unlisted-but-present x_manifest keys
-- already render there. Defaults match the prior hard-coded 5%, so this
-- migration alone changes no behaviour until an admin edits a value.
--
-- lib/creator/fundContribution.ts reads these; the scattered inline
-- 0.05 literals were replaced with calls into that shared helper.

INSERT INTO x_manifest (key, value, description) VALUES
  ('creator_fund_split_room_subscription_percent', '5', 'Percent of gross room-subscription revenue contributed to the Creator Fund'),
  ('creator_fund_split_room_entry_percent', '5', 'Percent of gross room-entry-fee revenue contributed to the Creator Fund'),
  ('creator_fund_split_coin_purchase_percent', '5', 'Percent of gross Credit-pack purchase revenue contributed to the Creator Fund'),
  ('creator_fund_split_sponsor_budget_percent', '5', 'Percent of branded-room sponsor budget contributed to the Creator Fund'),
  ('creator_fund_split_ad_reward_percent', '5', 'Percent of rewarded-ad payout value contributed to the Creator Fund')
ON CONFLICT (key) DO NOTHING;
