-- Organization-level chart of accounts (ACCOUNTING_ARCHITECTURE_AUDIT.md §9
-- Critical finding): organization_wallets is a purely operational balance
-- with no chart-of-accounts backing — org<->group transfers only ever posted
-- a real double-entry journal on the *receiving group's* side; the
-- organization's own wallet debit was a bare UPDATE with no accounting trace.
--
-- Deliberately a SEPARATE, parallel ledger (organization_accounts /
-- organization_journal_entries / organization_journal_lines) rather than
-- extending the existing group-scoped accounts/journal_entries tables —
-- organizations and groups are genuinely different entities (fund accounting
-- with net assets, not member equity), and this avoids touching the
-- already-hardened, RLS-tightly-scoped tables every group financial
-- operation depends on. Structurally mirrors the group ledger exactly
-- (migrations 004/009/027): same enums (account_type, journal_status)
-- reused directly, same two-layer balance-enforcement trigger pattern, same
-- RLS shape as the rest of the organization_* tables (migration 055).
--
-- Scope: the core double-entry engine (chart of accounts + posting +
-- balance trigger) wired into the existing deposit()/settleOrgDisbursement()/
-- rejectDisbursement() flows. Deliberately NOT in scope for this migration:
-- a manual-journal UI for organizations (every org transaction already flows
-- through the controlled deposit/disburse paths — there's no unmet need for
-- ad hoc entries yet), fiscal period locking for organizations, and
-- backfilling historical organization_ledger rows into this new ledger
-- (it starts recording from today; the append-only organization_ledger
-- remains the historical record).

CREATE TABLE organization_accounts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  account_code    VARCHAR(20)   NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  type            account_type  NOT NULL,
  parent_id       UUID          REFERENCES organization_accounts (id) ON DELETE RESTRICT,
  description     TEXT,
  is_system       BOOLEAN       NOT NULL DEFAULT false,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  balance         NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT organization_accounts_code_unique UNIQUE (organization_id, account_code),
  CONSTRAINT organization_accounts_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX idx_org_accounts_organization_id ON organization_accounts (organization_id);

