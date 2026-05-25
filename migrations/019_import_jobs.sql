-- =============================================================================
-- 019_import_jobs.sql
-- Phase E3 of the Member Onboarding refactor — bulk import infrastructure.
--
-- import_jobs tracks a two-phase CSV import (preview → commit) plus the
-- created row IDs so a job can be hard-rolled-back. Designed kind-agnostic
-- so later phases (E7 — historical financial data) can reuse the table.
--
-- Status transitions:
--   previewed   →  committed   (user confirmed; rows inserted)
--               →  cancelled   (user discarded preview)
--   committed   →  rolled_back (admin undid the import)
--   any         →  failed      (irrecoverable error during commit)
-- =============================================================================

CREATE TABLE import_jobs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID         NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  created_by       UUID         NOT NULL REFERENCES members (id) ON DELETE SET NULL,

  -- Kind of data being imported. VARCHAR + CHECK rather than an enum so
  -- adding new kinds in later phases (loans, contributions, welfare, ...)
  -- is a non-locking ALTER TABLE instead of ALTER TYPE.
  kind             VARCHAR(40)  NOT NULL,
  CONSTRAINT chk_import_kind CHECK (kind IN ('members')),

  -- Lifecycle. NULL committed_at / rolled_back_at means the corresponding
  -- step hasn't happened yet. Easier to introspect than a single state column.
  status           VARCHAR(20)  NOT NULL DEFAULT 'previewed',
  CONSTRAINT chk_import_status CHECK (
    status IN ('previewed', 'committed', 'cancelled', 'rolled_back', 'failed')
  ),

  filename         TEXT,                -- original upload filename, for UI display
  total_rows       INTEGER      NOT NULL DEFAULT 0,
  valid_rows       INTEGER      NOT NULL DEFAULT 0,
  error_rows       INTEGER      NOT NULL DEFAULT 0,

  -- Per-row validation errors gathered at preview, kept for the result page.
  -- Shape: [{ row: <line-no>, message: <text>, raw?: <object> }, ...]
  errors           JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Validated rows held server-side between preview and commit so the
  -- client doesn't have to re-upload the file. Cleared after commit/cancel
  -- to keep the table small.
  preview_rows     JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Member IDs created by the commit step. Used by rollback to DELETE
  -- precisely the rows that this job inserted (no broader blast radius).
  created_member_ids UUID[]     NOT NULL DEFAULT ARRAY[]::UUID[],

  -- Reason fields populated by the corresponding transitions.
  rollback_reason  TEXT,
  failure_reason   TEXT,

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  committed_at     TIMESTAMPTZ,
  rolled_back_at   TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,

  CONSTRAINT chk_row_counts_nonneg CHECK (
    total_rows >= 0 AND valid_rows >= 0 AND error_rows >= 0
  )
);

CREATE INDEX idx_import_jobs_group     ON import_jobs (group_id, created_at DESC);
CREATE INDEX idx_import_jobs_kind      ON import_jobs (group_id, kind, created_at DESC);
CREATE INDEX idx_import_jobs_status    ON import_jobs (status) WHERE status <> 'committed';
CREATE INDEX idx_import_jobs_creator   ON import_jobs (created_by, created_at DESC);

COMMENT ON TABLE import_jobs IS
  'Tracks bulk-import sessions for members (E3) and later historical financial data (E7). Two-phase: preview stores parsed+validated rows; commit applies them and records the created IDs for rollback.';

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE  ROW LEVEL SECURITY;

-- Anyone in the group can see import history (transparency on data ingest).
CREATE POLICY import_jobs_select ON import_jobs
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

-- Only group_admin / secretary / treasurer can create or mutate jobs.
-- (Treasurer included because financial-history imports in E7 will be
-- treasurer-driven; gate at the application layer for finer per-kind checks.)
CREATE POLICY import_jobs_modify ON import_jobs
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('group_admin', 'secretary', 'treasurer')
    )
  );
