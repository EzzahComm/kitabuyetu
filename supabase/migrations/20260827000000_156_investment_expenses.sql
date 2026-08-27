-- =============================================================================
-- 156: expenses against an investment / income-generating activity
--
-- The investments module could record what a group PUT IN (principal_amount),
-- what it is worth now (current_value) and what it PAID BACK
-- (investment_returns), but never what it COST TO RUN. For the activities
-- Kenyan groups actually hold — poultry, farming, rental property, water
-- projects, a group business — the running cost is most of the story, and a
-- "return" with no expense against it overstates performance.
--
-- Deliberately mirrors investment_returns rather than inventing a new shape:
-- same columns, same indexes, same isolation policy, so the two read as a
-- matched pair everywhere they are joined.
--
-- Purely additive. No existing column, constraint or policy is altered, and
-- an investment with no expense rows behaves exactly as it does today.
-- =============================================================================

-- ── Enum ─────────────────────────────────────────────────────────────────────
-- Chosen for the activities groups on this platform actually run. Keep this
-- in lockstep with RecordExpenseSchema in lib/services/investments.service.ts:
-- a value that passes zod but is not a member here fails at INSERT with an
-- invalid-input-value error, which is exactly how 'coupon' once slipped into
-- the return_type schema (see that schema's comment).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_type') THEN
    CREATE TYPE public.expense_type AS ENUM (
      'inputs',      -- feed, seed, stock, raw materials
      'labour',      -- wages paid on the activity
      'maintenance', -- upkeep and repairs
      'transport',
      'utilities',   -- water, power
      'fees',        -- management, professional, licence
      'tax',
      'insurance',
      'other'
    );
  END IF;
END $$;

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.investment_expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id  uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  group_id       uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  expense_type   public.expense_type NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  expense_date   date NOT NULL,
  receipt_number varchar(100),
  notes          text,
  recorded_by    uuid NOT NULL REFERENCES public.members(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investment_expenses_investment_id_idx ON public.investment_expenses(investment_id);
CREATE INDEX IF NOT EXISTS investment_expenses_group_id_idx      ON public.investment_expenses(group_id);
CREATE INDEX IF NOT EXISTS investment_expenses_expense_date_idx  ON public.investment_expenses(expense_date DESC);

COMMENT ON TABLE public.investment_expenses IS
  'Costs incurred running an investment or income-generating activity '
  '(migration 156). The mirror of investment_returns: returns are money the '
  'activity paid back, expenses are money it consumed. Net performance is '
  'current_value + returns - expenses - principal.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- FORCE as well as ENABLE, matching what migration 097 did to investments and
-- investment_returns: without FORCE, the table owner bypasses the policy.
ALTER TABLE public.investment_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_expenses FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'investment_expenses'
      AND policyname = 'investment_expenses_group_isolation'
  ) THEN
    CREATE POLICY investment_expenses_group_isolation ON public.investment_expenses
      USING (group_id = current_setting('app.current_group_id', true)::uuid);
  END IF;
END $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Supabase's default privileges hand every new table in `public` full rights
-- to anon and authenticated, which is how the 2026-08-08 PostgREST exposure
-- happened. This table is reached only through the app's own Postgres
-- connection (withDb/withTransaction as app_tenant), never through PostgREST,
-- so those grants have no legitimate caller and are revoked outright rather
-- than left to rely on RLS alone.
REVOKE ALL ON public.investment_expenses FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_expenses TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_expenses TO app_tenant';
  END IF;
END $$;
