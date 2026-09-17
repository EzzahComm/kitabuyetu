-- =============================================================================
-- 179: Configurable loan charges/fees engine
--
-- THE GAP
-- loans/loan_repayments could carry a manually-typed `penalty_amount` on a
-- repayment, but nothing in the platform could express "this group charges a
-- 2% processing fee on disbursement" or "a 500 KES late fee accrues on every
-- overdue instalment" as CONFIGURATION, compute it automatically, or post it
-- to the ledger. This migration adds that as two tables:
--
--   loan_charge_types — the CONFIGURED fee catalogue (name, fixed-or-percentage
--   rule, which lifecycle event triggers it). Cascades Platform -> Organization
--   -> Group exactly like the `policies` table (086_configuration_policies.sql)
--   that loan-policy.service.ts already uses for interest terms — same
--   specificity rule (group beats organization beats platform-wide NULL/NULL),
--   same RLS shape (policies_select/_insert/_update).
--
--   It is a SIBLING table to `policies`, not a new key inside it: `policies`
--   stores one opaque JSONB value per (domain, key, scope) with no stable
--   identity for sub-items, but loan_charges below needs a real foreign key to
--   "the processing fee configuration that produced this charge" — a JSONB
--   blob can't be joined against. Each named charge type therefore gets its
--   own row and its own id, and the group/organization/platform cascade is
--   reimplemented at the row level (resolved per distinct charge name — see
--   lib/services/loan-charges.service.ts's getEffectiveChargeTypes) rather than
--   reused from configuration.service.ts's single-value resolver.
--
--   is_active is a genuine on/off switch, not policies-table version history:
--   an inactive row is simply excluded from resolution and the cascade falls
--   through to the next tier's active row for that name (or to nothing, which
--   is the correct "no such charge configured" outcome). There is deliberately
--   no seeded default of any kind — unlike loan-policy's DEFAULT_LOAN_TERMS
--   (which preserves a rate that already existed), there is no pre-existing
--   automatic-fee behavior to preserve, so every group starts at "charges
--   nothing extra" until an admin explicitly configures a charge type. Adding
--   this migration therefore changes zero live billing behavior on its own.
--
--   loan_charges — the ledger of charges actually applied to a specific loan.
--   Snapshots `amount` at application time (a later rate change on the charge
--   type must never retroactively reprice a historical charge, same rationale
--   as loans.interest_rate being copied onto the loan row rather than read
--   live from loan-policy on every repayment). Links to loan_repayments only
--   for on_overdue charges (one specific overdue instalment triggered it) —
--   NULL for on_disburse charges, which belong to the loan as a whole.
--   journal_entry_id links the GL posting made via the templated posting
--   engine (posting-templates.service.ts's new 'loan_charge' event), matching
--   how loans.journal_entry_id / loan_repayments.journal_entry_id already work.
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Same idiom as 156_investment_expenses.sql's expense_type: idempotent create,
-- kept in lockstep with lib/validators/loan-charge.schema.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_charge_calculation_type') THEN
    CREATE TYPE public.loan_charge_calculation_type AS ENUM ('fixed', 'percentage');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_charge_trigger_event') THEN
    -- on_disburse: one-time, applied once when the loan transitions to
    --   'disbursed' (e.g. processing fee, insurance fee).
    -- on_overdue: recurring/per-period, applied when a specific instalment is
    --   found overdue at the moment its repayment is recorded (e.g. late fee).
    CREATE TYPE public.loan_charge_trigger_event AS ENUM ('on_disburse', 'on_overdue');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_charge_status') THEN
    CREATE TYPE public.loan_charge_status AS ENUM ('pending', 'paid', 'waived');
  END IF;
END $$;

-- ── loan_charge_types ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_charge_types (
  id               UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID                          REFERENCES public.organizations (id) ON DELETE CASCADE,
  group_id         UUID                          REFERENCES public.groups (id) ON DELETE CASCADE,
  name             TEXT                          NOT NULL CHECK (btrim(name) <> ''),
  calculation_type public.loan_charge_calculation_type NOT NULL,
  -- Percentage rate (0-100) when calculation_type = 'percentage', otherwise a
  -- flat KES amount. Same dual-purpose-column shape as elsewhere in this
  -- codebase (e.g. dividends' rate-vs-amount split) rather than two nullable
  -- columns, because exactly one of the two readings is ever valid at once.
  amount           NUMERIC(15,4)                 NOT NULL,
  trigger_event    public.loan_charge_trigger_event NOT NULL,
  is_active        BOOLEAN                       NOT NULL DEFAULT true,
  created_by       UUID                          REFERENCES public.members (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),

  CONSTRAINT loan_charge_types_amount_bounded CHECK (
    (calculation_type = 'percentage' AND amount >= 0 AND amount <= 100)
    OR (calculation_type = 'fixed' AND amount >= 0)
  )
);

COMMENT ON TABLE public.loan_charge_types IS
  'Configured loan fee catalogue (migration 179): named fixed/percentage charge '
  'rules, cascading Platform -> Organization -> Group like the policies table, '
  'but as its own table so loan_charges has a stable id to reference. '
  'is_active is a live on/off switch, not version history.';

-- At most one ACTIVE row per (name, scope) — same COALESCE-sentinel technique
-- as policies_active_scope_unique (086) so NULL/NULL (platform-wide) collapses
-- to one comparable value instead of NULL's normal "always distinct" behavior.
-- Matched case/whitespace-insensitively so "Late Fee" and "late fee " cannot
-- coexist as two different charge types in the same scope.
CREATE UNIQUE INDEX IF NOT EXISTS loan_charge_types_active_scope_unique ON public.loan_charge_types (
  lower(btrim(name)),
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(group_id,        '00000000-0000-0000-0000-000000000000')
) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_loan_charge_types_organization ON public.loan_charge_types (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loan_charge_types_group        ON public.loan_charge_types (group_id)        WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loan_charge_types_trigger      ON public.loan_charge_types (trigger_event)   WHERE is_active;

-- ── loan_charges (the ledger) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_charges (
  id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID                    NOT NULL REFERENCES public.groups (id) ON DELETE RESTRICT,
  loan_id           UUID                    NOT NULL REFERENCES public.loans (id) ON DELETE CASCADE,
  charge_type_id    UUID                    NOT NULL REFERENCES public.loan_charge_types (id) ON DELETE RESTRICT,
  -- Set only for on_overdue charges — identifies the specific instalment whose
  -- lateness triggered this charge, and is what stops the same instalment
  -- being charged twice (see the unique index below). NULL for on_disburse
  -- charges, which are one-time and belong to the loan as a whole.
  loan_repayment_id UUID                    REFERENCES public.loan_repayments (id) ON DELETE SET NULL,
  -- Computed and snapshotted at application time — a later edit to the charge
  -- type's rate must never reprice a charge that already happened.
  amount            NUMERIC(15,2)           NOT NULL CHECK (amount > 0),
  status            public.loan_charge_status NOT NULL DEFAULT 'pending',
  applied_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  journal_entry_id  UUID                    REFERENCES public.journal_entries (id) ON DELETE SET NULL,
  waived_by         UUID                    REFERENCES public.members (id) ON DELETE SET NULL,
  waived_at         TIMESTAMPTZ,
  waived_reason     TEXT,
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  CONSTRAINT loan_charges_waived_fields_consistent CHECK (
    (status = 'waived' AND waived_by IS NOT NULL AND waived_at IS NOT NULL AND waived_reason IS NOT NULL)
    OR (status <> 'waived' AND waived_by IS NULL AND waived_at IS NULL AND waived_reason IS NULL)
  )
);

COMMENT ON TABLE public.loan_charges IS
  'Ledger of charges actually applied to a loan (migration 179) — one row per '
  'application of a loan_charge_types rule, amount snapshotted at that moment. '
  'journal_entry_id links the GL posting made via posting-templates.service.ts''s '
  '''loan_charge'' event.';

-- One on_disburse application per (loan, charge type) — disbursement is a
-- one-time state transition, so this is a defensive backstop, not the primary
-- guard (that's loans.status: only an 'approved' loan can be disbursed).
CREATE UNIQUE INDEX IF NOT EXISTS loan_charges_unique_per_loan_ondisburse ON public.loan_charges (loan_id, charge_type_id)
  WHERE loan_repayment_id IS NULL;

-- One on_overdue application per (instalment, charge type) — the actual guard
-- against a retried recordRepayment() call double-charging the same late fee.
CREATE UNIQUE INDEX IF NOT EXISTS loan_charges_unique_per_repayment ON public.loan_charges (loan_repayment_id, charge_type_id)
  WHERE loan_repayment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loan_charges_group_id       ON public.loan_charges (group_id);
CREATE INDEX IF NOT EXISTS idx_loan_charges_loan_id        ON public.loan_charges (loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_charges_charge_type_id ON public.loan_charges (charge_type_id);
CREATE INDEX IF NOT EXISTS idx_loan_charges_status         ON public.loan_charges (group_id, status) WHERE status = 'pending';

-- ── RLS: loan_charge_types ───────────────────────────────────────────────────
-- Exactly policies_select/_insert/_update's shape (086_configuration_policies.sql):
-- SELECT is broad (a session must see its organization's and the platform's
-- rows, that's the whole point of a cascade); writes stay scoped to the tier
-- the session belongs to. Role-level gating (chairperson-only, via
-- loans.policy.manage) happens at the app/permission layer exactly like
-- policies_insert/_update leave it for ApprovalPolicy/LoanPolicy — RLS here
-- enforces TENANT boundaries, not job-title boundaries.
ALTER TABLE public.loan_charge_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_charge_types FORCE  ROW LEVEL SECURITY;

CREATE POLICY loan_charge_types_select ON public.loan_charge_types
  FOR SELECT USING (
    is_super_admin()
    OR (organization_id IS NULL AND group_id IS NULL)
    OR (group_id = app_current_group_id())
    OR (organization_id = app_current_organization_id())
    OR (group_id IS NULL AND organization_id IN (
          SELECT oga.organization_id FROM public.organization_group_access oga
          WHERE oga.group_id = app_current_group_id() AND oga.is_active
        ))
  );

CREATE POLICY loan_charge_types_insert ON public.loan_charge_types
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND organization_id IS NULL)
    OR (organization_id = app_current_organization_id() AND group_id IS NULL AND app_current_role() = 'organization_coordinator')
  );

CREATE POLICY loan_charge_types_update ON public.loan_charge_types
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND organization_id IS NULL)
    OR (organization_id = app_current_organization_id() AND group_id IS NULL AND app_current_role() = 'organization_coordinator')
  );

-- ── RLS: loan_charges ────────────────────────────────────────────────────────
-- Same shape as loans/loan_repayments (010_rls_policies.sql): group-scoped,
-- writes restricted to the officer roles that already write loans/loan_repayments
-- (chairperson, treasurer) — this table is only ever written from inside
-- loans.service.ts's disburse()/recordRepayment() hooks or the waiveCharge
-- action, all of which are gated on the loans.approve permission.
ALTER TABLE public.loan_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_charges FORCE  ROW LEVEL SECURITY;

CREATE POLICY loan_charges_select ON public.loan_charges
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

CREATE POLICY loan_charges_insert ON public.loan_charges
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson', 'treasurer'))
  );

CREATE POLICY loan_charges_update ON public.loan_charges
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson', 'treasurer'))
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Same hygiene as 156_investment_expenses.sql: Supabase's default privileges
-- hand every new public table full rights to anon/authenticated, which is how
-- the 2026-08-08 PostgREST exposure happened. These tables are reached only
-- through the app's own Postgres connection (withDb/withTransaction as
-- app_tenant), never through PostgREST, so those grants are revoked outright.
REVOKE ALL ON public.loan_charge_types FROM anon, authenticated;
REVOKE ALL ON public.loan_charges      FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_charge_types TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_charges      TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_charge_types TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_charges      TO app_tenant';
  END IF;
END $$;
