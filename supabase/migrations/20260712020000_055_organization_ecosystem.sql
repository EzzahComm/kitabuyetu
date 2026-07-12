-- ============================================================================
-- 055 — Organization Financial Ecosystem (foundation)
--
-- Elevates Organizations from "group-like tenants" to ecosystem participants
-- that FUND, MONITOR and SUPPORT many groups without joining their governance:
--
--   Organization ──┬── organization_wallets        (one per org: money position)
--                  ├── organization_ledger         (append-only wallet ledger)
--                  ├── funding_programs            (budgeted funding envelopes)
--                  └── organization_disbursements  (org → group money movements,
--                                                   dual-ledger: org ledger +
--                                                   group journal entry)
--
-- Groups stay autonomous — a disbursement lands in the group's own books as a
-- posted journal entry (DR cash / CR external funding income), and the group
-- never gains access to the organization's wallet. organization_group_access
-- (many-to-many) remains the visibility + eligibility gate, so one group can
-- hold independent relationships with several organizations at once.
--
-- Extensibility: disbursement/program types are CHECK-constrained TEXT (not
-- enums) so later phases (loan products, insurance, investments) can widen
-- them without a table rewrite. Multi-currency: currency is carried per
-- wallet/ledger row, defaulting to KES.
-- ============================================================================

-- ─── Wallet ──────────────────────────────────────────────────────────────────

CREATE TABLE organization_wallets (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  currency          VARCHAR(3)    NOT NULL DEFAULT 'KES',
  -- available = spendable now; committed = earmarked to approved-but-unpaid
  -- disbursements; disbursed/returned are lifetime counters for reporting.
  available_balance NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  committed_balance NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (committed_balance >= 0),
  total_deposited   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_disbursed   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_returned    NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT organization_wallets_org_currency_unique UNIQUE (organization_id, currency)
);

CREATE TRIGGER trg_org_wallets_updated_at
  BEFORE UPDATE ON organization_wallets
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ─── Ledger (append-only) ────────────────────────────────────────────────────

