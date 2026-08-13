-- =============================================================================
-- 143: SMS pricing tiers, packages, and provider cost
--
-- Phase 2 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md (spec §2, §3, §12,
-- §15). Makes pricing DATA rather than code, so a super-admin can change tiers
-- and packages without a deploy.
--
-- WHAT THIS REPLACES. `SMS_RATES` in types/enums.ts is typed
-- `(volume: number) => number` and looks like a volume-pricing engine. It is
-- not one: all four call sites pass 0, and the rate actually charged at send
-- time comes from `subscriptions.sms_rate` — a scalar frozen onto the
-- subscription at purchase — which reserve_sms_credits reads with MIN(). The
-- volume argument has never priced anything. This migration supplies the real
-- thing; the dead signature is removed in the same PR.
--
-- NOTHING REPRICES ON DEPLOY. The seeded tier table is deliberately a single
-- flat band at 0.90 — exactly what every production subscription charges today
-- (verified live). The spec's five-band table is inserted alongside it as
-- INACTIVE rows, so switching to volume pricing is a deliberate admin action
-- with an audit trail, not a side effect of shipping this migration. §21 is
-- explicit that customer pricing must not change without a migration strategy.
--
-- CREDITS ARE STILL MONEY HERE. Tier boundaries are expressed in MESSAGE
-- COUNTS (spec §2), but `billing_accounts.sms_credits` still holds a monetary
-- balance until Phase 3 converts it. These tables are therefore priced per
-- message and consumed by nothing yet — like migration 141, this phase records
-- and configures, it does not decide.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Volume pricing tiers (§2)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sms_pricing_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(60)  NOT NULL,

  -- Inclusive lower bound, exclusive-of-NULL upper bound, in MESSAGES.
  -- max_credits NULL means "and above" — exactly one active row may have it.
  min_credits   INTEGER      NOT NULL CHECK (min_credits >= 0),
  max_credits   INTEGER,

  -- What the CUSTOMER pays per message inside this band.
  unit_price    NUMERIC(10,4) NOT NULL CHECK (unit_price >= 0),

  currency      CHAR(3)      NOT NULL DEFAULT 'KES',
  is_active     BOOLEAN      NOT NULL DEFAULT false,
  display_order INTEGER      NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_tier_band_sane CHECK (max_credits IS NULL OR max_credits >= min_credits)
);

COMMENT ON TABLE sms_pricing_tiers IS
  'Volume price bands in MESSAGES. Only is_active rows price anything; the '
  'inactive rows are the proposed table, held until someone chooses to switch.';

-- Two active bands must never overlap, or the price of a given volume is
-- ambiguous and depends on row order. An exclusion constraint is the only way
-- to state that as an invariant rather than hope for it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- max_credits is passed straight through: int4range already treats a NULL
-- bound as unbounded, which is exactly what "and above" means. Do NOT
-- COALESCE it to int4's maximum — an inclusive '[]' upper bound normalises to
-- upper + 1, so the sentinel overflows and every open-ended tier insert fails
-- with "integer out of range".
--
-- DEFERRABLE, and that is load-bearing. Exclusion constraints are checked per
-- ROW, not per statement, so switching price lists — deactivate the flat band,
-- activate the five volume bands — transiently has both sets active and fails
-- mid-UPDATE even though the end state is valid. That is the ordinary admin
-- operation this table exists for. Deferring lets the whole swap happen in one
-- transaction, checked once at COMMIT, so the end state is what is validated.
-- INITIALLY IMMEDIATE keeps the default strict for everything else.
ALTER TABLE sms_pricing_tiers
  ADD CONSTRAINT sms_tier_no_overlap
  EXCLUDE USING gist (
    int4range(min_credits, max_credits, '[]') WITH &&
  ) WHERE (is_active)
  DEFERRABLE INITIALLY IMMEDIATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sellable packages (§3)
--
-- A package is a fixed quantity at a fixed total price. It is NOT derived from
-- the tier table: §4 forbids retroactive repricing, so what a customer paid has
-- to be a recorded fact, and a package's own price is that fact at purchase
-- time. Tiers price custom quantities; packages price themselves.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sms_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(60)  NOT NULL,
  description    TEXT,
  credits        INTEGER      NOT NULL CHECK (credits > 0),
  price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency       CHAR(3)      NOT NULL DEFAULT 'KES',
  is_active      BOOLEAN      NOT NULL DEFAULT false,
  is_recommended BOOLEAN      NOT NULL DEFAULT false,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sms_packages IS
  'Predefined SMS credit bundles. Price is the sold fact, not derived from '
  'sms_pricing_tiers — §4 forbids repricing a completed purchase.';

-- At most one recommended package, or the UI has to pick arbitrarily.
CREATE UNIQUE INDEX idx_sms_packages_one_recommended
  ON sms_packages ((true)) WHERE is_recommended AND is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Provider cost & margin (§15)
