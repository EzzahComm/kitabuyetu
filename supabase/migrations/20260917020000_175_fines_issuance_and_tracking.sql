-- =============================================================================
-- 175: fines issuance and tracking
--
-- fine-policy.service.ts (migration 088) is advisory only — a per-offence
-- tariff schedule, nothing more; its own header says so ("nothing
-- auto-charges them"). 'fine' has existed as a payment_requests.product enum
-- value since migration 059, but dispatchProduct (mpesa-allocation.service.ts)
-- has no handler for it — a 'fine' payment_request can never be auto-fulfilled
-- by the M-Pesa engine today, only routed to the unrouted queue like an
-- unclaimed 'share' purchase. Net effect: no service anywhere actually issues
-- a fine against a member or tracks issued -> paid/waived/cancelled. This
-- migration adds that ledger.
--
-- Design mirrors welfare_requests (migration 021 + its later
-- group_membership_id addition) closely: group_id/member_id/
-- group_membership_id (audit H-1 stamp), a lifecycle status column, and a
-- by/at/reason triple per terminal transition (waived_*, cancelled_*,
-- matching approved_by/rejected_by/disbursed_by's shape on welfare_requests).
--
-- amount is snapshotted at issuance (NOT a live reference into the tariff
-- schedule) — a later rate change must never alter a historical fine, exactly
-- like a loan's terms are snapshotted onto the loan row rather than read live
-- from loan_policy at repayment time.
--
-- payment_request_id links to payment_requests (migration 059) once
-- collection is initiated — reusing that mechanism's STK/PayBill purpose
-- linkage rather than inventing a parallel one. This is 'fine' payment_requests'
-- first real writer.
-- =============================================================================

CREATE TABLE public.fines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  member_id            uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  group_membership_id  uuid NOT NULL REFERENCES public.group_members (id) ON DELETE CASCADE,

  -- Offence key. Free text, not an enum: fine-policy.service.ts's schedule
  -- keys are group-defined (validateSchedule allows any non-blank category
  -- name), so a fixed enum here would reject legitimate group-specific
  -- offence categories the schedule already accepts.
  fine_type            text NOT NULL,

  -- Snapshotted at issuance — see header. Either the tariff schedule's
  -- suggested amount at issue time, or an explicit officer override.
  amount               numeric(12,2) NOT NULL CHECK (amount > 0),
  reason               text,

  status               text NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued', 'paid', 'waived', 'cancelled')),

  issued_by            uuid REFERENCES public.members (id) ON DELETE SET NULL,
  issued_at            timestamptz NOT NULL DEFAULT now(),

  payment_request_id   uuid REFERENCES public.payment_requests (id) ON DELETE SET NULL,
  paid_at              timestamptz,

  waived_by            uuid REFERENCES public.members (id) ON DELETE SET NULL,
  waived_at            timestamptz,
  waived_reason        text,

  cancelled_by         uuid REFERENCES public.members (id) ON DELETE SET NULL,
  cancelled_at         timestamptz,
  cancel_reason        text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fines_group             ON public.fines (group_id, issued_at DESC);
CREATE INDEX idx_fines_member            ON public.fines (member_id);
CREATE INDEX idx_fines_group_status      ON public.fines (group_id, status);
CREATE INDEX idx_fines_payment_request   ON public.fines (payment_request_id)
  WHERE payment_request_id IS NOT NULL;

COMMENT ON TABLE public.fines IS
  'A fine actually issued against a member (migration 175) — issued -> '
  'paid/waived/cancelled. fine-policy.service.ts remains the advisory tariff '
  'schedule this reads a suggested amount from; amount here is a snapshot, '
  'not a live reference. Collection rides payment_requests (product=''fine''), '
  'never a parallel mechanism.';
COMMENT ON COLUMN public.fines.amount IS
  'Snapshotted at issuance from the tariff schedule (or an explicit officer '
  'override) — a later rate change must never alter a historical fine.';

CREATE TRIGGER trg_fines_updated_at
  BEFORE UPDATE ON public.fines
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Same shape as payment_requests (migration 059): group-scoped, no NULL-context
-- branches, super_admin sees across groups. The app pool role has BYPASSRLS in
-- production; these policies fence PostgREST/app_tenant roles.

ALTER TABLE public.fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fines FORCE  ROW LEVEL SECURITY;

CREATE POLICY fines_select ON public.fines
  FOR SELECT USING (
    is_super_admin() OR group_id = app_current_group_id()
  );
CREATE POLICY fines_insert ON public.fines
  FOR INSERT WITH CHECK (
    is_super_admin() OR group_id = app_current_group_id()
  );
CREATE POLICY fines_update ON public.fines
  FOR UPDATE USING (
    is_super_admin() OR group_id = app_current_group_id()
  );

-- ─── Grants ───────────────────────────────────────────────────────────────────
-- Supabase's default privileges hand every new public table full rights to
-- anon/authenticated — revoked outright (migration 156's rationale): this
-- table is reached only through the app's own Postgres connection
-- (withDb/withTransaction as app_tenant), never through PostgREST.

REVOKE ALL ON public.fines FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.fines TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001) and does not
-- exist in a fresh/CI Postgres replay — a plain GRANT would abort the run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.fines TO app_tenant';
  END IF;
END $$;
