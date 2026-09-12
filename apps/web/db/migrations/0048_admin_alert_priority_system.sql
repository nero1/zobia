-- 0048_admin_alert_priority_system.sql
--
-- Professional-grade 6-level admin/mod alert & notification system.
--
-- Extends the existing `system_alerts` table (previously 3 severities:
-- info/warning/critical) with a granular 1-6 priority scale, category-based
-- audience routing (admin-only for financial alerts vs admin+mods for
-- site/security alerts), and escalation tracking so Level 1/2 alerts can
-- repeat on an hour-based backoff schedule until resolved (see
-- lib/alerts/dispatch.ts and app/api/cron/alert-escalation/route.ts).
--
-- `severity` is kept for backward compatibility with the ~20 existing call
-- sites that still write it directly; `priority_level` is the new source of
-- truth for routing/escalation and defaults from `severity` via trigger so
-- unmigrated call sites keep working without code changes.

-- ---------------------------------------------------------------------------
-- system_alerts: new columns
-- ---------------------------------------------------------------------------

ALTER TABLE system_alerts
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS priority_level smallint,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS notify_admin boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_mods boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channels_sent jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS escalation_stage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_cycle integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_phase text NOT NULL DEFAULT 'backoff',
  ADD COLUMN IF NOT EXISTS escalation_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_escalation_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS first_notified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS sms_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN system_alerts.priority_level IS 'ZB-ALERT-01: 1=Critical .. 6=Low. See lib/alerts/types.ts ALERT_PRIORITY_LEVELS. Defaults from legacy severity via trigger below.';
COMMENT ON COLUMN system_alerts.category IS 'Routing category: site, security, financial, moderation, infra, other. Financial alerts are admin-only regardless of level.';
COMMENT ON COLUMN system_alerts.escalation_phase IS 'backoff (hour-based schedule) -> daily -> weekly -> stopped.';
COMMENT ON COLUMN system_alerts.dedupe_key IS 'Optional caller-supplied key (e.g. cluster key for report spikes) used to fold repeat triggers into the same open alert instead of creating duplicates.';

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_severity_check;
ALTER TABLE system_alerts
  ADD CONSTRAINT system_alerts_severity_check
  CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]));

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_priority_level_check;
ALTER TABLE system_alerts
  ADD CONSTRAINT system_alerts_priority_level_check
  CHECK (priority_level IS NULL OR (priority_level BETWEEN 1 AND 6));

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_category_check;
ALTER TABLE system_alerts
  ADD CONSTRAINT system_alerts_category_check
  CHECK (category = ANY (ARRAY['site'::text, 'security'::text, 'financial'::text, 'moderation'::text, 'infra'::text, 'other'::text]));

ALTER TABLE system_alerts DROP CONSTRAINT IF EXISTS system_alerts_escalation_phase_check;
ALTER TABLE system_alerts
  ADD CONSTRAINT system_alerts_escalation_phase_check
  CHECK (escalation_phase = ANY (ARRAY['backoff'::text, 'daily'::text, 'weekly'::text, 'stopped'::text]));

-- Backfill + auto-default priority_level from legacy severity for rows/callers
-- that don't set it explicitly (critical=2, warning=4, info=6 — deliberately
-- conservative defaults; Level 1 is reserved for alerts that explicitly opt in
-- via raiseAlert() since it triggers SMS + the full escalation schedule).
CREATE OR REPLACE FUNCTION system_alerts_default_priority() RETURNS trigger AS $$
BEGIN
  IF NEW.priority_level IS NULL THEN
    NEW.priority_level := CASE NEW.severity
      WHEN 'critical' THEN 2
      WHEN 'warning'  THEN 4
      ELSE 6
    END;
  END IF;
  IF NEW.title IS NULL THEN
    NEW.title := initcap(replace(NEW.type, '_', ' '));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_alerts_default_priority ON system_alerts;
CREATE TRIGGER trg_system_alerts_default_priority
  BEFORE INSERT ON system_alerts
  FOR EACH ROW EXECUTE FUNCTION system_alerts_default_priority();

UPDATE system_alerts SET priority_level = CASE severity
    WHEN 'critical' THEN 2
    WHEN 'warning'  THEN 4
    ELSE 6
  END
  WHERE priority_level IS NULL;