--
-- Kept in its own table with validity dates rather than as a column, because
-- margin on a PAST sale must be computed against the cost that applied THEN.
-- A single mutable "current cost" would silently rewrite historical margin
-- every time the provider changed price — the same mistake §4 forbids on the
-- revenue side.
--
-- Never exposed to customers (§15).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sms_provider_costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      VARCHAR(30)  NOT NULL DEFAULT 'textsms',
  unit_cost     NUMERIC(10,4) NOT NULL CHECK (unit_cost >= 0),
  currency      CHAR(3)      NOT NULL DEFAULT 'KES',
  effective_from DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_cost_window_sane CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE sms_provider_costs IS
  'What Kitabu Yetu pays the provider per message, with validity dates so '
  'historical margin is computed against the cost that applied at the time. '
  'Internal only — never shown to customers (spec §15).';

CREATE UNIQUE INDEX idx_sms_provider_cost_current
  ON sms_provider_costs (provider) WHERE effective_to IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed — today's reality, then the proposal, inactive.
-- ─────────────────────────────────────────────────────────────────────────────

-- THE ONLY ACTIVE TIER: one flat band at 0.90, which is what every production
-- subscription charges right now. Shipping this migration therefore changes no
-- customer's price by construction.
INSERT INTO sms_pricing_tiers (name, min_credits, max_credits, unit_price, is_active, display_order, notes)
VALUES ('Standard', 0, NULL, 0.9000, true, 0,
        'Flat rate as charged today. Seeded active so migration 143 reprices nobody.');

-- The spec's §2 proposal, INACTIVE. Activating these is a deliberate admin
-- action. Note the spec's own "10,001–10,000" band is a typo for 10,001–50,000.
INSERT INTO sms_pricing_tiers (name, min_credits, max_credits, unit_price, is_active, display_order, notes)
VALUES
  ('Volume 1–5k',      0,      5000,   0.9000, false, 1, 'Proposed (spec §2), not active'),
  ('Volume 5k–10k',    5001,   10000,  0.8000, false, 2, 'Proposed (spec §2), not active'),
  ('Volume 10k–50k',   10001,  50000,  0.7000, false, 3, 'Proposed (spec §2), not active'),
  ('Volume 50k–100k',  50001,  100000, 0.6000, false, 4, 'Proposed (spec §2), not active'),
  ('Volume 100k+',     100001, NULL,   0.5000, false, 5, 'Proposed (spec §2), not active');

-- Packages from §3, inactive until there is a purchase flow to sell them.
-- Enterprise is 65,000 — the midpoint of the spec's own 60,000–70,000 range,
-- which it left open pending approved pricing.
INSERT INTO sms_packages (name, credits, price, is_active, is_recommended, display_order, description)
VALUES
  ('Starter',      5000,   4500.00,   false, false, 1, '5,000 SMS credits'),
  ('Growth',       10000,  8000.00,   false, false, 2, '10,000 SMS credits'),
  ('Professional', 25000,  17500.00,  false, false, 3, '25,000 SMS credits'),
  ('Enterprise',   100000, 65000.00,  false, false, 4, '100,000 SMS credits'),
  ('Enterprise+',  250000, 125000.00, false, false, 5, '250,000 SMS credits');

-- Provider cost, confirmed 2026-08-13. The figure first supplied was 3.50,
-- which against the 0.90 charged today would have meant losing 2.60 on every
-- message and made every band above loss-making; confirmed as a typo before
-- anything was built on it.
INSERT INTO sms_provider_costs (provider, unit_cost, notes)
VALUES ('textsms', 0.3500, 'Confirmed 2026-08-13. Gross margin 61% at 0.90 down to 30% at the proposed 0.50 floor.');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Grants.
--
-- These are configuration tables holding commercially sensitive data —
-- unit_cost in particular must never reach a customer (§15). Supabase grants
-- anon/authenticated on new public objects BY DEFAULT, and a view over these
-- would bypass RLS entirely, so both are revoked explicitly. Migration 142
-- exists because that default was missed once already.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sms_pricing_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_packages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_provider_costs  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sms_pricing_tiers, sms_packages, sms_provider_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON sms_pricing_tiers, sms_packages, sms_provider_costs TO service_role;

-- Tenants may read what is on sale; they may never read cost.
CREATE POLICY sms_pricing_tiers_read ON sms_pricing_tiers
  FOR SELECT USING (is_active);
CREATE POLICY sms_packages_read ON sms_packages
  FOR SELECT USING (is_active);
-- sms_provider_costs deliberately has NO policy: RLS on with no policy denies
-- every tenant read outright. Only service_role (which bypasses RLS) sees cost.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT ON public.sms_pricing_tiers TO app_tenant';
    EXECUTE 'GRANT SELECT ON public.sms_packages      TO app_tenant';
    -- Pointedly NOT sms_provider_costs.
  END IF;
END $do$;
