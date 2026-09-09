-- =============================================================================
-- 061_membership_not_null.sql
-- Phase 3.1 closeout (PAYMENT_ARCHITECTURE_REDESIGN.md §6a: backfill → SET
-- NOT NULL). Applied after the Phase 3.1 code sweep (commit 8bdc4cd) was
-- deployed and verified: every application insert path and both DB routines
-- (generate_loan_schedule, trg_apply_share_txn) stamp group_membership_id,
-- and production holds zero NULL rows. From here an unattributed financial
-- row is unrepresentable.
-- =============================================================================

ALTER TABLE contributions              ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE loans                      ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE loan_repayments            ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE welfare_pool_contributions ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE welfare_requests           ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE share_transactions         ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE share_holdings             ALTER COLUMN group_membership_id SET NOT NULL;
ALTER TABLE dividend_allocations       ALTER COLUMN group_membership_id SET NOT NULL;
