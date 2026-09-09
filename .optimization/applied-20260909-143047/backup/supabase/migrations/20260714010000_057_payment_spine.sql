-- =============================================================================
-- 057_payment_spine.sql
-- Phase 1.5 of the payment architecture redesign (PAYMENT_ARCHITECTURE_REDESIGN.md
-- §3.4, §7, §11, §12): every inbound shilling lands on the `payments` row (the
-- SPINE) before any domain effect.
--
--   1. payments.allocation_status  — receipt-vs-allocation state machine
--   2. payments.currency           — multi-currency ready (ADR-13)
--   3. payments audit columns      — channel / initiated_by / session / request / ip
--      + is_third_party            — payer ≠ member flag (§3.3 R9)
--   4. payment_id back-links       — contributions, loan_repayments,
--      welfare_pool_contributions, share_transactions (+ per-table UNIQUE:
--      one payment can never allocate twice into the same product table)
--   5. payment_events              — append-only audit trail (§7)
--   6. payment_reallocations       — contra-entry correction record (§3.4;
--      maker-checker FLOW lands in Phase 3, schema lands now)
--   7. event_outbox                — transactional outbox (§12, ADR-17)
-- =============================================================================

-- ─── 1–3. Spine columns ──────────────────────────────────────────────────────

ALTER TABLE payments
  ADD COLUMN allocation_status TEXT NOT NULL DEFAULT 'received'
    CHECK (allocation_status IN ('received','allocated','unrouted','reallocated','reversed')),
  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN channel TEXT
    CHECK (channel IN ('stk','paybill','import','manual','api','bank_va','card','airtel')),
  ADD COLUMN is_third_party BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN initiated_by UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN session_id   UUID,
  ADD COLUMN request_id   TEXT,
  ADD COLUMN client_ip    INET;

