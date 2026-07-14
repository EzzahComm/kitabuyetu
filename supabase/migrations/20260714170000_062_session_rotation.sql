-- =============================================================================
-- 062_session_rotation.sql
-- Phase 3.2 of the payment architecture redesign (PAYMENT_ARCHITECTURE_REDESIGN.md
-- §2.3, §15.3, §15.5, §6e; ADR-20, ADR-25):
--
--   1. Refresh-token rotation with reuse detection: every refresh consumes the
--      presented token and issues a successor in the same lineage. A consumed
--      token presented again is replay — the whole lineage is revoked.
--      lineage_id groups a session's token chain; membership_id pins the
--      active membership to the session (§2.3).
--   2. journal_entries.posted_via — callback/job-posted entries are recorded
--      as the designated 'system' actor instead of an ambiguous NULL (§6e).
--      Existing NULL-creator entries are backfilled as 'system'.
--   3. groups.reallocation_approval_threshold — maker-checker configuration
--      (ADR-20). payment_reallocations.approved_by exists since 057; the
--      correction flow that enforces this threshold ships with the
--      reallocation feature.
-- =============================================================================

-- ─── 1. Refresh-token rotation ───────────────────────────────────────────────

-- DEFAULT gen_random_uuid(): rows inserted by pre-3.2 code (no explicit
-- lineage) each start their own lineage — correct semantics for login-created
-- rows, and NOT NULL is safe during the migration-first cutover window.
ALTER TABLE refresh_tokens
  ADD COLUMN lineage_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN consumed_at   TIMESTAMPTZ,
  ADD COLUMN membership_id UUID REFERENCES group_members (id);

CREATE INDEX idx_refresh_tokens_lineage ON refresh_tokens (lineage_id);

-- ─── 2. Journal system actor (§6e) ───────────────────────────────────────────

ALTER TABLE journal_entries
  ADD COLUMN posted_via TEXT NOT NULL DEFAULT 'user'
    CHECK (posted_via IN ('user', 'system'));

-- Entries posted by callbacks/jobs carry created_by NULL today — label them.
UPDATE journal_entries SET posted_via = 'system' WHERE created_by IS NULL;

-- ─── 3. Maker-checker threshold (ADR-20) ─────────────────────────────────────

ALTER TABLE groups
  ADD COLUMN reallocation_approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 10000
    CHECK (reallocation_approval_threshold >= 0);

COMMENT ON COLUMN groups.reallocation_approval_threshold IS
  'payment_reallocations above this amount require a second approver '
  '(approved_by, distinct officer). Enforced by the reallocation flow.';
