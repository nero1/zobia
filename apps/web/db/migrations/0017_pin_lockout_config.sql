-- Migration 0017: admin-editable PIN lockout policy (Admin > Config > "Auth")
-- Defaults match the previously hard-coded policy. No new table, no GRANTs needed.
BEGIN;
INSERT INTO x_manifest (key, value, description) VALUES
  ('pin_max_failed_attempts', '5', 'Wrong PINs allowed within pin_fail_window_minutes before the PIN is locked. Default: 5.'),
  ('pin_fail_window_minutes', '15', 'Rolling window (minutes) in which wrong PINs accumulate. Default: 15.'),
  ('pin_lockout_minutes', '15', 'Length (minutes) of an ordinary PIN lockout. Default: 15.'),
  ('pin_strike_limit', '3', 'Number of lockouts within pin_strike_window_hours that escalates to the long lockout. Default: 3.'),
  ('pin_strike_window_hours', '24', 'Window (hours) in which PIN lockouts count as strikes. Default: 24.'),
  ('pin_long_lockout_hours', '24', 'Length (hours) of the escalated PIN lockout. Default: 24.')
ON CONFLICT (key) DO NOTHING;
COMMIT;
