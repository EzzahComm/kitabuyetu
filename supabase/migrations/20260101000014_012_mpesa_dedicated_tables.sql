-- =============================================================================
-- 012_mpesa_dedicated_tables.sql
-- Dedicated M-Pesa transaction tables for production Daraja API integration.
-- Adds a full transaction ledger, per-API tracking tables, raw callback audit
-- log, reconciliation records, Bill Manager invoices, and failed payment log.
-- The existing `payments` table is retained as the accounting-side ledger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
CREATE TYPE mpesa_tx_type AS ENUM (
  'stk_push', 'c2b', 'b2c', 'b2b', 'reversal',
  'balance_query', 'transaction_status'
);

CREATE TYPE mpesa_tx_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE mpesa_tx_status AS ENUM (
  'initiated', 'pending', 'completed', 'failed',
  'timeout', 'cancelled', 'reversed'
);

CREATE TYPE mpesa_callback_type AS ENUM (
  'stk_push', 'c2b_validation', 'c2b_confirmation',
  'b2c_result', 'b2c_timeout',
  'b2b_result', 'b2b_timeout',
  'reversal_result', 'reversal_timeout',
  'balance_result', 'balance_timeout',
  'tx_status_result', 'tx_status_timeout',
  'bill_manager_reconciliation'
);

-- ---------------------------------------------------------------------------
-- mpesa_transactions — master ledger for ALL M-Pesa transactions
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_transactions (
  id                          UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID               NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  transaction_type            mpesa_tx_type      NOT NULL,
  direction                   mpesa_tx_direction NOT NULL,
  mpesa_receipt_number        VARCHAR(50)        UNIQUE,
  conversation_id             VARCHAR(100)       UNIQUE,
  originator_conversation_id  VARCHAR(100)       UNIQUE,
  phone_number                VARCHAR(20),
  amount                      NUMERIC(15,2)      NOT NULL,
  status                      mpesa_tx_status    NOT NULL DEFAULT 'initiated',
  reference                   VARCHAR(50),
  description                 TEXT,
  raw_request                 JSONB,
  raw_response                JSONB,
  failure_code                VARCHAR(10),
  failure_reason              TEXT,
  initiated_at                TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mpesa_tx_group_id     ON mpesa_transactions (group_id);
CREATE INDEX idx_mpesa_tx_type_status  ON mpesa_transactions (transaction_type, status);
CREATE INDEX idx_mpesa_tx_receipt      ON mpesa_transactions (mpesa_receipt_number)
  WHERE mpesa_receipt_number IS NOT NULL;
CREATE INDEX idx_mpesa_tx_conversation ON mpesa_transactions (conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX idx_mpesa_tx_phone        ON mpesa_transactions (phone_number)
  WHERE phone_number IS NOT NULL;
CREATE INDEX idx_mpesa_tx_created_at   ON mpesa_transactions (created_at DESC);

-- ---------------------------------------------------------------------------
-- mpesa_stk_requests — STK Push / M-Pesa Express per-request tracking
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_stk_requests (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID            NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  mpesa_transaction_id  UUID            REFERENCES mpesa_transactions (id),
  checkout_request_id   VARCHAR(100)    NOT NULL UNIQUE,
  merchant_request_id   VARCHAR(100)    NOT NULL,
  phone                 VARCHAR(20)     NOT NULL,
  amount                NUMERIC(15,2)   NOT NULL,
  account_reference     VARCHAR(12)     NOT NULL,
  description           VARCHAR(20)     NOT NULL,
  purpose               VARCHAR(50),
  status                mpesa_tx_status NOT NULL DEFAULT 'pending',
  invoice_id            UUID            REFERENCES invoices (id),
  contribution_id       UUID,
  loan_repayment_id     UUID,
  initiated_by          UUID            REFERENCES members (id),
  raw_callback          JSONB,
  initiated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stk_group_id      ON mpesa_stk_requests (group_id);
CREATE INDEX idx_stk_checkout_req  ON mpesa_stk_requests (checkout_request_id);
CREATE INDEX idx_stk_status        ON mpesa_stk_requests (status);
CREATE INDEX idx_stk_initiated_at  ON mpesa_stk_requests (initiated_at DESC);

-- ---------------------------------------------------------------------------
-- mpesa_b2c_transactions — Business-to-Customer disbursements
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_b2c_transactions (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID            NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  mpesa_transaction_id        UUID            REFERENCES mpesa_transactions (id),
  conversation_id             VARCHAR(100),
  originator_conversation_id  VARCHAR(100)    NOT NULL UNIQUE,
  phone                       VARCHAR(20)     NOT NULL,
  amount                      NUMERIC(15,2)   NOT NULL,
  command_id                  VARCHAR(50)     NOT NULL,
  occasion                    VARCHAR(100),
  remarks                     VARCHAR(100),
  status                      mpesa_tx_status NOT NULL DEFAULT 'initiated',
  mpesa_receipt_number        VARCHAR(50)     UNIQUE,
  loan_id                     UUID            REFERENCES loans (id),
  disbursed_by                UUID            REFERENCES members (id),
  raw_result                  JSONB,
  result_received_at          TIMESTAMPTZ,
  initiated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_b2c_group_id   ON mpesa_b2c_transactions (group_id);
CREATE INDEX idx_b2c_status     ON mpesa_b2c_transactions (status);
CREATE INDEX idx_b2c_loan_id    ON mpesa_b2c_transactions (loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX idx_b2c_phone      ON mpesa_b2c_transactions (phone);
CREATE INDEX idx_b2c_originator ON mpesa_b2c_transactions (originator_conversation_id);

-- ---------------------------------------------------------------------------
-- mpesa_b2b_transactions — Business-to-Business transfers
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_b2b_transactions (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID            NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  mpesa_transaction_id        UUID            REFERENCES mpesa_transactions (id),
  conversation_id             VARCHAR(100),
  originator_conversation_id  VARCHAR(100)    NOT NULL UNIQUE,
  receiver_shortcode          VARCHAR(20)     NOT NULL,
  receiver_identifier_type    VARCHAR(5)      NOT NULL,
  amount                      NUMERIC(15,2)   NOT NULL,
  account_reference           VARCHAR(20),
  requester                   VARCHAR(20),
  command_id                  VARCHAR(50)     NOT NULL,
  remarks                     VARCHAR(100),
  status                      mpesa_tx_status NOT NULL DEFAULT 'initiated',
  mpesa_receipt_number        VARCHAR(50)     UNIQUE,
  initiated_by                UUID            REFERENCES members (id),
  raw_result                  JSONB,
  result_received_at          TIMESTAMPTZ,
  initiated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_b2b_group_id   ON mpesa_b2b_transactions (group_id);
CREATE INDEX idx_b2b_status     ON mpesa_b2b_transactions (status);
CREATE INDEX idx_b2b_originator ON mpesa_b2b_transactions (originator_conversation_id);

-- ---------------------------------------------------------------------------
-- mpesa_reversals — Reversal requests and approval trail
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_reversals (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID            NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  mpesa_transaction_id        UUID            REFERENCES mpesa_transactions (id),
  original_receipt_number     VARCHAR(50)     NOT NULL,
  conversation_id             VARCHAR(100),
  originator_conversation_id  VARCHAR(100)    UNIQUE,
  amount                      NUMERIC(15,2)   NOT NULL,
  receiver_party              VARCHAR(20),
  receiver_identifier_type    VARCHAR(5)      NOT NULL DEFAULT '11',
  remarks                     VARCHAR(100),
  occasion                    VARCHAR(100),
  status                      mpesa_tx_status NOT NULL DEFAULT 'initiated',
  reversal_receipt            VARCHAR(50),
  requested_by                UUID            NOT NULL REFERENCES members (id),
  approved_by                 UUID            REFERENCES members (id),
  raw_result                  JSONB,
  audit_notes                 TEXT,
  result_received_at          TIMESTAMPTZ,
  initiated_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reversals_group_id ON mpesa_reversals (group_id);
CREATE INDEX idx_reversals_status   ON mpesa_reversals (status);
CREATE INDEX idx_reversals_receipt  ON mpesa_reversals (original_receipt_number);

-- ---------------------------------------------------------------------------
-- mpesa_callbacks — append-only audit log of all inbound Safaricom callbacks
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_callbacks (
  id               UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_type    mpesa_callback_type  NOT NULL,
  caller_ip        INET,
  headers          JSONB,
  body             JSONB                NOT NULL,
  processed        BOOLEAN              NOT NULL DEFAULT false,
  processing_error TEXT,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_callbacks_type       ON mpesa_callbacks (callback_type);
CREATE INDEX idx_callbacks_processed  ON mpesa_callbacks (processed) WHERE NOT processed;
CREATE INDEX idx_callbacks_created    ON mpesa_callbacks (created_at DESC);

-- ---------------------------------------------------------------------------
-- mpesa_reconciliations — reconciliation run records
-- ---------------------------------------------------------------------------
CREATE TABLE mpesa_reconciliations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  reconciliation_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  status               VARCHAR(20) NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','failed')),
  transactions_checked INTEGER     NOT NULL DEFAULT 0,
  mismatches_found     INTEGER     NOT NULL DEFAULT 0,
  resolved_count       INTEGER     NOT NULL DEFAULT 0,
  initiated_by         UUID        REFERENCES members (id),
  notes                TEXT,
  details              JSONB,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reconciliations_group ON mpesa_reconciliations (group_id);
CREATE INDEX idx_reconciliations_date  ON mpesa_reconciliations (reconciliation_date DESC);

-- ---------------------------------------------------------------------------
-- failed_payment_logs — persistent log for failure recovery
-- ---------------------------------------------------------------------------
CREATE TABLE failed_payment_logs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  transaction_type     VARCHAR(30) NOT NULL,
  reference_id         VARCHAR(100),
  mpesa_receipt_number VARCHAR(50),
  amount               NUMERIC(15,2),
  phone_number         VARCHAR(20),
  failure_code         VARCHAR(10),
  failure_reason       TEXT        NOT NULL,
  raw_data             JSONB,
  retry_count          INTEGER     NOT NULL DEFAULT 0,
  last_retry_at        TIMESTAMPTZ,
  resolved             BOOLEAN     NOT NULL DEFAULT false,
  resolved_at          TIMESTAMPTZ,
  resolved_by          UUID        REFERENCES members (id),
  resolution_notes     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_failed_logs_group    ON failed_payment_logs (group_id);
CREATE INDEX idx_failed_logs_resolved ON failed_payment_logs (resolved) WHERE NOT resolved;
CREATE INDEX idx_failed_logs_ref      ON failed_payment_logs (reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- bill_manager_invoices — Safaricom Bill Manager API invoice records
-- ---------------------------------------------------------------------------
CREATE TABLE bill_manager_invoices (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID          NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  external_reference  VARCHAR(50)   NOT NULL,
  billed_full_name    VARCHAR(100)  NOT NULL,
  billed_phone        VARCHAR(20)   NOT NULL,
  billed_period_start DATE,
  billed_period_end   DATE,
  amount              NUMERIC(15,2) NOT NULL,
  account_reference   VARCHAR(20)   NOT NULL,
  invoice_name        VARCHAR(100),
  due_date            DATE          NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','cancelled','overdue')),
  mpesa_receipt       VARCHAR(50),
  sent_to_safaricom   BOOLEAN       NOT NULL DEFAULT false,
  sent_at             TIMESTAMPTZ,
  safaricom_response  JSONB,
  paid_at             TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT bill_mgr_ext_ref_unique UNIQUE (group_id, external_reference)
);

CREATE INDEX idx_bill_mgr_group   ON bill_manager_invoices (group_id);
CREATE INDEX idx_bill_mgr_status  ON bill_manager_invoices (status);
CREATE INDEX idx_bill_mgr_due     ON bill_manager_invoices (due_date);
CREATE INDEX idx_bill_mgr_phone   ON bill_manager_invoices (billed_phone);

-- ---------------------------------------------------------------------------
-- Updated_at triggers (reuse function from migration 009)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_mpesa_tx_updated_at
  BEFORE UPDATE ON mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_stk_updated_at
  BEFORE UPDATE ON mpesa_stk_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_b2c_tx_updated_at
  BEFORE UPDATE ON mpesa_b2c_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_b2b_tx_updated_at
  BEFORE UPDATE ON mpesa_b2b_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reversals_updated_at
  BEFORE UPDATE ON mpesa_reversals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reconciliations_updated_at
  BEFORE UPDATE ON mpesa_reconciliations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_failed_logs_updated_at
  BEFORE UPDATE ON failed_payment_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bill_mgr_updated_at
  BEFORE UPDATE ON bill_manager_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — tenant-scoped access via app.current_group_id
-- ---------------------------------------------------------------------------
ALTER TABLE mpesa_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_stk_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_b2c_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_b2b_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_reversals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_callbacks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_reconciliations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_payment_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_manager_invoices   ENABLE ROW LEVEL SECURITY;

-- Group-scoped tables: isolate by group_id session variable
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mpesa_transactions', 'mpesa_stk_requests', 'mpesa_b2c_transactions',
    'mpesa_b2b_transactions', 'mpesa_reversals', 'mpesa_reconciliations',
    'failed_payment_logs', 'bill_manager_invoices'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (group_id::TEXT = current_setting(''app.current_group_id'', TRUE))',
      'rls_' || tbl || '_group', tbl
    );
  END LOOP;
END;
$$;

-- Callbacks: admin-only (no group_id column), managed by system
CREATE POLICY rls_mpesa_callbacks_admin ON mpesa_callbacks
  FOR ALL USING (current_setting('app.current_role', TRUE) IN ('super_admin','group_admin'));
