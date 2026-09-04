-- 0010_platform_events_recurrence.sql
--
-- Platform Events: adds a general recurrence_interval ('none' | 'monthly' | 'yearly')
-- alongside the existing annual-only is_recurring_annual + month/day anchor columns.
-- Existing annual events keep working unchanged (recurrence_interval is backfilled
-- from is_recurring_annual below); 'monthly' is new — the cron clones the event
-- one calendar month forward (same time-of-day and duration) instead of using the
-- month/day anchor pair, since a month has no fixed day count to anchor against.
--
-- Also fixes the /admin/events page.tsx crash ("can't access property 'replace',
-- e.type is undefined"): the admin events API was returning raw snake_case columns
-- while the page expects camelCase (type/startsAt/endsAt/xpMultiplier/isActive).
-- That is a code-only fix (app/api/admin/events/*) — no schema change needed for it.

ALTER TABLE platform_events
  ADD COLUMN IF NOT EXISTS recurrence_interval TEXT NOT NULL DEFAULT 'none';

ALTER TABLE platform_events
  ADD CONSTRAINT platform_events_recurrence_interval_check
  CHECK (recurrence_interval IN ('none', 'monthly', 'yearly'));

UPDATE platform_events
  SET recurrence_interval = 'yearly'
  WHERE is_recurring_annual = TRUE AND recurrence_interval = 'none';
