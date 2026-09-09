-- =============================================================================
-- 005_billing.sql
-- Billing accounts, subscriptions, invoices, invoice items, and payments
-- =============================================================================

-- ---------------------------------------------------------------------------
-- billing_accounts
-- One billing account per group. Tracks SMS credits and auto-topup config.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_accounts (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID          NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  sms_credits           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (sms_credits >= 0),
  low_balance_threshold NUMERIC(15,2) NOT NULL DEFAULT 100,
  auto_topup_enabled    BOOLEAN       NOT NULL DEFAULT false,
  auto_topup_amount     NUMERIC(15,2) CHECK (auto_topup_amount > 0),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT billing_accounts_group_unique UNIQUE (group_id)
);

CREATE INDEX idx_billing_accounts_group_id ON billing_accounts (group_id);
-- Fast lookup for low-balance sweep job
CREATE INDEX idx_billing_accounts_low_sms  ON billing_accounts (sms_credits)
  WHERE sms_credits <= low_balance_threshold;

-- ---------------------------------------------------------------------------
-- subscriptions
-- Active plan per group. Only one active subscription allowed at a time
-- (enforced via partial unique index).
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID                NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  plan_type           plan_type           NOT NULL,
  status              subscription_status NOT NULL DEFAULT 'active',
  started_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  next_billing_date   DATE,
  monthly_fee         NUMERIC(15,2)       NOT NULL CHECK (monthly_fee >= 0),
  sms_rate            NUMERIC(8,4)        NOT NULL CHECK (sms_rate   >= 0),  -- per SMS, KES
  max_members         INTEGER,            -- NULL = unlimited
  grace_period_days   INTEGER             NOT NULL DEFAULT 7,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_group_id         ON subscriptions (group_id);
CREATE INDEX idx_subscriptions_status           ON subscriptions (status);
CREATE INDEX idx_subscriptions_next_billing     ON subscriptions (next_billing_date)
  WHERE status = 'active';

-- Only one active subscription per group
CREATE UNIQUE INDEX idx_subscriptions_one_active
  ON subscriptions (group_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- invoices
-- Billing documents issued to a group. Covers subscription fees, SMS top-ups,
-- registration fees, and any ad-hoc charges.
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID           NOT NULL REFERENCES groups           (id) ON DELETE RESTRICT,
  billing_account_id  UUID           NOT NULL REFERENCES billing_accounts (id) ON DELETE RESTRICT,
  invoice_number      VARCHAR(50)    NOT NULL,
  invoice_date        DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date            DATE           NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  subtotal            NUMERIC(15,2)  NOT NULL CHECK (subtotal    >= 0),
  tax_amount          NUMERIC(15,2)  NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount        NUMERIC(15,2)  NOT NULL CHECK (total_amount >= 0),
  paid_amount         NUMERIC(15,2)  NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT invoices_number_unique UNIQUE (invoice_number)
);

CREATE INDEX idx_invoices_group_id    ON invoices (group_id);
CREATE INDEX idx_invoices_status      ON invoices (group_id, status);
CREATE INDEX idx_invoices_due_date    ON invoices (due_date) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- invoice_items
-- Line items on each invoice. e.g. "Monthly subscription — Growth Plan".
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID          NOT NULL REFERENCES groups   (id)    ON DELETE RESTRICT,
  invoice_id  UUID          NOT NULL REFERENCES invoices (id)    ON DELETE CASCADE,
  description VARCHAR(255)  NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  total       NUMERIC(15,2) NOT NULL CHECK (total >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_items_group_id   ON invoice_items (group_id);
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- payments
-- Recorded payment events. Links to invoices and tracks M-Pesa receipts.
-- mpesa_receipt_number is the idempotency key for M-Pesa callbacks.
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id                          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    UUID           NOT NULL REFERENCES groups   (id) ON DELETE RESTRICT,
  invoice_id                  UUID           REFERENCES invoices (id) ON DELETE SET NULL,
  amount                      NUMERIC(15,2)  NOT NULL CHECK (amount > 0),
  payment_method              payment_method NOT NULL,
  status                      payment_status NOT NULL DEFAULT 'pending',
  -- M-Pesa specific fields
  mpesa_receipt_number        VARCHAR(50),
  mpesa_checkout_request_id   VARCHAR(100),
  mpesa_merchant_request_id   VARCHAR(100),
  mpesa_phone                 VARCHAR(20),
  mpesa_raw_callback          JSONB,
  -- Manual payment fields
  payment_date                TIMESTAMPTZ,
  recorded_by                 UUID           REFERENCES members (id) ON DELETE SET NULL,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_mpesa_receipt_unique UNIQUE (mpesa_receipt_number),
  CONSTRAINT payments_checkout_req_unique  UNIQUE (mpesa_checkout_request_id)
);

CREATE INDEX idx_payments_group_id       ON payments (group_id);
CREATE INDEX idx_payments_invoice_id     ON payments (invoice_id);
CREATE INDEX idx_payments_status         ON payments (group_id, status);
CREATE INDEX idx_payments_checkout_req   ON payments (mpesa_checkout_request_id)
  WHERE mpesa_checkout_request_id IS NOT NULL;
