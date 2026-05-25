-- =============================================================================
-- 021_dividends.sql
-- Phase E5 (Part 1) — Dividend management.
--
-- Concepts:
--   • dividend_declarations  — header for a fiscal-period payout pool
--   • dividend_allocations   — per-member computed share, persisted at approval
--   • Policy types in this phase: proportional_to_shares, flat_per_member.
--     'weighted' is reserved for E5.2.
--   • Status flow: draft → pending_approval → approved → paid.
--     Cancellation possible from any pre-paid state.
--   • Holdings snapshot taken at approval time (not declaration time) so the
--     pool reflects the latest membership when the board signs off.
-- =============================================================================

CREATE TYPE dividend_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'paid', 'cancelled'
);

CREATE TYPE dividend_policy_type AS ENUM (
  'proportional_to_shares',
  'flat_per_member',
  'weighted'      -- reserved for E5.2; current service rejects this value
);

CREATE TYPE dividend_alloc_status AS ENUM (
  'pending', 'paid', 'reinvested', 'cancelled'
);

-- ─── Declarations ─────────────────────────────────────────────────────────

CREATE TABLE dividend_declarations (
  id                    UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID                  NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  period_label          VARCHAR(60)           NOT NULL,   -- 'FY 2025', 'Q2 2026'
  period_start          DATE                  NOT NULL,
  period_end            DATE                  NOT NULL,

  pool_amount           NUMERIC(15,2)         NOT NULL,
  policy_type           dividend_policy_type  NOT NULL DEFAULT 'proportional_to_shares',
  policy_config         JSONB                 NOT NULL DEFAULT '{}'::jsonb,

  -- Empty array = all active share classes count. Non-empty = only listed
  -- classes contribute to the per-member shares snapshot. Stored as text[]
  -- of UUIDs because PostgreSQL UUID arrays are awkward to bind in pg.
  share_class_ids       UUID[]                NOT NULL DEFAULT ARRAY[]::UUID[],

  withholding_tax_rate  NUMERIC(5,4)          NOT NULL DEFAULT 0,
                                              -- 0.0500 = 5%

  status                dividend_status       NOT NULL DEFAULT 'draft',
  notes                 TEXT,

  -- Persisted totals — kept in sync by the service whenever allocations
  -- are computed or payments land. The status workflow ensures these are
  -- meaningful only from 'approved' onward.
  total_eligible_members INTEGER              NOT NULL DEFAULT 0,
  total_shares_snapshot  BIGINT               NOT NULL DEFAULT 0,
  total_allocated        NUMERIC(15,2)        NOT NULL DEFAULT 0,
  total_tax              NUMERIC(15,2)        NOT NULL DEFAULT 0,
  total_paid             NUMERIC(15,2)        NOT NULL DEFAULT 0,

  declared_by            UUID                 NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  declared_at            TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  approved_by            UUID                 REFERENCES members (id) ON DELETE SET NULL,
  approved_at            TIMESTAMPTZ,
  snapshot_at            TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  cancelled_by           UUID                 REFERENCES members (id) ON DELETE SET NULL,
  cancelled_at           TIMESTAMPTZ,
  cancellation_reason    TEXT,

  CONSTRAINT chk_dividend_period       CHECK (period_end >= period_start),
  CONSTRAINT chk_dividend_pool         CHECK (pool_amount > 0),
  CONSTRAINT chk_dividend_tax_rate     CHECK (withholding_tax_rate >= 0 AND withholding_tax_rate < 1),
  CONSTRAINT chk_dividend_totals_nonneg CHECK (
    total_eligible_members >= 0 AND total_shares_snapshot >= 0
    AND total_allocated >= 0 AND total_tax >= 0 AND total_paid >= 0
  )
);

