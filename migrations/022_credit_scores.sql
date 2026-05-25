-- =============================================================================
-- 022_credit_scores.sql
-- Phase E6 (Part 1) — Credit scoring.
--
-- Append-only table holding per-member score snapshots. "Latest" is queried
-- with DISTINCT ON (member_id) ORDER BY computed_at DESC; history is just
-- the full result set for one member.
--
-- The components JSONB keeps scoring forward-compatible: adding/removing a
-- component or tuning a weight is a service-only change, no schema churn.
-- =============================================================================

CREATE TYPE credit_reliability_tier AS ENUM (
  'excellent',  -- ≥85
  'good',       -- 70-84
  'fair',       -- 55-69
  'poor',       -- 40-54
  'high_risk'   -- <40
);

CREATE TABLE credit_scores (
  id                      UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                UUID                    NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id               UUID                    NOT NULL REFERENCES members (id) ON DELETE CASCADE,

  computed_at             TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  computed_by             UUID                    REFERENCES members (id) ON DELETE SET NULL,
                          -- NULL = automated/scheduled (E6.2 will use this)

  -- Composite scores, each 0-100.
  financial_score         NUMERIC(5,2)            NOT NULL,
  social_score            NUMERIC(5,2)            NOT NULL DEFAULT 0,
  overall_score           NUMERIC(5,2)            NOT NULL,

  -- Per-component breakdown. Shape per key:
  --   { score: <0-100>, weight: <0-1>, raw: { <input metrics> } }
  -- Keeps the breakdown forward-compatible without schema churn.
  components              JSONB                   NOT NULL DEFAULT '{}'::jsonb,

  reliability_tier        credit_reliability_tier NOT NULL,
  loan_eligibility_limit  NUMERIC(15,2)           NOT NULL DEFAULT 0,

  notes                   TEXT,

  CONSTRAINT chk_score_financial  CHECK (financial_score >= 0 AND financial_score <= 100),
  CONSTRAINT chk_score_social     CHECK (social_score    >= 0 AND social_score    <= 100),
  CONSTRAINT chk_score_overall    CHECK (overall_score   >= 0 AND overall_score   <= 100),
  CONSTRAINT chk_score_eligibility CHECK (loan_eligibility_limit >= 0)
);

-- "Latest score per member" uses DISTINCT ON over this index.
CREATE INDEX idx_credit_scores_member_latest
  ON credit_scores (group_id, member_id, computed_at DESC);

CREATE INDEX idx_credit_scores_tier
  ON credit_scores (group_id, reliability_tier);

CREATE INDEX idx_credit_scores_overall
  ON credit_scores (group_id, overall_score DESC);

CREATE INDEX idx_credit_scores_computed_at
  ON credit_scores (group_id, computed_at DESC);

COMMENT ON TABLE credit_scores IS
  'Append-only per-member credit score snapshots. Query DISTINCT ON (member_id) ORDER BY computed_at DESC for the latest value. components JSONB holds the per-dimension breakdown so weights can evolve without schema changes.';

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_scores FORCE  ROW LEVEL SECURITY;

-- Read: anyone in the group can read score data (the data is about the
-- member's own behaviour — group-wide transparency mirrors how contributions
-- and shares are visible).
CREATE POLICY credit_scores_select ON credit_scores
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

-- Modify: only treasurer + group_admin can trigger recomputes (and that's
-- the only write path; the service uses INSERT, no updates needed).
CREATE POLICY credit_scores_modify ON credit_scores
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );
