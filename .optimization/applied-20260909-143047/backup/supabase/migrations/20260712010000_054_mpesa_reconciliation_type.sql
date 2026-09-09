-- =============================================================================
-- 054_mpesa_reconciliation_type.sql
-- The reconciliation engine records two kinds of runs (STK status sweep and
-- paybill orphan sweep) but the table had no column to distinguish them —
-- the paybill sweep INSERT referenced reconciliation_type and failed outright.
-- =============================================================================

ALTER TABLE mpesa_reconciliations
  ADD COLUMN IF NOT EXISTS reconciliation_type VARCHAR(20) NOT NULL DEFAULT 'stk'
    CHECK (reconciliation_type IN ('stk', 'paybill_sweep', 'balance_drift'));

COMMENT ON COLUMN mpesa_reconciliations.reconciliation_type IS
  'stk = STK Push status query sweep; paybill_sweep = orphaned C2B detection; balance_drift = accounts.balance vs journal_lines audit';
