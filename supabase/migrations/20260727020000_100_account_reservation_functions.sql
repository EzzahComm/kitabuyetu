-- ─────────────────────────────────────────────────────────────────────────────
-- 100: lock_group_cash_account() / adjust_account_reserved_amount()
--
-- Context: docs/adr/001-bypassrls-two-role-split.md (ADR-001) Phase 1,
-- continuing migrations 098/099's fixes in the same session. This is the
-- third and last app_tenant gap found in disbursements.service.ts's
-- reservation-accounting flow (B2C_DISBURSEMENT_AUDIT.md's C1/C4):
--
--   - initiateDisbursement() does `SELECT ... FROM accounts ... FOR UPDATE`
--     to lock the group's Cash account (1001) before its balance check —
--     never followed by a write itself.
--   - initiateDisbursement() and reject() both do
--     `UPDATE accounts SET reserved_amount = reserved_amount +/- $1` to
--     earmark/release funds.
--
-- All three run over the tenant connection (withTransaction(ctx, ...)), and
-- all three are blocked by accounts_update's `is_system = false` guard
-- (migration 050) the same way migration 099's trigger was: SELECT ... FOR
-- UPDATE requires passing the UPDATE policy's USING expression too (not just
-- SELECT's), and every real Cash/Bank/Loans-Receivable account is seeded
-- is_system = true. Confirmed as a real, currently-failing gap by this
-- branch's own app_tenant CI proof — grep confirms these are the *only*
-- accounts FOR UPDATE / reserved_amount UPDATE call sites anywhere in the
-- service layer that run under a tenant (non-admin) connection; mpesa-b2c.
-- service.ts's equivalent releaseDisbursementReservation() already runs
-- under withAdminDb (it's a webhook callback, no tenant context to begin
-- with) and is unaffected.
--
-- Fix: same SECURITY DEFINER pattern as migrations 098/099. Neither function
-- below does anything a tenant-context caller couldn't already legitimately
-- trigger through the app (lock its own group's cash account; adjust its own
-- reservation by a caller-supplied delta) — accounts_update's is_system
-- guard was protecting against ad-hoc edits to the chart-of-accounts
-- skeleton itself (renaming/retyping a system account), not against this
-- narrow, already-audited reservation mechanism.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lock_group_cash_account(
  p_group_id     uuid,
  p_account_code text
)
RETURNS TABLE (id uuid, balance numeric, reserved_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT a.id, a.balance, a.reserved_amount
    FROM public.accounts a
    WHERE a.group_id = p_group_id
      AND a.account_code = p_account_code
      AND a.is_active = true
    FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION public.lock_group_cash_account IS
  'SECURITY DEFINER — SELECT ... FOR UPDATE on a group''s own account, callable by app_tenant despite accounts_update''s is_system guard. Read-only: never writes. See migration 100.';

CREATE OR REPLACE FUNCTION public.adjust_account_reserved_amount(
  p_account_id uuid,
  p_delta      numeric
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.accounts SET reserved_amount = reserved_amount + p_delta WHERE id = p_account_id;
$$;

COMMENT ON FUNCTION public.adjust_account_reserved_amount IS
  'SECURITY DEFINER — adjusts accounts.reserved_amount by a caller-supplied signed delta (positive to reserve, negative to release), callable by app_tenant despite accounts_update''s is_system guard. The reserved_amount >= 0 CHECK constraint still applies unchanged. See migration 100.';
