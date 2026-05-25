-- =============================================================================
-- 038_credit_scores.sql — mirror of canonical migrations/022_credit_scores.sql
-- Phase E6 (Part 1) — Credit scoring.
-- =============================================================================

CREATE TYPE credit_reliability_tier AS ENUM (
  'excellent', 'good', 'fair', 'poor', 'high_risk'
);

CREATE TABLE credit_scores (
  id                      UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                UUID                    NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id               UUID                    NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  computed_at             TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  computed_by             UUID                    REFERENCES members (id) ON DELETE SET NULL,
  financial_score         NUMERIC(5,2)            NOT NULL,
  social_score            NUMERIC(5,2)            NOT NULL DEFAULT 0,
  overall_score           NUMERIC(5,2)            NOT NULL,
  components              JSONB                   NOT NULL DEFAULT '{}'::jsonb,
  reliability_tier        credit_reliability_tier NOT NULL,
  loan_eligibility_limit  NUMERIC(15,2)           NOT NULL DEFAULT 0,
  notes                   TEXT,
  CONSTRAINT chk_score_financial   CHECK (financial_score >= 0 AND financial_score <= 100),
  CONSTRAINT chk_score_social      CHECK (social_score    >= 0 AND social_score    <= 100),
  CONSTRAINT chk_score_overall     CHECK (overall_score   >= 0 AND overall_score   <= 100),
  CONSTRAINT chk_score_eligibility CHECK (loan_eligibility_limit >= 0)
);

CREATE INDEX idx_credit_scores_member_latest ON credit_scores (group_id, member_id, computed_at DESC);
CREATE INDEX idx_credit_scores_tier          ON credit_scores (group_id, reliability_tier);
CREATE INDEX idx_credit_scores_overall       ON credit_scores (group_id, overall_score DESC);
CREATE INDEX idx_credit_scores_computed_at   ON credit_scores (group_id, computed_at DESC);

ALTER TABLE credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_scores FORCE  ROW LEVEL SECURITY;

CREATE POLICY credit_scores_select ON credit_scores
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY credit_scores_modify ON credit_scores
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer')));
