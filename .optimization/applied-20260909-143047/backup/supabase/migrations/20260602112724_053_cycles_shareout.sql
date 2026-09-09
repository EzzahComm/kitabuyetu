-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602112724  name: 053_cycles_shareout
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TYPE cycle_status AS ENUM ('active', 'closed');

CREATE TABLE cycles (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID          NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  cycle_number        INTEGER       NOT NULL,
  start_date          DATE          NOT NULL,
  end_date            DATE          NOT NULL,
  status              cycle_status  NOT NULL DEFAULT 'active',
  net_surplus         NUMERIC(15,2) NOT NULL DEFAULT 0,
  share_value_snapshot NUMERIC(15,2),
  total_share_fund    NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_payout        NUMERIC(15,2) NOT NULL DEFAULT 0,
  member_count        INTEGER       NOT NULL DEFAULT 0,
  notes               TEXT,
  closed_by           UUID          REFERENCES members (id) ON DELETE SET NULL,
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cycle_number UNIQUE (group_id, cycle_number),
  CONSTRAINT chk_cycle_period CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX uq_cycle_active ON cycles (group_id) WHERE status = 'active';
CREATE INDEX idx_cycles_group ON cycles (group_id, cycle_number DESC);

CREATE TABLE cycle_shareouts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        UUID          NOT NULL REFERENCES cycles  (id) ON DELETE CASCADE,
  group_id        UUID          NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id       UUID          NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  savings_base    NUMERIC(15,2) NOT NULL DEFAULT 0,
  share_count     NUMERIC(15,4) NOT NULL DEFAULT 0,
  payout_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','reinvested')),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shareout_member UNIQUE (cycle_id, member_id),
  CONSTRAINT chk_shareout_nonneg CHECK (savings_base >= 0 AND payout_amount >= 0)
);
CREATE INDEX idx_shareout_cycle  ON cycle_shareouts (cycle_id);
CREATE INDEX idx_shareout_member ON cycle_shareouts (member_id, created_at DESC);

CREATE TRIGGER set_cycles_updated_at
  BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE cycles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycles          FORCE  ROW LEVEL SECURITY;
ALTER TABLE cycle_shareouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_shareouts FORCE  ROW LEVEL SECURITY;

CREATE POLICY cycles_select ON cycles
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY cycles_modify ON cycles
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin','treasurer'))
  );

CREATE POLICY shareouts_select ON cycle_shareouts
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY shareouts_modify ON cycle_shareouts
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin','treasurer'))
  );
