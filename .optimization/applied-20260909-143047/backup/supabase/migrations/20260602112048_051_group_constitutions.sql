-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602112048  name: 051_group_constitutions
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE group_constitutions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                UUID          NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  version                 INTEGER       NOT NULL DEFAULT 1,
  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
  effective_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  share_value             NUMERIC(15,2) NOT NULL DEFAULT 100  CHECK (share_value > 0),
  max_shares_per_week     INTEGER       NOT NULL DEFAULT 5    CHECK (max_shares_per_week > 0),
  welfare_amount          NUMERIC(15,2) NOT NULL DEFAULT 50   CHECK (welfare_amount >= 0),
  loan_interest_rate      NUMERIC(5,2)  NOT NULL DEFAULT 10   CHECK (loan_interest_rate >= 0),
  loan_interest_method    VARCHAR(20)   NOT NULL DEFAULT 'flat'
                            CHECK (loan_interest_method IN ('flat','reducing_balance')),
  loan_multiplier         NUMERIC(5,2)  NOT NULL DEFAULT 3    CHECK (loan_multiplier > 0),
  max_loan_term_months    INTEGER       NOT NULL DEFAULT 12   CHECK (max_loan_term_months > 0),
  quorum_percentage       INTEGER       NOT NULL DEFAULT 60
                            CHECK (quorum_percentage BETWEEN 1 AND 100),
  signatory_requirements  INTEGER       NOT NULL DEFAULT 3    CHECK (signatory_requirements >= 1),
  cycle_duration_weeks    INTEGER       NOT NULL DEFAULT 52   CHECK (cycle_duration_weeks > 0),
  fine_schedule           JSONB         NOT NULL
                            DEFAULT '{"late_attendance":50,"absence":100,"misconduct":200}'::jsonb,
  notes                   TEXT,
  created_by              UUID          REFERENCES members (id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_constitution_version UNIQUE (group_id, version)
);

CREATE UNIQUE INDEX uq_constitution_active ON group_constitutions (group_id) WHERE is_active;
CREATE INDEX idx_constitution_group ON group_constitutions (group_id, version DESC);

CREATE TRIGGER set_group_constitutions_updated_at
  BEFORE UPDATE ON group_constitutions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE OR REPLACE FUNCTION private.seed_default_constitution()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
BEGIN
  INSERT INTO public.group_constitutions (group_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_groups_seed_constitution
  AFTER INSERT ON groups
  FOR EACH ROW EXECUTE FUNCTION private.seed_default_constitution();

INSERT INTO group_constitutions (group_id)
SELECT g.id FROM groups g
WHERE NOT EXISTS (
  SELECT 1 FROM group_constitutions gc WHERE gc.group_id = g.id
);

ALTER TABLE group_constitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_constitutions FORCE  ROW LEVEL SECURITY;

CREATE POLICY group_constitutions_select ON group_constitutions
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY group_constitutions_modify ON group_constitutions
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'group_admin')
  );
