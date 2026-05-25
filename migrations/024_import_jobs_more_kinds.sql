-- =============================================================================
-- 024_import_jobs_more_kinds.sql
-- Phase E7 (Part 1) — extend import_jobs.kind to cover financial-history
-- imports. The original CHECK from mig 019 allowed only 'members'; this
-- broadens it to include contributions + loans. E7.2 will add loan_repayments,
-- welfare, investments, shares.
--
-- Drop+recreate the CHECK (rather than ALTER TYPE for an enum) keeps the
-- schema cheap to extend later — exactly the trade-off documented in
-- mig 019's comments.
-- =============================================================================

ALTER TABLE import_jobs DROP CONSTRAINT chk_import_kind;

ALTER TABLE import_jobs
  ADD CONSTRAINT chk_import_kind CHECK (kind IN (
    'members',
    'contributions',
    'loans'
  ));