UPDATE system_alerts SET title = initcap(replace(type, '_', ' ')) WHERE title IS NULL;

ALTER TABLE system_alerts ALTER COLUMN priority_level SET NOT NULL;
ALTER TABLE system_alerts ALTER COLUMN title SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_system_alerts_priority
  ON system_alerts (priority_level, created_at DESC)
  WHERE resolved = false;

-- Escalation cron polls exactly this: unresolved, still escalating, due now.
CREATE INDEX IF NOT EXISTS idx_system_alerts_escalation_due
  ON system_alerts (next_escalation_at)
  WHERE resolved = false AND escalation_complete = false AND next_escalation_at IS NOT NULL;

-- Dedupe lookups (fold repeat triggers, e.g. report-spike per cluster, into
-- the same open alert instead of spamming a new row each time).
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_alerts_dedupe_open
  ON system_alerts (type, dedupe_key)
  WHERE resolved = false AND dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- alert_notification_log: per-channel delivery audit + escalation dedupe
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alert_notification_log (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES system_alerts(id) ON DELETE CASCADE,
  escalation_stage integer NOT NULL DEFAULT 0,
  channel text NOT NULL,
  recipient_type text NOT NULL,
  recipient_user_id uuid,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT alert_notification_log_channel_check
    CHECK (channel = ANY (ARRAY['sms'::text, 'email'::text, 'telegram'::text, 'push'::text, 'in_app'::text])),
  CONSTRAINT alert_notification_log_recipient_type_check
    CHECK (recipient_type = ANY (ARRAY['admin'::text, 'moderator'::text])),
  CONSTRAINT alert_notification_log_status_check
    CHECK (status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text]))
);

