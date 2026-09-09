-- =============================================================================
-- 035_import_jobs.sql — mirror of canonical migrations/019_import_jobs.sql
-- Phase E3 — bulk import infrastructure (member CSV first; reusable for E7).
-- =============================================================================

CREATE TABLE import_jobs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID         NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  created_by       UUID         NOT NULL REFERENCES members (id) ON DELETE SET NULL,

  kind             VARCHAR(40)  NOT NULL,
  CONSTRAINT chk_import_kind CHECK (kind IN ('members')),

  status           VARCHAR(20)  NOT NULL DEFAULT 'previewed',
  CONSTRAINT chk_import_status CHECK (
    status IN ('previewed', 'committed', 'cancelled', 'rolled_back', 'failed')
  ),

  filename         TEXT,
  total_rows       INTEGER      NOT NULL DEFAULT 0,
  valid_rows       INTEGER      NOT NULL DEFAULT 0,
  error_rows       INTEGER      NOT NULL DEFAULT 0,

  errors           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  preview_rows     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_member_ids UUID[]     NOT NULL DEFAULT ARRAY[]::UUID[],

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

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE  ROW LEVEL SECURITY;

CREATE POLICY import_jobs_select ON import_jobs
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

CREATE POLICY import_jobs_modify ON import_jobs
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('group_admin', 'secretary', 'treasurer')
    )
  );