COMMENT ON COLUMN payments.allocation_status IS
  'Receipt-vs-allocation state machine (payment architecture §3.4/§11): '
  'received → allocated | unrouted; allocated → reallocated | reversed. '
  'Exactly-once allocation is enforced here plus UNIQUE(payment_id) per '
  'domain table. Orphan monitoring alerts on completed rows stuck in '
  '''received'' (recent rows only — pre-spine history keeps ''received'' '
  'unless provably linked, and the monitor uses a recency window).';

-- Orphan-monitor index: completed money that never allocated.
CREATE INDEX idx_payments_alloc_orphans ON payments (payment_date)
  WHERE status = 'completed' AND allocation_status = 'received';

-- ─── 4. payment_id back-links on the product tables ─────────────────────────

ALTER TABLE contributions              ADD COLUMN payment_id UUID REFERENCES payments (id) ON DELETE SET NULL;
ALTER TABLE loan_repayments            ADD COLUMN payment_id UUID REFERENCES payments (id) ON DELETE SET NULL;
ALTER TABLE welfare_pool_contributions ADD COLUMN payment_id UUID REFERENCES payments (id) ON DELETE SET NULL;
ALTER TABLE share_transactions         ADD COLUMN payment_id UUID REFERENCES payments (id) ON DELETE SET NULL;

-- One payment allocates at most once per product table (§6c idempotency).
CREATE UNIQUE INDEX uq_contributions_payment ON contributions (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_loan_repayments_payment ON loan_repayments (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_welfare_pool_payment ON welfare_pool_contributions (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_share_txn_payment ON share_transactions (payment_id)
  WHERE payment_id IS NOT NULL;

-- Backfill by receipt where the linkage is provable.
UPDATE contributions c
SET    payment_id = p.id
FROM   payments p
WHERE  c.payment_id IS NULL
  AND  c.mpesa_receipt_number IS NOT NULL
  AND  p.mpesa_receipt_number = c.mpesa_receipt_number;

UPDATE loan_repayments lr
SET    payment_id = p.id
FROM   payments p
WHERE  lr.payment_id IS NULL
  AND  lr.mpesa_receipt_number IS NOT NULL
  AND  p.mpesa_receipt_number = lr.mpesa_receipt_number;

UPDATE welfare_pool_contributions w
SET    payment_id = p.id
FROM   payments p
WHERE  w.payment_id IS NULL
  AND  w.mpesa_receipt_number IS NOT NULL
  AND  p.mpesa_receipt_number = w.mpesa_receipt_number;

-- Backfill allocation_status honestly: only provable linkages flip state.
UPDATE payments p SET allocation_status = 'allocated'
WHERE  p.status = 'completed'
  AND  p.allocation_status = 'received'
  AND (p.invoice_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM contributions              c WHERE c.payment_id  = p.id)
    OR EXISTS (SELECT 1 FROM loan_repayments            l WHERE l.payment_id  = p.id)
    OR EXISTS (SELECT 1 FROM welfare_pool_contributions w WHERE w.payment_id  = p.id));

UPDATE payments p SET allocation_status = 'unrouted'
WHERE  p.status = 'completed'
  AND  p.allocation_status = 'received'
  AND  EXISTS (SELECT 1 FROM mpesa_unrouted u
               WHERE u.receipt = p.mpesa_receipt_number AND NOT u.resolved);

-- Backfill channel from what the row already tells us.
UPDATE payments SET channel = CASE
  WHEN mpesa_checkout_request_id IS NOT NULL THEN 'stk'
  WHEN payment_method = 'mpesa'              THEN 'paybill'
  ELSE 'manual'
END
WHERE channel IS NULL;

-- ─── 5. payment_events — append-only audit trail ─────────────────────────────

CREATE TABLE payment_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  UUID NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN (
                'received','validated','allocated','journal_posted','unrouted',
                'reallocated','reversed','refunded','charged_back','replayed')),
  actor       UUID REFERENCES members (id) ON DELETE SET NULL,  -- NULL = system
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_events_payment ON payment_events (payment_id, created_at);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE  ROW LEVEL SECURITY;

-- Append-only by construction: INSERT + SELECT policies only — with FORCE RLS
-- and no UPDATE/DELETE policies, mutation is denied for every session.
CREATE POLICY payment_events_insert ON payment_events
  FOR INSERT WITH CHECK (true);
CREATE POLICY payment_events_select ON payment_events
  FOR SELECT USING (
    is_super_admin()
    OR (SELECT app_current_group_id()) IS NULL
    OR payment_id IN (SELECT id FROM payments
                      WHERE group_id = (SELECT app_current_group_id()))
  );

-- ─── 6. payment_reallocations — corrections as first-class records ──────────
-- Financial rows are never mutated: a correction reverses the original
-- allocation with contra journals and creates a new one. The maker-checker
-- approval FLOW ships in Phase 3; the schema (incl. approved_by) ships now so
-- event history is complete from day one.

CREATE TABLE payment_reallocations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                UUID NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  -- Original allocation being corrected
  from_group_id             UUID NOT NULL REFERENCES groups  (id),
  from_member_id            UUID REFERENCES members (id),
  from_product              TEXT NOT NULL,   -- savings | loan_repayment | welfare | share | invoice
  from_domain_id            UUID,            -- the contribution / repayment / … row reversed
  -- New allocation
  to_group_id               UUID NOT NULL REFERENCES groups  (id),
  to_member_id              UUID REFERENCES members (id),
  to_product                TEXT NOT NULL,
  to_domain_id              UUID,
  -- Correction kind + audit
  kind                      TEXT NOT NULL DEFAULT 'reallocation'
                              CHECK (kind IN ('reallocation','reversal','refund','chargeback')),
  reason                    TEXT NOT NULL,
  initiated_by              UUID NOT NULL REFERENCES members (id),
  approved_by               UUID REFERENCES members (id),   -- maker-checker (Phase 3)
  reversal_journal_entry_id UUID REFERENCES journal_entries (id),
  new_journal_entry_id      UUID REFERENCES journal_entries (id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_reallocs_payment ON payment_reallocations (payment_id);
CREATE INDEX idx_payment_reallocs_from    ON payment_reallocations (from_group_id, created_at DESC);

ALTER TABLE payment_reallocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reallocations FORCE  ROW LEVEL SECURITY;

CREATE POLICY payment_reallocs_select ON payment_reallocations
  FOR SELECT USING (
    is_super_admin()
    OR (SELECT app_current_group_id()) IS NULL
    OR from_group_id = (SELECT app_current_group_id())
    OR to_group_id   = (SELECT app_current_group_id())
  );
CREATE POLICY payment_reallocs_insert ON payment_reallocations
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (SELECT app_current_group_id()) IS NULL
    OR from_group_id = (SELECT app_current_group_id())
  );
-- No UPDATE/DELETE policies — correction records are immutable.

-- ─── 7. event_outbox — transactional outbox (ADR-17) ────────────────────────
-- Written in the SAME transaction as the money change; dispatched by the job
-- queue with at-least-once semantics and idempotent consumers. Broker-ready:
-- a future bus is a relay pointed at this table.

CREATE TABLE event_outbox (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type   TEXT NOT NULL,     -- payment.received | payment.allocated | payment.unrouted | …
  aggregate_id UUID NOT NULL,     -- payment_id / loan_id / membership_id
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_event_outbox_pending ON event_outbox (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox FORCE  ROW LEVEL SECURITY;

-- System plumbing (no tenant data beyond ids): writes happen inside tenant and
-- admin transactions alike; the dispatcher (admin context) updates processed_at.
CREATE POLICY event_outbox_all ON event_outbox
  FOR ALL USING (true) WITH CHECK (true);
