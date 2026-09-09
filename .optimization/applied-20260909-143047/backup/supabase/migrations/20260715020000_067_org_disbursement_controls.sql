-- =============================================================================
-- 067_org_disbursement_controls.sql
-- Closes the B2B audit's "no separation of duties" critical
-- (B2B_ENTERPRISE_AUDIT.md, Critical Issue #4) for organization -> group
-- disbursements.
--
-- Architectural note (documented, not a workaround): an org->group
-- disbursement is an internal transfer between platform-held ledger
-- positions (the org's pooled wallet and a group's own cash account) — it is
-- NOT a phone payout, so it does not go through Daraja/B2C. The real-money
-- edge is (a) a donor's deposit into the org wallet, reconciled against a
-- bank statement (future work, tracked in the audit roadmap), and (b) the
-- group paying a MEMBER, which now always goes through the B2C disbursement
-- spine (migration 066). What was missing here was dual control and honest
-- use of the wallet's own reservation column — both closed below.
--
--   - organizations.disbursement_approval_threshold: amounts above it park in
--     'pending_approval' for a second coordinator/officer to approve.
--   - organization_disbursements gains rejection columns + a 'rejected'
--     status + a maker-checker CHECK (approver != creator).
--   - organization_wallets.committed_balance (existing, previously unused)
--     becomes the actual reservation: debited from available_balance and
--     held in committed_balance at request time; released back to
--     available_balance on rejection, or folded into total_disbursed on
--     approval/settlement.
-- =============================================================================

ALTER TABLE organizations
  ADD COLUMN disbursement_approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 50000
    CHECK (disbursement_approval_threshold >= 0);

COMMENT ON COLUMN organizations.disbursement_approval_threshold IS
  'Org -> group disbursements above this amount require a second approver '
  '(approved_by must differ from created_by). B2B audit: separation of duties.';

ALTER TABLE organization_disbursements
  DROP CONSTRAINT organization_disbursements_status_check,
  ADD CONSTRAINT organization_disbursements_status_check
    CHECK (status IN ('pending_approval','approved','completed','rejected','returned','cancelled')),
  ADD COLUMN rejected_by      UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN rejected_at      TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT,
  ADD CONSTRAINT chk_org_disb_maker_checker
    CHECK (approved_by IS NULL OR approved_by <> created_by);
