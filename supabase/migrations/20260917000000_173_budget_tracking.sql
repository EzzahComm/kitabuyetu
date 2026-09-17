-- =============================================================================
-- 173: Budget tracking — planned vs actual per GL account, per fiscal period
--
-- Genuinely missing feature (Phase 3, code-verified gap): no budget concept
-- existed anywhere in this codebase — no service, no schema, no route. A
-- group could see what it HAD posted (trial balance / P&L / balance sheet via
-- accounting.service.ts) but never record what it PLANNED to spend or earn
-- for a period, and so never see a variance.
--
-- Deliberately built on top of the real chart-of-accounts / double-entry
-- ledger (accounts / journal_entries / journal_lines) rather than inventing a
-- parallel record of "amounts": a budget line names a real GL account, and
-- its actual is computed LIVE from journal_lines/journal_entries by
-- lib/services/budget.service.ts, reusing accounting.service.ts's own
-- debit/credit-normal convention (see getProfitAndLoss's FILTER comment —
-- the filter belongs inside FILTER, never inside the LEFT JOIN's ON clause,
-- or it silently sums every period ever posted). No actual amount is stored
-- here — only the plan.
--
-- Not a policy: configuration.service.ts's group/organization/platform
-- cascading resolver does not apply — a budget is a real financial record
-- created once per period, for one group, by a person, not an inherited
-- default.
--
-- Grants follow CREATE TABLE (not CREATE OR REPLACE), so the "CREATE OR
-- REPLACE silently drops grants" incident class does not apply here — but
-- explicit grants are still spelled out below rather than left to RLS alone,
-- matching migrations 156/162's reasoning (the 2026-08-08 PostgREST exposure:
-- Supabase hands every new public table full CRUD to anon/authenticated by
-- default, and this table is reached only through the app's own Postgres
-- connection, never through PostgREST).
--
-- Role literal note: 'chairperson' is used below, NOT 'group_admin'.
-- Migration 050 renamed the member_role 'group_admin' -> 'chairperson';
-- migration 096 found and fixed ~20 policies (including accounts,
-- journal_entries, journal_lines, fiscal_periods) that still embedded the
-- stale 'group_admin' string literal. Using 'chairperson' here from the start
-- avoids reintroducing that exact bug class in a brand-new table.
-- =============================================================================

-- ── budgets (header) ─────────────────────────────────────────────────────────
CREATE TABLE public.budgets (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID          NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  name          VARCHAR(255)  NOT NULL,
  period_start  DATE          NOT NULL,
  period_end    DATE          NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'closed')),
  notes         TEXT,
  created_by    UUID          REFERENCES public.members (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT budgets_valid_range CHECK (period_end >= period_start)
);

CREATE INDEX idx_budgets_group_id     ON public.budgets (group_id);
CREATE INDEX idx_budgets_group_period ON public.budgets (group_id, period_start, period_end);
CREATE INDEX idx_budgets_group_status ON public.budgets (group_id, status);

COMMENT ON TABLE public.budgets IS
  'Per-group planned-spend/income header for a fiscal period (migration 173). '
  'See lib/services/budget.service.ts. Lines live in budget_lines; actual '
  'amounts are computed live from journal_lines/journal_entries, never '
  'stored here.';

CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── budget_lines ─────────────────────────────────────────────────────────────
-- One row per GL account being budgeted within a budget. group_id is
-- denormalized onto the line — the same choice journal_lines makes relative
-- to journal_entries — so RLS can scope the line table directly without a
-- join back to the header.
CREATE TABLE public.budget_lines (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id      UUID          NOT NULL REFERENCES public.budgets  (id) ON DELETE CASCADE,
  group_id       UUID          NOT NULL REFERENCES public.groups   (id) ON DELETE CASCADE,
  account_id     UUID          NOT NULL REFERENCES public.accounts (id) ON DELETE RESTRICT,
  planned_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (planned_amount >= 0),
  notes          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One planned amount per account per budget — a second row for the same
  -- account within the same budget has nowhere sensible to go; combine it
  -- into the existing line instead (same one-appearance-per-plan rule
  -- LoanFundingPlanSchema enforces in lib/validators/loan.schema.ts).
  CONSTRAINT uq_budget_lines_budget_account UNIQUE (budget_id, account_id)
);

CREATE INDEX idx_budget_lines_budget_id  ON public.budget_lines (budget_id);
CREATE INDEX idx_budget_lines_group_id   ON public.budget_lines (group_id);
CREATE INDEX idx_budget_lines_account_id ON public.budget_lines (account_id);

COMMENT ON TABLE public.budget_lines IS
  'Planned amount for one GL account within a budget (migration 173). The '
  'account''s actual activity for the budget''s period is computed live from '
  'journal_lines/journal_entries by lib/services/budget.service.ts, using '
  'the same debit/credit-normal convention as the trial balance.';

CREATE TRIGGER trg_budget_lines_updated_at
  BEFORE UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mirrors accounts/journal_entries/journal_lines (migrations 010, corrected by
-- 050/096) and fiscal_periods (083, corrected by 096): open read to any member
-- of the group, write restricted to chairperson/treasurer — the same two
-- roles that can post/edit the ledger a budget is measured against. Helper
-- calls wrapped in (SELECT …) per migration 044's initplan-perf fix, matching
-- the current idiom (migration 162).

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets FORCE  ROW LEVEL SECURITY;

CREATE POLICY budgets_select ON public.budgets
  FOR SELECT USING (
    (SELECT is_super_admin())
    OR group_id = (SELECT app_current_group_id())
  );

CREATE POLICY budgets_insert ON public.budgets
  FOR INSERT WITH CHECK (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
  );

CREATE POLICY budgets_update ON public.budgets
  FOR UPDATE USING (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
  );

-- DELETE is additionally backstopped at the DB layer to draft-only budgets.
-- The service layer already enforces this (a budget with real activity
-- shouldn't vanish); this is the same belt-and-suspenders choice migration
-- 083's assert_period_open() trigger makes for fiscal periods.
CREATE POLICY budgets_delete ON public.budgets
  FOR DELETE USING (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer')
        AND status = 'draft')
  );

ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY budget_lines_select ON public.budget_lines
  FOR SELECT USING (
    (SELECT is_super_admin())
    OR group_id = (SELECT app_current_group_id())
  );

CREATE POLICY budget_lines_insert ON public.budget_lines
  FOR INSERT WITH CHECK (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
  );

CREATE POLICY budget_lines_update ON public.budget_lines
  FOR UPDATE USING (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
  );

CREATE POLICY budget_lines_delete ON public.budget_lines
  FOR DELETE USING (
    (SELECT is_super_admin())
    OR (group_id = (SELECT app_current_group_id())
        AND (SELECT app_current_role()) IN ('chairperson', 'treasurer'))
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Same reasoning as migrations 156/162: reached only through the app's own
-- Postgres connection (withDb/withTransaction as app_tenant), never through
-- PostgREST, so Supabase's default anon/authenticated grants are revoked
-- outright rather than relying on RLS alone to block them.
REVOKE ALL ON public.budgets      FROM anon, authenticated;
REVOKE ALL ON public.budget_lines FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_lines TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets      TO app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_lines TO app_tenant;
  END IF;
END
$grant$;
