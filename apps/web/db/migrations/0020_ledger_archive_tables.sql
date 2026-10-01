-- Migration 0020: missing archive tables for /api/cron/archive-ledgers
--
-- The ledger archive CRON moves old rows out of the hot tables into
-- *_archive tables. Two of its targets were never created, so the job failed
-- with "column created_at does not exist" / "relation does not exist" before
-- archiving anything:
--
--   audit_discrepancies_archive  resolved balance-reconciliation findings
--                                (source keys its age on detected_at)
--   rank_up_events_archive       processed rank-up events
--
-- Both are internal (written and read only by the server through the
-- service connection), so per the Supabase Data-API rule they get explicit
-- GRANTs for service_role only and RLS with no anon/authenticated policies.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_discrepancies_archive (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    asset_type text NOT NULL,
    ledger_sum bigint NOT NULL,
    wallet_balance bigint NOT NULL,
    detected_at timestamp with time zone,
    resolved boolean NOT NULL DEFAULT false,
    resolved_at timestamp with time zone,
    notes text,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor=100);

CREATE INDEX IF NOT EXISTS idx_audit_discrepancies_archive_user
    ON public.audit_discrepancies_archive USING btree (user_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS rank_up_events_archive (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    rank_from text,
    rank_to text,
    xp_at_event bigint,
    created_at timestamp with time zone,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor=100);

CREATE INDEX IF NOT EXISTS idx_rank_up_events_archive_user
    ON public.rank_up_events_archive USING btree (user_id, created_at DESC);

-- Age lookups the CRON runs in batches on the source tables.
CREATE INDEX IF NOT EXISTS idx_audit_discrepancies_resolved_detected
    ON public.audit_discrepancies USING btree (detected_at)
    WHERE resolved = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_discrepancies_archive TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rank_up_events_archive TO service_role;

ALTER TABLE audit_discrepancies_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_up_events_archive ENABLE ROW LEVEL SECURITY;

COMMIT;
