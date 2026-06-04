-- migration: 019_recurring_events
-- Adds annual-recurrence support for cultural platform events.
--
-- PRD §25: Cultural vitality events repeat every year. Events flagged with
-- is_recurring_annual = TRUE are auto-cloned by the daily cron job before
-- they would expire (see app/api/cron/daily/route.ts step 15).
--
-- For events whose dates shift each year (Eid, Easter) the cron will clone
-- them using the same month/day offsets; admins can adjust via the admin UI.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS is_recurring_annual BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_anchor_month_start INT,   -- 1-12
  ADD COLUMN IF NOT EXISTS recurrence_anchor_day_start   INT,   -- 1-31
  ADD COLUMN IF NOT EXISTS recurrence_anchor_month_end   INT,   -- 1-12
  ADD COLUMN IF NOT EXISTS recurrence_anchor_day_end     INT;   -- 1-31

-- Mark all existing cultural events as annually recurring and record their
-- anchor dates so the cron can project them into future years.
UPDATE platform_events
SET
  is_recurring_annual         = TRUE,
  recurrence_anchor_month_start = EXTRACT(MONTH FROM starts_at)::INT,
  recurrence_anchor_day_start   = EXTRACT(DAY   FROM starts_at)::INT,
  recurrence_anchor_month_end   = EXTRACT(MONTH FROM ends_at)::INT,
  recurrence_anchor_day_end     = EXTRACT(DAY   FROM ends_at)::INT
WHERE event_type = 'cultural';

CREATE INDEX IF NOT EXISTS idx_platform_events_recurring
  ON platform_events (is_recurring_annual, event_type)
  WHERE is_recurring_annual = TRUE;
