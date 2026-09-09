-- =============================================================================
-- 059_payment_requests_allocation.sql
-- Phase 2 of the payment architecture redesign (PAYMENT_ARCHITECTURE_REDESIGN.md
-- §3.5/§3.6, ADR-10, ADR-15):
--
--   1. payment_product enum
--   2. payment_requests — purpose linkage for STK + PayBill allocation.
--      Requests are an OPTIMIZATION, never a dependency: a bare membership
--      number always allocates via member/group defaults.
--   3. Member + group default products (allocation tiers A7/A8)
--   4. contribution_status gains 'partially_paid' (ADR-15 — partial payments
--      never complete an obligation). Added here, used only by code after
--      this migration commits (PG rule: new enum values are unusable in the
--      transaction that adds them).
--   5. welfare_pool_contributions.recorded_by relaxed to NULL — auto-routed
--      PayBill welfare payments have no human recorder (parity with
--      contributions.recorded_by, already nullable).
-- =============================================================================

-- ─── 1. Product enum ─────────────────────────────────────────────────────────

CREATE TYPE payment_product AS ENUM (
  'savings', 'loan_repayment', 'welfare', 'share',
  'investment', 'fine', 'registration', 'subscription'
);

-- ─── 2. payment_requests ─────────────────────────────────────────────────────

CREATE TABLE payment_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  group_membership_id  UUID NOT NULL REFERENCES group_members (id) ON DELETE CASCADE,
  member_id            UUID NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  product              payment_product NOT NULL,
  entity_id            UUID,            -- loan_repayment id, share class, welfare period…
  amount               NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','fulfilled','expired','cancelled')),
  expires_at           TIMESTAMPTZ,
  created_by           UUID REFERENCES members (id) ON DELETE SET NULL,
  fulfilled_by_payment UUID REFERENCES payments (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One payment fulfils at most one request (§3.6 concurrency latch).
  CONSTRAINT payment_requests_fulfilment_unique UNIQUE (fulfilled_by_payment)
);

-- Allocation-engine lookup: open requests for a membership.
CREATE INDEX idx_payment_requests_open
  ON payment_requests (group_membership_id, created_at)
  WHERE status = 'open';
-- Expiry sweep.
CREATE INDEX idx_payment_requests_expiry
  ON payment_requests (expires_at)
  WHERE status = 'open' AND expires_at IS NOT NULL;
CREATE INDEX idx_payment_requests_group
  ON payment_requests (group_id, created_at DESC);

CREATE TRIGGER trg_payment_requests_updated_at
  BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests FORCE  ROW LEVEL SECURITY;

-- Group-scoped, no NULL-context branches (migration 058 lesson: the app pool
-- role has BYPASSRLS; these policies fence PostgREST roles only).
CREATE POLICY payment_requests_select ON payment_requests
  FOR SELECT USING (
    is_super_admin() OR group_id = (SELECT app_current_group_id())
  );
CREATE POLICY payment_requests_insert ON payment_requests
  FOR INSERT WITH CHECK (
    is_super_admin() OR group_id = (SELECT app_current_group_id())
  );
CREATE POLICY payment_requests_update ON payment_requests
  FOR UPDATE USING (
    is_super_admin() OR group_id = (SELECT app_current_group_id())
  );

-- ─── 3. Default products (allocation tiers A7 / A8) ─────────────────────────

ALTER TABLE groups
  ADD COLUMN default_product payment_product NOT NULL DEFAULT 'savings';

COMMENT ON COLUMN groups.default_product IS
  'Allocation tier A8: where a bare membership-number payment lands when no '
  'request, suffix, or member default applies. Default: savings.';

ALTER TABLE group_members
  ADD COLUMN default_product payment_product;

COMMENT ON COLUMN group_members.default_product IS
  'Allocation tier A7: per-membership default product for bare membership- '
  'number payments. NULL = fall through to the group default (A8).';

-- ─── 4. partially_paid (ADR-15) ──────────────────────────────────────────────

ALTER TYPE contribution_status ADD VALUE IF NOT EXISTS 'partially_paid';

-- ─── 5. Auto-routed welfare has no human recorder ────────────────────────────

ALTER TABLE welfare_pool_contributions
  ALTER COLUMN recorded_by DROP NOT NULL;
