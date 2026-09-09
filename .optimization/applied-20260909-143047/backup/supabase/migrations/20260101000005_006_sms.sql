-- =============================================================================
-- 006_sms.sql
-- SMS usage logs and credit top-up records
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sms_usage_logs
-- Every SMS send attempt is logged here. Credits are deducted atomically
-- in the same transaction as this insert (see sms.service.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE sms_usage_logs (
  id               UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID       NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  recipient_phone  VARCHAR(20) NOT NULL,
  message_text     TEXT        NOT NULL,
  status           sms_status  NOT NULL DEFAULT 'queued',
  -- Africa's Talking tracking
  at_message_id    VARCHAR(100),
  at_cost          NUMERIC(8,4),
  credits_deducted NUMERIC(8,4) NOT NULL CHECK (credits_deducted >= 0),
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  failed_reason    TEXT,
  -- Link back to the business event that triggered this SMS
  reference_type   VARCHAR(50),  -- 'contribution', 'loan', 'notification', 'billing'
  reference_id     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sms_usage_group_id        ON sms_usage_logs (group_id);
CREATE INDEX idx_sms_usage_status          ON sms_usage_logs (group_id, status);
CREATE INDEX idx_sms_usage_created_at      ON sms_usage_logs (group_id, created_at DESC);
CREATE INDEX idx_sms_usage_at_message_id   ON sms_usage_logs (at_message_id)
  WHERE at_message_id IS NOT NULL;
CREATE INDEX idx_sms_usage_reference       ON sms_usage_logs (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sms_credits
-- Audit log of every credit addition to a billing account.
-- The live balance is on billing_accounts.sms_credits — this table is the
-- ledger from which that balance can be recomputed if needed.
-- ---------------------------------------------------------------------------
CREATE TABLE sms_credits (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID          NOT NULL REFERENCES groups           (id) ON DELETE RESTRICT,
  billing_account_id UUID          NOT NULL REFERENCES billing_accounts (id) ON DELETE RESTRICT,
  amount_paid        NUMERIC(15,2) NOT NULL CHECK (amount_paid > 0),   -- KES paid
  credits_added      NUMERIC(15,2) NOT NULL CHECK (credits_added > 0), -- SMS credits granted
  rate_applied       NUMERIC(8,4)  NOT NULL,                           -- KES per SMS at time of purchase
  payment_id         UUID          REFERENCES payments (id) ON DELETE SET NULL,
  added_by           UUID          REFERENCES members  (id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sms_credits_group_id          ON sms_credits (group_id);
CREATE INDEX idx_sms_credits_billing_account   ON sms_credits (billing_account_id);
CREATE INDEX idx_sms_credits_created_at        ON sms_credits (group_id, created_at DESC);
