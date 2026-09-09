-- =============================================================================
-- 040_import_jobs_more_kinds.sql — mirror of canonical migrations/024.
-- Phase E7 (Part 1) — extend import_jobs.kind to 'contributions' + 'loans'.
-- =============================================================================

ALTER TABLE import_jobs DROP CONSTRAINT chk_import_kind;

ALTER TABLE import_jobs
  ADD CONSTRAINT chk_import_kind CHECK (kind IN (
    'members', 'contributions', 'loans'
  ));
