-- 0008_room_capacity_caps.sql
--
-- Soft per-room-type participant caps + paid capacity-upgrade config.
--
-- Caps are enforced against LIVE presence (who is viewing now), not DB
-- membership, so rooms free up automatically. They are the primary lever on
-- realtime fan-out cost. All keys are admin-editable via /admin/config; the
-- manifest loader (lib/manifest/index.ts) falls back to the same defaults when
-- a row is absent, so this seed is purely to surface the keys in the admin UI.
--
-- Idempotent: ON CONFLICT (key) DO NOTHING so re-running is safe and existing
-- admin overrides are never clobbered.

INSERT INTO x_manifest (key, value, description) VALUES
  ('room_free_open_cap',          '30',   'Soft concurrent-participant cap for free_open rooms'),
  ('room_tipping_cap',            '30',   'Soft concurrent-participant cap for tipping rooms'),
  ('room_vip_cap',                '200',  'Soft concurrent-participant cap for VIP rooms'),
  ('room_drop_cap',               '100',  'Soft concurrent-participant cap for drop rooms'),
  ('room_classroom_cap',          '150',  'Soft concurrent-participant cap for classroom rooms'),
  ('room_guild_cap',              '100',  'Soft concurrent-participant cap for guild rooms'),
  ('room_capacity_upgrade_step',  '25',   'Slots added per purchased capacity-upgrade step'),
  ('room_capacity_upgrade_cost',  '500',  'Coin cost per capacity-upgrade step'),
  ('room_capacity_hard_max',      '1000', 'Absolute ceiling a room capacity can be raised to')
ON CONFLICT (key) DO NOTHING;
