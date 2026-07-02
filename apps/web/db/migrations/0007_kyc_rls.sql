-- ---------------------------------------------------------------------------
-- Row-level security for the identity KYC (Tiers 1-3) PII tables.
--
-- kyc_submissions/kyc_documents (added in 0005_kyc_verification.sql) never
-- had RLS enabled, unlike the pre-existing creator_kyc table which carries
-- BVN/PII of the same sensitivity. The app's own queries reach the database
-- through a pooled role with BYPASSRLS (same as every other RLS-protected
-- table here — see creator_kyc in 0001_consolidated_schema.sql), so this is
-- defense-in-depth against any other access path (e.g. direct PostgREST/
-- Supabase access with the anon/authenticated key), not something app code
-- needs to satisfy. Mirrors creator_kyc_self_or_admin exactly.
-- ---------------------------------------------------------------------------

ALTER TABLE kyc_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_submissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_submissions_self_or_admin ON kyc_submissions;
CREATE POLICY kyc_submissions_self_or_admin ON kyc_submissions
  USING (
    (user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid)
    OR (current_setting('app.is_admin', true) = 'true')
    OR (current_setting('app.is_system', true) = 'true')
  );

ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_documents_self_or_admin ON kyc_documents;
CREATE POLICY kyc_documents_self_or_admin ON kyc_documents
  USING (
    (user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid)
    OR (current_setting('app.is_admin', true) = 'true')
    OR (current_setting('app.is_system', true) = 'true')
  );