CREATE TABLE organization_journal_entries (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID           NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  entry_date      DATE           NOT NULL DEFAULT CURRENT_DATE,
  reference       VARCHAR(100),
  description     TEXT           NOT NULL,
  status          journal_status NOT NULL DEFAULT 'draft',
  created_by      UUID           REFERENCES members (id) ON DELETE SET NULL,
  posted_by       UUID           REFERENCES members (id) ON DELETE SET NULL,
  posted_at       TIMESTAMPTZ,
  voided_by       UUID           REFERENCES members (id) ON DELETE SET NULL,
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  posted_via      TEXT           NOT NULL DEFAULT 'user' CHECK (posted_via IN ('user', 'system')),
  is_test         BOOLEAN        NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_journal_entries_org_date ON organization_journal_entries (organization_id, entry_date DESC);
CREATE INDEX idx_org_journal_entries_status   ON organization_journal_entries (status);

CREATE TABLE organization_journal_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID          NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  journal_entry_id UUID          NOT NULL REFERENCES organization_journal_entries (id) ON DELETE CASCADE,
  account_id       UUID          NOT NULL REFERENCES organization_accounts (id) ON DELETE RESTRICT,
  debit            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT organization_journal_lines_debit_xor_credit
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX idx_org_journal_lines_org_id   ON organization_journal_lines (organization_id);
CREATE INDEX idx_org_journal_lines_entry_id ON organization_journal_lines (journal_entry_id);
CREATE INDEX idx_org_journal_lines_account_id ON organization_journal_lines (account_id);

-- ─── Balance enforcement (mirrors migrations 009 + 027) ─────────────────────

CREATE OR REPLACE FUNCTION validate_organization_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_debits  NUMERIC(15,2);
  v_credits NUMERIC(15,2);
BEGIN
  IF NEW.status = 'posted' AND OLD.status = 'draft' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM organization_journal_lines WHERE journal_entry_id = NEW.id;
    IF v_debits = 0 OR v_debits <> v_credits THEN
      RAISE EXCEPTION 'Organization journal entry % is unbalanced or empty (debits %, credits %)',
        NEW.id, v_debits, v_credits;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_org_journal_balance ON organization_journal_entries;
CREATE TRIGGER trg_validate_org_journal_balance
  BEFORE UPDATE ON organization_journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_organization_journal_balance();

-- System-posted entries (settleOrgDisbursement, deposit) insert directly with
-- status='posted', bypassing the BEFORE UPDATE trigger above — this deferred
-- constraint trigger closes that gap, same reasoning as migration 027.
CREATE OR REPLACE FUNCTION assert_org_posted_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_debits  NUMERIC(15,2);
  v_credits NUMERIC(15,2);
  v_status  journal_status;
BEGIN
  SELECT status INTO v_status FROM organization_journal_entries WHERE id = NEW.journal_entry_id;
  IF v_status = 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM organization_journal_lines WHERE journal_entry_id = NEW.journal_entry_id;
    IF v_debits = 0 OR v_debits <> v_credits THEN
      RAISE EXCEPTION 'Organization journal entry % is unbalanced or empty (debits %, credits %)',
        NEW.journal_entry_id, v_debits, v_credits;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assert_org_posted_entry_balance ON organization_journal_lines;
CREATE CONSTRAINT TRIGGER trg_assert_org_posted_entry_balance
  AFTER INSERT ON organization_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_org_posted_entry_balance();

CREATE OR REPLACE FUNCTION update_organization_account_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_status journal_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM organization_journal_entries WHERE id = OLD.journal_entry_id;
    IF v_status = 'posted' THEN
      UPDATE organization_accounts SET balance = balance - (OLD.debit - OLD.credit) WHERE id = OLD.account_id;
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO v_status FROM organization_journal_entries WHERE id = NEW.journal_entry_id;
  IF v_status = 'posted' THEN
    UPDATE organization_accounts SET balance = balance + (NEW.debit - NEW.credit) WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_journal_lines_update_balance ON organization_journal_lines;
CREATE TRIGGER trg_org_journal_lines_update_balance
  AFTER INSERT OR UPDATE OR DELETE ON organization_journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_organization_account_balance();

-- ─── RLS (mirrors migration 055's organization_wallets/_ledger pattern) ─────

ALTER TABLE organization_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_accounts        FORCE  ROW LEVEL SECURITY;
ALTER TABLE organization_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_journal_entries FORCE  ROW LEVEL SECURITY;
ALTER TABLE organization_journal_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_journal_lines   FORCE  ROW LEVEL SECURITY;

CREATE POLICY organization_accounts_all ON organization_accounts
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_journal_entries_all ON organization_journal_entries
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_journal_lines_all ON organization_journal_lines
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

-- ─── Seed chart of accounts for every existing organization ─────────────────
-- Fund-accounting shape (net assets, not member equity) — organizations fund
-- and monitor groups; they don't have members, shares, or welfare pools.
--
-- Deliberately minimal: exactly the three accounts deposit() and
-- settleOrgDisbursement() actually post to. The audit's own finding (§4)
-- was that seeded-but-unreachable accounts (5003, 5004 on the group side)
-- are themselves a maintenance/audit hazard — not repeating that here.
-- Broaden this chart only alongside the code path that would use it.

INSERT INTO organization_accounts (organization_id, account_code, name, type, is_system)
SELECT o.id, a.code, a.name, a.type::account_type, true
FROM   organizations o
CROSS JOIN (VALUES
  ('1001', 'Cash and Bank',         'asset'),
  ('4001', 'Donor Contributions',   'income'),
  ('5001', 'Program Disbursements', 'expense')
) AS a(code, name, type)
ON CONFLICT (organization_id, account_code) DO NOTHING;
