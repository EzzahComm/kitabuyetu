-- =============================================================================
-- 134: Bank Accounts / Settlements / Vendor Payments — service-layer support
--
-- Phase 1 of the plan rebuilding the missing application code for
-- group_bank_accounts / settlement_requests / settlement_approvals /
-- vendor_payments (schema recovered in migration 129; that migration's own
-- header notes the tables were SELECT-only, "nothing app_tenant-scoped can
-- currently write to them" — this migration closes that so the new service
-- layer can actually write through the tenant pool).
--
-- 1. Idempotency: settlement_requests/vendor_payments had no idempotency
--    column (unlike disbursement_requests' uq_disb_idempotency) — a real gap
--    for a real-money POST endpoint (double-click/client-retry must not fire
--    two Daraja calls). Additive, nullable, non-breaking.
-- 2. source_account on settlement_requests: MPESA_SETTLEMENT_SHORTCODE
--    (already declared in lib/env.ts, unused anywhere) is a reconciliation
--    tag identifying which of the group's M-Pesa sub-accounts a sweep drew
--    from — not a Daraja PartyA override (that's always the group's own
--    shortcode) and not the destination (group_bank_accounts.shortcode is
--    the real destination).
-- 3. INSERT/UPDATE RLS policies on all 4 tables, mirroring
--    disbursement_requests' exact shape (migration 066).
-- 4. Two new posting-template seeds (settlement_sweep, vendor_payment),
--    matching migration 090's pattern exactly — seeded to the same mapping
--    posting-templates.service.ts's DEFAULT_TEMPLATES constant carries, so
--    this changes zero behavior versus the code-level default; it exists so
--    a tenant/organization can override the account codes later exactly
--    like every other event.
-- =============================================================================

-- ─── 1-2. Idempotency + reconciliation columns ──────────────────────────────

ALTER TABLE settlement_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE settlement_requests ADD COLUMN IF NOT EXISTS source_account   text;
ALTER TABLE vendor_payments     ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_requests_idempotency
  ON settlement_requests (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_payments_idempotency
  ON vendor_payments (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─── 3. INSERT/UPDATE RLS policies (SELECT-only today, per migration 129) ───

CREATE POLICY group_bank_accounts_insert ON public.group_bank_accounts
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY group_bank_accounts_update ON public.group_bank_accounts
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY settlement_requests_insert ON public.settlement_requests
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY settlement_requests_update ON public.settlement_requests
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY vendor_payments_insert ON public.vendor_payments
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY vendor_payments_update ON public.vendor_payments
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY settlement_approvals_insert ON public.settlement_approvals
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());
-- No UPDATE policy for settlement_approvals: rows are append-only decisions
-- (one per approver per subject, enforced by settlement_approvals_unique),
-- never edited after the fact — same immutable-decision-log posture
-- audit_logs and reminder_dispatch_log already use elsewhere in this schema.

-- ─── 4. Posting templates ────────────────────────────────────────────────────

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('accounting', 'posting_template.settlement_sweep', '{"lines": [
     {"accountCode": "1002", "side": "debit",  "amount": "amount"},
     {"accountCode": "1001", "side": "credit", "amount": "amount"},
     {"accountCode": "5001", "side": "debit",  "amount": "fee"},
     {"accountCode": "1001", "side": "credit", "amount": "fee"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.vendor_payment', '{"lines": [
     {"accountCode": "5001", "side": "debit",  "amount": "amount"},
     {"accountCode": "1001", "side": "credit", "amount": "amount"},
     {"accountCode": "5001", "side": "debit",  "amount": "fee"},
     {"accountCode": "1001", "side": "credit", "amount": "fee"}
   ]}'::jsonb, 1);
