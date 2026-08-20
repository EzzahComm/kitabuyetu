-- ─────────────────────────────────────────────────────────────────────────────
-- 152: Organization subscription plans (Starter/Growth/Premium/Premium+)
--
-- Organizations had NO plan/tier concept at all before this — confirmed by an
-- exhaustive search: no table, no enforcement, nothing beyond three completely
-- dead, unreferenced columns from migration 064
-- (enterprise_per_member_fee/enterprise_sms_free/enterprise_sms_rate). Every
-- organization was created identical and unconstrained.
--
-- UNLIKE the group side's `subscriptions`/PLAN_FEATURES (which currently
-- unlocks everything on every tier — a deliberate choice after an audit found
-- the gating inverted), this IS enforced from day one, by explicit choice.
-- AND UNLIKE the group side, there is no self-serve purchase/upgrade path at
-- all: only super_admin creates organizations, so a plan is always assigned
-- by staff. See types/enums.ts's ORGANIZATION_PLAN_FEATURES/_MONTHLY_FEES for
-- the static tier definitions this table snapshots at assignment time.
--
-- SNAPSHOT, NOT LIVE JOIN — mirrors subscriptions.max_members/
-- sms_allowance_included/monthly_fee exactly: a later plan price/limit change
-- must never retroactively alter an organization that already agreed to
-- specific terms. Premium+ is custom in every dimension including price, so
-- its row is entered by hand rather than copied from a static map at all.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE organization_plan_type AS ENUM ('starter', 'growth', 'premium', 'premium_plus');
CREATE TYPE organization_subscription_status AS ENUM ('active', 'cancelled');
CREATE TYPE organization_support_tier AS ENUM ('standard', 'priority', 'priority_plus');

CREATE TABLE organization_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  plan_type              organization_plan_type NOT NULL,
  status                 organization_subscription_status NOT NULL DEFAULT 'active',

  -- Snapshotted values — see header. NULL on a limit column means unlimited,
  -- same convention subscriptions.max_members already uses.
  monthly_fee            NUMERIC(10,2) NOT NULL CHECK (monthly_fee >= 0),
  max_linked_groups      INTEGER CHECK (max_linked_groups IS NULL OR max_linked_groups > 0),
  max_staff              INTEGER CHECK (max_staff IS NULL OR max_staff > 0),
  max_funding_programs   INTEGER CHECK (max_funding_programs IS NULL OR max_funding_programs > 0),
  sms_allowance_included NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (sms_allowance_included >= 0),
  white_label_branding   BOOLEAN NOT NULL DEFAULT false,
  advanced_reports       BOOLEAN NOT NULL DEFAULT false,
  support_tier           organization_support_tier NOT NULL DEFAULT 'standard',

  -- True only for premium_plus — every field above was entered by hand for
  -- this specific deal rather than copied from ORGANIZATION_PLAN_FEATURES.
  is_custom              BOOLEAN NOT NULL DEFAULT false,

  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at           TIMESTAMPTZ,
  -- Always a super_admin — organizations never self-serve a plan.
  assigned_by            UUID REFERENCES members (id) ON DELETE SET NULL,
  notes                  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same one-active-row shape as subscriptions' per-product unique index, just
-- unconditional here since an organization holds exactly one plan (no
-- per-product axis the way a group's Kitabu-Yetu/Chama-Reminder split needs).
CREATE UNIQUE INDEX idx_org_subscriptions_one_active
  ON organization_subscriptions (organization_id) WHERE status = 'active';

CREATE INDEX idx_org_subscriptions_org ON organization_subscriptions (organization_id, created_at DESC);

CREATE TRIGGER trg_organization_subscriptions_updated_at
  BEFORE UPDATE ON organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_subscriptions FORCE ROW LEVEL SECURITY;

-- Coordinator/staff may READ their own organization's plan (surfaced on the
-- Billing page); only super_admin may write — assignment is always an admin
-- action (organization-plan.service.ts uses withAdminDb for every write, but
-- this is the real backstop, not just an application-layer convention).
CREATE POLICY organization_subscriptions_select ON organization_subscriptions
  FOR SELECT USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
  );

CREATE POLICY organization_subscriptions_admin_write ON organization_subscriptions
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

GRANT ALL ON organization_subscriptions TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist at this point in a fresh/CI Postgres replay — a plain GRANT to it
-- would fail migration validation outright. Guard it the same way migration
-- 133 already had to learn to.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT ON organization_subscriptions TO app_tenant';
  END IF;
END $do$;

-- ─── SMS allowance tracking ──────────────────────────────────────────────────
--
-- Deliberately simpler than the group side's used/included-counter model
-- (billing_accounts.sms_allowance_used/sms_allowance_period_start, which
-- tracks consumption priority between allowance and paid balance). Building
-- that same consumption-priority split for organizations would mean touching
-- messaging-billing.ts's reserve/settle path for the organization payer axis
-- too — out of scope here. Instead, the bundled allowance is GRANTED as a
-- real credited balance addition (organization-plan.service.ts, via the
-- existing sms_ledger_append's allowance_amount column, migration 141 —
-- "the portion covered by the bundled monthly allowance," never previously
-- used for organizations) at assignment and on each monthly anniversary.
-- This column tracks when that anniversary grant last ran, mirroring
-- billing_accounts.sms_allowance_period_start's anti-drift shape exactly.
ALTER TABLE organization_billing_accounts
  ADD COLUMN IF NOT EXISTS sms_allowance_period_start TIMESTAMPTZ;

COMMENT ON COLUMN organization_billing_accounts.sms_allowance_period_start IS
  'Start of the monthly period whose allowance grant has already run — compared against the anniversary derived from organization_subscriptions.started_at. NULL means no grant has ever run for this org.';
