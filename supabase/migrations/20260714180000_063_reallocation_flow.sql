-- =============================================================================
-- 063_reallocation_flow.sql
-- Reallocation correction flow (PAYMENT_ARCHITECTURE_REDESIGN.md §3.4, §11,
-- §15.5; ADR-8, ADR-20) — closes the last Phase 3 item.
--
-- payment_reallocations (created 057) gains the lifecycle needed by
-- maker-checker: initiations above groups.reallocation_approval_threshold
-- wait in 'pending_approval' for a SECOND officer (approved_by must differ
-- from initiated_by — enforced by CHECK and by the service); below-threshold
-- corrections execute immediately under single control.
--
-- Membership attribution (§6a) is added for both sides of the correction.
-- =============================================================================

ALTER TABLE payment_reallocations
  ADD COLUMN status TEXT NOT NULL DEFAULT 'executed'
    CHECK (status IN ('pending_approval', 'executed', 'rejected')),
  ADD COLUMN approved_at              TIMESTAMPTZ,
  ADD COLUMN rejected_by              UUID REFERENCES members (id),
  ADD COLUMN rejected_at              TIMESTAMPTZ,
  ADD COLUMN rejection_reason         TEXT,
  ADD COLUMN executed_at              TIMESTAMPTZ,
  ADD COLUMN from_group_membership_id UUID REFERENCES group_members (id),
  ADD COLUMN to_group_membership_id   UUID REFERENCES group_members (id);

-- Maker-checker (ADR-20): the approver can never be the initiator.
ALTER TABLE payment_reallocations
  ADD CONSTRAINT chk_realloc_maker_checker
    CHECK (approved_by IS NULL OR approved_by <> initiated_by);

CREATE INDEX idx_payment_reallocs_status
  ON payment_reallocations (from_group_id, status, created_at DESC);

-- One live correction per payment: while a reallocation is pending or
-- executed, no second one may be opened for the same payment. (Rejected
-- attempts don't block a retry.)
CREATE UNIQUE INDEX uq_payment_reallocs_active
  ON payment_reallocations (payment_id)
  WHERE status IN ('pending_approval', 'executed');
