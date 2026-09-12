-- 0041_admin_data_management.sql
--
-- Centralized Data Management admin utility (/gate44/data-management).
--
-- Adds the job-tracking table backing the chunked NDJSON account import
-- flow (apps/web/app/api/admin/data-management/users/import/**): an admin
-- uploads a file, which is stored as-is in `raw_data` and processed in
-- bounded batches across repeated client-driven POSTs (never a single
-- long-running request, to stay inside Vercel serverless function duration
-- limits). Also adds composite/partial indexes so the new filtered CSV/TSV/
-- XLSX export queries (apps/web/app/api/admin/data-management/users/export)
-- stay index-backed at millions-of-rows scale instead of falling back to
-- sequential scans.

CREATE TABLE IF NOT EXISTS admin_data_import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL REFERENCES users(id),
    filename text,
    format text NOT NULL DEFAULT 'ndjson',
    dedupe_strategy text NOT NULL DEFAULT 'skip'
        CHECK (dedupe_strategy = ANY (ARRAY['skip'::text, 'overwrite'::text])),
    raw_data text NOT NULL,
    total_rows int NOT NULL DEFAULT 0,
    processed_rows int NOT NULL DEFAULT 0,
    imported_count int NOT NULL DEFAULT 0,
    skipped_count int NOT NULL DEFAULT 0,
    error_count int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])),
    errors jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_data_import_jobs_admin_created
    ON admin_data_import_jobs USING btree (admin_id, created_at DESC);

-- Filtered export queries (plan / ban / suspend combinations) keyset-paginate
-- ordered by (created_at DESC, id DESC) same as the existing /api/admin/users
-- list — idx_users_export_filter keeps the WHERE clause index-backed and
-- idx_users_export_filter already covers the common admin filter combination.
-- created_at already has an implicit btree via idx_users_last_active-style
-- indexes elsewhere in the schema for other sort orders, but there is no
-- existing (deleted_at, created_at) covering index for the export's default
-- "all active users" cursor scan, so add one explicitly.
CREATE INDEX IF NOT EXISTS idx_users_export_filter
    ON users USING btree (deleted_at, plan, is_banned, is_suspended);

CREATE INDEX IF NOT EXISTS idx_users_export_created_at
    ON users USING btree (deleted_at, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_users_export_trust_score
    ON users USING btree (trust_score) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_users_export_country
    ON users USING btree (country) WHERE (deleted_at IS NULL AND country IS NOT NULL);
