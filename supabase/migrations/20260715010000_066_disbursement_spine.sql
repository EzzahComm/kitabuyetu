-- =============================================================================
-- 066_disbursement_spine.sql
-- Closes B2C audit blockers C1-C5 (B2C_DISBURSEMENT_AUDIT.md): a single
-- reservation-based, idempotent, maker-checked spine in front of every real
-- M-Pesa B2C payout (loan disbursement today; any future group→member payout
-- reuses it).
--
--   C1 (no balance check)      -> accounts.reserved_amount + reservation at
--                                  request time; available = balance - reserved
--   C2 (no idempotency)        -> disbursement_requests.idempotency_key UNIQUE
--   C3 (no maker-checker)      -> groups.disbursement_approval_threshold +
--                                  approved_by <> initiated_by CHECK
--   C4 (bypasses wallet ctrl)  -> the spine IS the only path to initiateB2C()
--   C5 (no outbound recon)     -> status + created_at index feeds a
--                                  Transaction Status Query sweep (job, code)
--
-- Scope: group-funded, phone-targeted payouts (loan disbursement first).
-- Org -> group transfers are a distinct internal ledger movement, hardened
-- separately in migration 067 (organization_disbursements dual control).
-- =============================================================================

-- ─── 1. Reservation on the group's cash account ─────────────────────────────
-- available = balance - reserved_amount. Reserved at request time (before the
-- Daraja call), released on failure/rejection, left in place (already spent)
-- once the disbursement completes and books it via the normal journal.

ALTER TABLE accounts
  ADD COLUMN reserved_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0);

COMMENT ON COLUMN accounts.reserved_amount IS
  'Earmarked for in-flight disbursement_requests (payment architecture: '
  'disbursement spine, B2C audit C1). available = balance - reserved_amount.';

-- ─── 2. Maker-checker threshold per group ───────────────────────────────────

ALTER TABLE groups
  ADD COLUMN disbursement_approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 20000
    CHECK (disbursement_approval_threshold >= 0);

COMMENT ON COLUMN groups.disbursement_approval_threshold IS
  'B2C payouts above this amount require a second officer (approved_by must '
  'differ from initiated_by) before Daraja is called. B2C audit C3.';

-- ─── 3. The spine ────────────────────────────────────────────────────────────

CREATE TYPE disbursement_status AS ENUM (
  'pending_approval', 'approved', 'rejected',
  'dispatched', 'completed', 'failed', 'timed_out', 'reconciled'
);

CREATE TABLE disbursement_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key      TEXT NOT NULL,
  group_id             UUID NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  loan_id              UUID REFERENCES loans (id) ON DELETE RESTRICT,
  cash_account_id      UUID NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  phone                TEXT NOT NULL,
  amount               NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  command_id           TEXT NOT NULL DEFAULT 'BusinessPayment',
  occasion             TEXT,
  status               disbursement_status NOT NULL DEFAULT 'pending_approval',
  requires_approval    BOOLEAN NOT NULL DEFAULT false,
  initiated_by         UUID NOT NULL REFERENCES members (id),
  approved_by          UUID REFERENCES members (id),
  approved_at          TIMESTAMPTZ,
  rejected_by          UUID REFERENCES members (id),
  rejected_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  b2c_transaction_id   UUID,   -- FK added after mpesa_b2c_transactions gains the reverse column (below)
  mpesa_receipt_number TEXT,
  failure_reason       TEXT,
  dispatched_at        TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  reconciled_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Maker-checker (mirrors payment_reallocations, mig 063): the approver can
  -- never be the initiator.
  CONSTRAINT chk_disb_maker_checker CHECK (approved_by IS NULL OR approved_by <> initiated_by),
  -- Idempotency (C2): the same client-supplied key for the same group can
  -- never create a second request — a double-click or retry returns the
  -- existing row instead of a second real payout.
  CONSTRAINT uq_disb_idempotency UNIQUE (group_id, idempotency_key)
);

CREATE INDEX idx_disb_status_created ON disbursement_requests (status, created_at);
CREATE INDEX idx_disb_loan           ON disbursement_requests (loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX idx_disb_group          ON disbursement_requests (group_id, created_at DESC);

CREATE TRIGGER trg_disb_updated_at
  BEFORE UPDATE ON disbursement_requests
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE disbursement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_requests FORCE  ROW LEVEL SECURITY;

CREATE POLICY disbursement_requests_select ON disbursement_requests
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY disbursement_requests_insert ON disbursement_requests
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY disbursement_requests_update ON disbursement_requests
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

-- ─── 4. Link the spine to the existing B2C transaction row ──────────────────
-- One disbursement_request drives at most one Daraja attempt at a time (a
-- rejected/failed request that's retried creates a NEW request with a new
-- idempotency key, never reuses the row) — UNIQUE, not just indexed.

ALTER TABLE mpesa_b2c_transactions
  ADD COLUMN disbursement_request_id UUID REFERENCES disbursement_requests (id),
  ADD CONSTRAINT uq_b2c_disbursement_request UNIQUE (disbursement_request_id);

ALTER TABLE disbursement_requests
  ADD CONSTRAINT fk_disb_b2c_transaction
    FOREIGN KEY (b2c_transaction_id) REFERENCES mpesa_b2c_transactions (id);

-- ─── 5. Borrower notification on completion (B2C audit F10) ─────────────────
-- The 'loan_disbursed' template has existed since the SMS system's earliest
-- migration but nothing ever fired it — wire the rule so emitBusinessEvent
-- ('loan.disbursed') actually reaches the borrower.

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
SELECT
  'loan_disbursed_notice',
  'Notify the borrower when their loan disbursement completes via B2C.',
  'loan.disbursed',
  'loan_disbursed',
  '{"type":"event_member","field":"memberId"}'::jsonb,
  '{"field":"memberId","op":"exists"}'::jsonb
WHERE EXISTS (SELECT 1 FROM sms_templates WHERE template_key = 'loan_disbursed')
  AND NOT EXISTS (SELECT 1 FROM sms_trigger_rules WHERE name = 'loan_disbursed_notice');
