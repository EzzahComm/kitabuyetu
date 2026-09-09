-- =============================================================================
-- 129: Recover the settlement / vendor-payment / platform-revenue schema
--
-- PRODUCTION_READINESS_AUDIT Pass 2 (docs/audit/02-ORPHAN-TABLES-AND-RLS-
-- PREDICATES.md): group_bank_accounts, settlement_approvals,
-- settlement_requests, vendor_payments, and platform_revenue are live in
-- production — schema, RLS, real data (platform_revenue holds 2 real rows) —
-- with NO CREATE TABLE anywhere in this migration history. git history
-- traces them to full feature commits (schema + service + routes + UI, per
-- their own messages) that were applied directly to production and then
-- excised from git entirely; their migration numbers (058/060/062) are now
-- reused by later, unrelated migrations.
--
-- Per the user (2026-08-09): this schema is real, intentional — the
-- disbursement/settlement layer for M-Pesa B2B/B2C vendor payments and
-- group bank settlements, not abandoned junk. This migration closes the
-- audit's actual finding (a fresh build cannot reproduce these 5 tables)
-- by capturing the live schema exactly as reverse-engineered from
-- production. It does NOT restore the missing service/route/UI layer that
-- once drove this schema — that's separate, larger feature-restoration
-- work, a deliberate decision to scope out of an audit-fix migration, not
-- an oversight. Zero behavior change: every object below already exists in
-- production; this migration only makes a fresh build/CI replay match it.
--
-- Schema reverse-engineered directly from live production
-- (information_schema/pg_constraint/pg_indexes/pg_policies), 2026-08-09.
-- =============================================================================

-- ─── platform_revenue_kind enum ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_revenue_kind') THEN
    CREATE TYPE public.platform_revenue_kind AS ENUM (
      'membership', 'sms_overage', 'transaction_fee', 'adjustment', 'member_optin'
    );
  END IF;
END $$;

-- ─── group_bank_accounts ─────────────────────────────────────────────────────
-- A group's own settlement destination — the bank account M-Pesa float gets
-- swept to. Dual-control: created 'pending_approval', a second officer
-- activates it (see settlement_approvals below).

CREATE TABLE IF NOT EXISTS public.group_bank_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  bank_name      text NOT NULL,
  shortcode      text NOT NULL,
  account_number text NOT NULL,
  label          text,
  status         text NOT NULL DEFAULT 'pending_approval'
                   CHECK (status IN ('pending_approval', 'active', 'rejected', 'disabled')),
  created_by     uuid REFERENCES public.members (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  activated_at   timestamptz,
  notes          text
);

