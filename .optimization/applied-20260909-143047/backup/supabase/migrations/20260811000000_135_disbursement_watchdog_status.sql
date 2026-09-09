-- =============================================================================
-- 135: Disbursement watchdog — 'timed_out' status for settlements/vendor payments
--
-- Closes B2C_DISBURSEMENT_AUDIT.md C5 ("a dropped result callback strands the
-- payment in 'initiated' forever with its true state unknown") for all three
-- money-out spines, not just B2C. disbursement_requests already carries both
-- what's needed (disbursement_status enum's 'timed_out'/'reconciled' values +
-- a reconciled_at column, migration 066) — they were simply never written to.
-- settlement_requests/vendor_payments (recovered schema, migration 129) use a
-- plain text CHECK instead of an enum and have no reconciled_at at all, so
-- both need widening here to reach parity.
--
-- This migration only adds vocabulary; it does not change what writes to it.
-- See lib/services/disbursement-watchdog.service.ts (Upstash Workflow watchdog,
-- docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md §9) for the first writer.
--
-- No RLS change needed: the watchdog resolves rows via withAdminDb, same as
-- every existing dispatch*/release*Reservation function on these tables.
-- =============================================================================

ALTER TABLE settlement_requests ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE vendor_payments     ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE settlement_requests
  DROP CONSTRAINT settlement_requests_status_check,
  ADD CONSTRAINT settlement_requests_status_check
    CHECK (status IN ('pending_approval', 'approved', 'processing', 'completed',
                       'failed', 'rejected', 'timed_out', 'reconciled'));

ALTER TABLE vendor_payments
  DROP CONSTRAINT vendor_payments_status_check,
  ADD CONSTRAINT vendor_payments_status_check
    CHECK (status IN ('pending_approval', 'approved', 'processing', 'completed',
                       'failed', 'rejected', 'timed_out', 'reconciled'));

COMMENT ON COLUMN settlement_requests.reconciled_at IS
  'Set once a human/ops action resolves a timed_out row''s true outcome. NULL '
  'means an unresolved timed_out row must keep surfacing in findStuckSettlements.';
COMMENT ON COLUMN vendor_payments.reconciled_at IS
  'Set once a human/ops action resolves a timed_out row''s true outcome. NULL '
  'means an unresolved timed_out row must keep surfacing in findStuckVendorPayments.';