CREATE INDEX idx_dividend_decl_group       ON dividend_declarations (group_id, declared_at DESC);
CREATE INDEX idx_dividend_decl_status      ON dividend_declarations (group_id, status, declared_at DESC);
CREATE INDEX idx_dividend_decl_period      ON dividend_declarations (group_id, period_start, period_end);
CREATE INDEX idx_dividend_decl_declared_by ON dividend_declarations (declared_by);

COMMENT ON TABLE dividend_declarations IS
  'Per-period dividend pool declarations. Allocations to members are computed at approval time using the policy + holdings snapshot.';

-- ─── Allocations ──────────────────────────────────────────────────────────

CREATE TABLE dividend_allocations (
  id                  UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id      UUID                   NOT NULL REFERENCES dividend_declarations (id) ON DELETE CASCADE,
  group_id            UUID                   NOT NULL REFERENCES groups   (id) ON DELETE CASCADE,
  member_id           UUID                   NOT NULL REFERENCES members  (id) ON DELETE RESTRICT,

  -- Snapshot fields captured at approval. shares_held is total across all
  -- eligible classes for this declaration; weight_factor is for 'weighted'
  -- policy (defaults to 1 for proportional / flat).
  shares_held         INTEGER                NOT NULL DEFAULT 0,
  weight_factor       NUMERIC(15,6)          NOT NULL DEFAULT 1,

  gross_amount        NUMERIC(15,2)          NOT NULL,
  tax_amount          NUMERIC(15,2)          NOT NULL DEFAULT 0,
  net_amount          NUMERIC(15,2)          NOT NULL,

  status              dividend_alloc_status  NOT NULL DEFAULT 'pending',

  payment_method      VARCHAR(40),           -- 'mpesa' | 'cash' | 'bank_transfer' | 'cheque' | 'other'
  payment_reference   VARCHAR(80),
  paid_at             TIMESTAMPTZ,
  paid_by             UUID                   REFERENCES members (id) ON DELETE SET NULL,

  -- For Part 2: when 'reinvested', references the share_transactions row
  -- (type='allocation') that consumed this dividend. Nullable for now.
  reinvested_txn_id   UUID                   REFERENCES share_transactions (id),

  notes               TEXT,
  created_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_alloc_one_per_member UNIQUE (declaration_id, member_id),
  CONSTRAINT chk_alloc_gross_nonneg  CHECK (gross_amount >= 0),
  CONSTRAINT chk_alloc_tax_nonneg    CHECK (tax_amount   >= 0),
  CONSTRAINT chk_alloc_net_nonneg    CHECK (net_amount   >= 0),
  -- Identity invariant: net + tax = gross (within 0.01 to absorb rounding).
  CONSTRAINT chk_alloc_net_eq_gross_minus_tax
    CHECK (abs((gross_amount - tax_amount) - net_amount) <= 0.01)
);

CREATE INDEX idx_alloc_declaration ON dividend_allocations (declaration_id, status);
CREATE INDEX idx_alloc_member      ON dividend_allocations (member_id,    created_at DESC);
CREATE INDEX idx_alloc_group       ON dividend_allocations (group_id,     created_at DESC);
CREATE INDEX idx_alloc_status      ON dividend_allocations (declaration_id, status) WHERE status = 'pending';

COMMENT ON TABLE dividend_allocations IS
  'Per-member computed dividend share for a declaration. Persisted only after the declaration is approved.';

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE dividend_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_declarations FORCE  ROW LEVEL SECURITY;
ALTER TABLE dividend_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_allocations  FORCE  ROW LEVEL SECURITY;

-- Read: anyone in the group can see dividend history (transparency).
CREATE POLICY dividend_decl_select ON dividend_declarations
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY dividend_alloc_select ON dividend_allocations
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

-- Modify: treasurer + group_admin can manage declarations and allocations.
-- The approval-step role gate (group_admin only) is enforced at the API
-- layer where the verb is meaningful; the RLS policy is the broad fence.
CREATE POLICY dividend_decl_modify ON dividend_declarations
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );

CREATE POLICY dividend_alloc_modify ON dividend_allocations
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer'))
  );