CREATE TABLE organization_ledger (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  wallet_id        UUID          NOT NULL REFERENCES organization_wallets (id) ON DELETE RESTRICT,
  entry_type       VARCHAR(30)   NOT NULL CHECK (entry_type IN (
                     'deposit',        -- donor funding / capital in
                     'disbursement',   -- money out to a group
                     'return',         -- funds returned by a group
                     'commitment',     -- earmark: available → committed
                     'release',        -- un-earmark: committed → available
                     'interest',       -- interest earned on deployed capital
                     'fee',            -- platform / bank fees
                     'adjustment'      -- audited manual correction
                   )),
  direction        VARCHAR(6)    NOT NULL CHECK (direction IN ('credit','debit')),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  balance_after    NUMERIC(15,2) NOT NULL,
  currency         VARCHAR(3)    NOT NULL DEFAULT 'KES',
  funding_program_id UUID,         -- FK added below (table created next)
  group_id         UUID          REFERENCES groups (id) ON DELETE RESTRICT,
  disbursement_id  UUID,           -- FK added below
  reference        VARCHAR(64),
  description      TEXT,
  created_by       UUID          REFERENCES members (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_ledger_org      ON organization_ledger (organization_id, created_at DESC);
CREATE INDEX idx_org_ledger_program  ON organization_ledger (funding_program_id)
  WHERE funding_program_id IS NOT NULL;
CREATE INDEX idx_org_ledger_group    ON organization_ledger (group_id) WHERE group_id IS NOT NULL;

-- ─── Funding programs ────────────────────────────────────────────────────────

CREATE TABLE funding_programs (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name                 VARCHAR(160)  NOT NULL,
  program_type         VARCHAR(30)   NOT NULL DEFAULT 'grant' CHECK (program_type IN (
                         'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
                         'seed_capital', 'emergency_support', 'operational_support',
                         'scholarship', 'insurance', 'investment'
                       )),
  funding_source       VARCHAR(160),
  description          TEXT,
  budget               NUMERIC(15,2) NOT NULL CHECK (budget > 0),
  disbursed_total      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (disbursed_total >= 0),
  currency             VARCHAR(3)    NOT NULL DEFAULT 'KES',
  -- Structured criteria/coverage as JSONB so each program type can carry its
  -- own shape (min members, counties, age bands, …) without schema churn.
  eligibility_criteria JSONB         NOT NULL DEFAULT '{}'::jsonb,
  geographic_coverage  JSONB         NOT NULL DEFAULT '[]'::jsonb,
  reporting_requirements TEXT,
  starts_on            DATE,
  ends_on              DATE,
  status               VARCHAR(20)   NOT NULL DEFAULT 'active'
                         CHECK (status IN ('draft','active','paused','closed')),
  created_by           UUID          REFERENCES members (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT funding_programs_dates_valid CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT funding_programs_budget_not_exceeded CHECK (disbursed_total <= budget)
);

CREATE INDEX idx_funding_programs_org ON funding_programs (organization_id, status);

CREATE TRIGGER trg_funding_programs_updated_at
  BEFORE UPDATE ON funding_programs
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE organization_ledger
  ADD CONSTRAINT organization_ledger_program_fk
  FOREIGN KEY (funding_program_id) REFERENCES funding_programs (id) ON DELETE RESTRICT;

-- ─── Disbursements (org → group) ─────────────────────────────────────────────

CREATE TABLE organization_disbursements (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  wallet_id              UUID          NOT NULL REFERENCES organization_wallets (id) ON DELETE RESTRICT,
  funding_program_id     UUID          REFERENCES funding_programs (id) ON DELETE RESTRICT,
  group_id               UUID          NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  disbursement_type      VARCHAR(30)   NOT NULL DEFAULT 'grant' CHECK (disbursement_type IN (
                           'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
                           'seed_capital', 'emergency_support', 'operational_support'
                         )),
  amount                 NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency               VARCHAR(3)    NOT NULL DEFAULT 'KES',
  status                 VARCHAR(20)   NOT NULL DEFAULT 'completed'
                           CHECK (status IN ('pending_approval','approved','completed','returned','cancelled')),
  reference              VARCHAR(64)   NOT NULL UNIQUE,   -- unique, replay-safe
  notes                  TEXT,
  -- Cross-links for reconciliation: the org-side ledger row and the
  -- group-side journal entry this disbursement produced.
  ledger_entry_id        UUID          REFERENCES organization_ledger (id) ON DELETE SET NULL,
  group_journal_entry_id UUID,          -- journal_entries lives per-group; soft link
  approved_by            UUID          REFERENCES members (id) ON DELETE SET NULL,
  created_by             UUID          REFERENCES members (id) ON DELETE SET NULL,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_disb_org     ON organization_disbursements (organization_id, created_at DESC);
CREATE INDEX idx_org_disb_group   ON organization_disbursements (group_id, created_at DESC);
CREATE INDEX idx_org_disb_program ON organization_disbursements (funding_program_id)
  WHERE funding_program_id IS NOT NULL;

CREATE TRIGGER trg_org_disb_updated_at
  BEFORE UPDATE ON organization_disbursements
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE organization_ledger
  ADD CONSTRAINT organization_ledger_disbursement_fk
  FOREIGN KEY (disbursement_id) REFERENCES organization_disbursements (id) ON DELETE RESTRICT;

-- ─── Group-side chart account for external funding ──────────────────────────
-- Disbursements credit a dedicated income account in the group's chart so
-- external capital is never mistaken for member contributions. Seed it for
-- every existing group; accounting.service seeds it for new groups.

INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '4005', 'External Funding', 'income', true
FROM groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE organization_wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_ledger        ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_programs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_disbursements ENABLE ROW LEVEL SECURITY;

ALTER TABLE organization_wallets       FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_ledger        FORCE ROW LEVEL SECURITY;
ALTER TABLE funding_programs           FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_disbursements FORCE ROW LEVEL SECURITY;

-- Coordinators see and manage only their own organization's rows.
CREATE POLICY organization_wallets_all ON organization_wallets
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_ledger_all ON organization_ledger
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY funding_programs_all ON funding_programs
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_disbursements_all ON organization_disbursements
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

-- Group officers may READ disbursements addressed to their group (it is their
-- money trail too) — but never the organization's wallet or ledger.
CREATE POLICY organization_disbursements_group_select ON organization_disbursements
  FOR SELECT USING (group_id = app_current_group_id());

-- ─── Wallet bootstrap ────────────────────────────────────────────────────────

INSERT INTO organization_wallets (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id, currency) DO NOTHING;