CREATE INDEX IF NOT EXISTS idx_group_bank_accounts_group      ON public.group_bank_accounts (group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_bank_accounts_created_by ON public.group_bank_accounts (created_by);

-- ─── settlement_requests ─────────────────────────────────────────────────────
-- A group's request to sweep funds to one of its group_bank_accounts.
-- originator_conversation_id is Daraja's B2B conversation id for the sweep.

CREATE TABLE IF NOT EXISTS public.settlement_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  bank_account_id             uuid NOT NULL REFERENCES public.group_bank_accounts (id) ON DELETE RESTRICT,
  amount                      numeric(14,2) NOT NULL CHECK (amount > 0),
  status                      text NOT NULL DEFAULT 'pending_approval'
                                CHECK (status IN ('pending_approval', 'approved', 'processing', 'completed', 'failed', 'rejected')),
  requested_by                uuid REFERENCES public.members (id) ON DELETE SET NULL,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  originator_conversation_id  text,
  journal_entry_id            uuid,
  platform_fee                numeric(12,2),
  completed_at                timestamptz,
  failure_reason              text,
  notes                       text
);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_group           ON public.settlement_requests (group_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_bank_account_id ON public.settlement_requests (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_requested_by    ON public.settlement_requests (requested_by);

-- ─── vendor_payments ──────────────────────────────────────────────────────────
-- A group paying an external vendor via M-Pesa B2C (phone) or B2B
-- (paybill/till shortcode+account), posted to the group's own expense GL
-- account (default 5001) once settled.

CREATE TABLE IF NOT EXISTS public.vendor_payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  channel                     text NOT NULL CHECK (channel IN ('b2c', 'b2b')),
  payee_name                  text NOT NULL,
  payee_phone                 text,
  payee_shortcode             text,
  payee_account               text,
  amount                      numeric(14,2) NOT NULL CHECK (amount > 0),
  expense_account_code        text NOT NULL DEFAULT '5001',
  description                 text,
  status                      text NOT NULL DEFAULT 'pending_approval'
                                CHECK (status IN ('pending_approval', 'approved', 'processing', 'completed', 'failed', 'rejected')),
  requested_by                uuid REFERENCES public.members (id) ON DELETE SET NULL,
  requested_at                timestamptz NOT NULL DEFAULT now(),
  originator_conversation_id  text,
  journal_entry_id            uuid,
  platform_fee                numeric(12,2),
  completed_at                timestamptz,
  failure_reason              text,

  CONSTRAINT vendor_payments_dest_chk CHECK (
    (channel = 'b2c' AND payee_phone IS NOT NULL)
    OR (channel = 'b2b' AND payee_shortcode IS NOT NULL AND payee_account IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_payments_group        ON public.vendor_payments (group_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_requested_by ON public.vendor_payments (requested_by);

-- ─── settlement_approvals ─────────────────────────────────────────────────────
-- Shared dual-control ledger: one row per approve/reject decision on a
-- bank_account activation, a settlement_request, or a vendor_payment.
-- The UNIQUE constraint is the maker-checker guard — one decision per
-- (subject, approver).

CREATE TABLE IF NOT EXISTS public.settlement_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   text NOT NULL CHECK (subject_type IN ('bank_account', 'settlement', 'vendor_payment')),
  subject_id     uuid NOT NULL,
  group_id       uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  approver_id    uuid NOT NULL,
  approver_kind  text NOT NULL CHECK (approver_kind IN ('officer', 'backoffice')),
  decision       text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT settlement_approvals_unique UNIQUE (subject_type, subject_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_approvals_subject  ON public.settlement_approvals (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_settlement_approvals_group_id ON public.settlement_approvals (group_id);

-- ─── platform_revenue ─────────────────────────────────────────────────────────
-- Platform-side revenue ledger (member opt-in fees, SMS overage, transaction
-- fees, manual adjustments). Holds real historical data in production
-- (2 rows, both 'member_optin', dated 2026-06-05/06).

CREATE TABLE IF NOT EXISTS public.platform_revenue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  kind           public.platform_revenue_kind NOT NULL,
  amount         numeric(12,2) NOT NULL CHECK (amount >= 0),
  period         date,
  reference_type text,
  reference_id   uuid,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_group ON public.platform_revenue (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_revenue_kind  ON public.platform_revenue (kind, period);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Matches what's live today: enabled, one SELECT-only policy per table
-- (group-scoped, super_admin sees across groups). No INSERT/UPDATE/DELETE
-- policy exists for any of these 5 tables in production either — consistent
-- with the missing service layer above; nothing app_tenant-scoped can
-- currently write to them, only postgres (BYPASSRLS) can, exactly as today.

ALTER TABLE public.group_bank_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_revenue     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_bank_accounts_select  ON public.group_bank_accounts;
CREATE POLICY group_bank_accounts_select ON public.group_bank_accounts
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

DROP POLICY IF EXISTS settlement_requests_select  ON public.settlement_requests;
CREATE POLICY settlement_requests_select ON public.settlement_requests
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

DROP POLICY IF EXISTS vendor_payments_select  ON public.vendor_payments;
CREATE POLICY vendor_payments_select ON public.vendor_payments
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

DROP POLICY IF EXISTS settlement_approvals_select  ON public.settlement_approvals;
CREATE POLICY settlement_approvals_select ON public.settlement_approvals
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());

DROP POLICY IF EXISTS platform_revenue_select  ON public.platform_revenue;
CREATE POLICY platform_revenue_select ON public.platform_revenue
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
