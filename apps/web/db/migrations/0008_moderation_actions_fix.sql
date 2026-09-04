-- 0008_moderation_actions_fix.sql
--
-- Fixes two latent defects in moderation_actions (0001_consolidated_schema.sql)
-- that made every POST to /api/admin/moderation/[reportId]/action and
-- /api/admin/forum/queue/[reportId]/action fail:
--
-- 1. moderation_actions_report_id_fkey referenced `reports(id)`, a separate,
--    older report table still used for admin stats/trust-score aggregation
--    (lib/trust/trustScore.ts, cron/daily-*, admin/overview). Every action
--    route actually inserts the *current* moderation queue's report id —
--    moderation_reports(id) — so every insert violated the FK.
--
-- 2. moderation_actions_action_type_check only allowed 'warn' | 'suspend' |
--    'ban' | 'remove_content' | 'escalate' | 'dismiss', but both action
--    routes write the exact action names from their request schema —
--    'suspend_user' | 'ban_user' | 'escalate_ai' — which aren't in that list.
--    Widened (rather than renamed) to avoid a data migration for any rows
--    already written under the original names.

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_report_id_fkey;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_report_id_fkey
    FOREIGN KEY (report_id) REFERENCES moderation_reports(id) ON DELETE SET NULL;

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_action_type_check;
ALTER TABLE moderation_actions
    ADD CONSTRAINT moderation_actions_action_type_check
    CHECK (action_type = ANY (ARRAY[
        'warn'::text, 'suspend'::text, 'ban'::text, 'remove_content'::text,
        'escalate'::text, 'dismiss'::text,
        'suspend_user'::text, 'ban_user'::text, 'escalate_ai'::text
    ]));