CREATE INDEX IF NOT EXISTS idx_alert_notification_log_alert
  ON alert_notification_log (alert_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- staff_alert_contacts: admin/mod SMS numbers, opt-in, kept separate from the
-- `users` table because the platform otherwise has an explicit no-phone-
-- number/no-SMS policy (PRD §16, §22) — this is a deliberate, narrow
-- exception for operational alerting only, never used for auth or user-facing
-- messaging.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_alert_contacts (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_number text,
  sms_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_alert_contacts_user ON staff_alert_contacts (user_id);

-- Supports the sitewide report-velocity spike check in
-- app/api/cron/alert-escalation/route.ts (COUNT(*) WHERE created_at > NOW() - 1h).
CREATE INDEX IF NOT EXISTS idx_moderation_report_reporters_created_at
  ON moderation_report_reporters (created_at);

-- ---------------------------------------------------------------------------
-- x_manifest seed rows — admin-editable at /gate44/alerts/settings.
-- Must exist as rows (not just code defaults) because PUT /api/admin/config/[key]
-- rejects keys that aren't already present in x_manifest.
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
    ('alert_level_1_channel_sms', 'true', 'Level 1 (Critical) alerts send SMS.'),
    ('alert_level_1_channel_email', 'true', 'Level 1 (Critical) alerts send email.'),
    ('alert_level_1_channel_telegram', 'true', 'Level 1 (Critical) alerts send Telegram.'),
    ('alert_level_1_channel_push', 'true', 'Level 1 (Critical) alerts send push notifications.'),
    ('alert_level_1_channel_in_app', 'true', 'Level 1 (Critical) alerts show an in-app notification.'),
    ('alert_level_2_channel_sms', 'true', 'Level 2 (Urgent Emergency) alerts send SMS.'),
    ('alert_level_2_channel_email', 'true', 'Level 2 (Urgent Emergency) alerts send email.'),
    ('alert_level_2_channel_telegram', 'true', 'Level 2 (Urgent Emergency) alerts send Telegram.'),
    ('alert_level_2_channel_push', 'true', 'Level 2 (Urgent Emergency) alerts send push notifications.'),
    ('alert_level_2_channel_in_app', 'true', 'Level 2 (Urgent Emergency) alerts show an in-app notification.'),
    ('alert_level_3_channel_sms', 'false', 'Level 3 (Top Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.'),
    ('alert_level_3_channel_email', 'true', 'Level 3 (Top Priority) alerts send email.'),
    ('alert_level_3_channel_telegram', 'true', 'Level 3 (Top Priority) alerts send Telegram.'),
    ('alert_level_3_channel_push', 'true', 'Level 3 (Top Priority) alerts send push notifications.'),
    ('alert_level_3_channel_in_app', 'true', 'Level 3 (Top Priority) alerts show an in-app notification.'),
    ('alert_level_4_channel_sms', 'false', 'Level 4 (High Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.'),
    ('alert_level_4_channel_email', 'false', 'Level 4 (High Priority) alerts send email.'),
    ('alert_level_4_channel_telegram', 'true', 'Level 4 (High Priority) alerts send Telegram.'),
    ('alert_level_4_channel_push', 'true', 'Level 4 (High Priority) alerts send push notifications.'),
    ('alert_level_4_channel_in_app', 'true', 'Level 4 (High Priority) alerts show an in-app notification.'),
    ('alert_level_5_channel_sms', 'false', 'Level 5 (Medium Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.'),
    ('alert_level_5_channel_email', 'false', 'Level 5 (Medium Priority) alerts send email.'),
    ('alert_level_5_channel_telegram', 'true', 'Level 5 (Medium Priority) alerts send Telegram.'),
    ('alert_level_5_channel_push', 'false', 'Level 5 (Medium Priority) alerts send push notifications.'),
    ('alert_level_5_channel_in_app', 'true', 'Level 5 (Medium Priority) alerts show an in-app notification.'),
    ('alert_level_6_channel_sms', 'false', 'Level 6 (Low Priority) alerts send SMS. SMS is hard-disabled above Level 2 regardless of this flag.'),
    ('alert_level_6_channel_email', 'false', 'Level 6 (Low Priority) alerts send email.'),
    ('alert_level_6_channel_telegram', 'false', 'Level 6 (Low Priority) alerts send Telegram.'),
    ('alert_level_6_channel_push', 'false', 'Level 6 (Low Priority) alerts send push notifications.'),
    ('alert_level_6_channel_in_app', 'true', 'Level 6 (Low Priority) alerts show an in-app notification.'),
    ('alert_level1_escalation_schedule', '1,2,4,8,16,32', 'Level 1 hour-offsets for each re-notification stage within one backoff cycle, comma-separated.'),
    ('alert_level1_escalation_cycles', '3', 'How many times the Level 1 backoff schedule repeats before switching to daily paging.'),
    ('alert_level1_daily_phase_days', '7', 'Days Level 1 pages once/day after backoff cycles are exhausted, before switching to weekly.'),
    ('alert_level1_weekly_phase_weeks', '52', 'Weeks Level 1 pages once/week after the daily phase, before escalation stops permanently.'),
    ('alert_level2_escalation_schedule', '1,2,4,8,16,32', 'Level 2 hour-offsets for each re-notification stage within one backoff cycle, comma-separated.'),
    ('alert_level2_escalation_cycles', '1', 'How many times the Level 2 backoff schedule repeats before switching to daily paging.'),
    ('alert_level2_daily_phase_days', '3', 'Days Level 2 pages once/day after backoff cycles are exhausted, before switching to weekly.'),
    ('alert_level2_weekly_phase_weeks', '0', 'Weeks Level 2 pages once/week after the daily phase. 0 = stop after the daily phase.'),
    ('alert_report_spike_level5_threshold', '5', 'Distinct reporters on one content cluster that raises a Level 5 (Medium) mass-report alert.'),
    ('alert_report_spike_level4_threshold', '15', 'Distinct reporters on one content cluster that raises a Level 4 (High) mass-report alert.'),
    ('alert_report_spike_level3_threshold', '40', 'Distinct reporters on one content cluster that raises a Level 3 (Top Priority) mass-report alert.'),
    ('alert_report_spike_level2_velocity_threshold', '100', 'Sitewide reports across ALL targets in the last hour that suggests brigading/an attack and raises a Level 2 alert to admins+mods.'),
    ('alert_notify_mods_infra_other', 'false', 'Whether moderators (not just admins) are notified for infra/other-category alerts. Site/security/moderation alerts always notify mods; financial alerts never do.'),
    ('alert_sms_provider', 'termii', 'Active SMS provider key for Level 1/2 alert paging (see lib/notifications/sms.ts).')
ON CONFLICT (key) DO NOTHING;
