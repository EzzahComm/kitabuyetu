-- =============================================================================
-- 003_contributions_loans.sql
-- Contributions, loans, and loan repayment schedule tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- contributions
-- Records every member contribution event. M-Pesa receipts are deduplicated
-- via the UNIQUE constraint on mpesa_receipt_number.
-- ---------------------------------------------------------------------------
CREATE TABLE contributions (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID                NOT NULL REFERENCES groups  (id) ON DELETE RESTRICT,
  member_id             UUID                NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  amount                NUMERIC(15,2)       NOT NULL CHECK (amount > 0),
  contribution_date     DATE                NOT NULL DEFAULT CURRENT_DATE,
  due_date              DATE,
  status                contribution_status NOT NULL DEFAULT 'pending',
  payment_method        payment_method,
  mpesa_receipt_number  VARCHAR(50),
  notes                 TEXT,
  recorded_by           UUID                REFERENCES members (id) ON DELETE SET NULL,
  journal_entry_id      UUID,               -- FK added after journal_entries is created (009)
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT contributions_mpesa_receipt_unique UNIQUE (mpesa_receipt_number)
);

CREATE INDEX idx_contributions_group_id    ON contributions (group_id);
CREATE INDEX idx_contributions_member_id   ON contributions (member_id);
CREATE INDEX idx_contributions_status      ON contributions (group_id, status);
CREATE INDEX idx_contributions_date        ON contributions (group_id, contribution_date DESC);
CREATE INDEX idx_contributions_due_date    ON contributions (group_id, due_date)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- loans
-- Loan application and lifecycle record.
-- Repayment schedule is stored in loan_repayments (reducing balance method).
-- ---------------------------------------------------------------------------
CREATE TABLE loans (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID          NOT NULL REFERENCES groups  (id) ON DELETE RESTRICT,
  member_id             UUID          NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  principal_amount      NUMERIC(15,2) NOT NULL CHECK (principal_amount > 0),
  interest_rate         NUMERIC(5,2)  NOT NULL CHECK (interest_rate >= 0),  -- annual %
  loan_term_months      INTEGER       NOT NULL CHECK (loan_term_months > 0),
  disbursement_date     DATE,
  status                loan_status   NOT NULL DEFAULT 'pending',
  purpose               TEXT,
  guarantor_id          UUID          REFERENCES members (id) ON DELETE SET NULL,
  approved_by           UUID          REFERENCES members (id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  rejected_by           UUID          REFERENCES members (id) ON DELETE SET NULL,
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  disbursed_by          UUID          REFERENCES members (id) ON DELETE SET NULL,
  disbursed_at          TIMESTAMPTZ,
  payment_method        payment_method,
  mpesa_receipt_number  VARCHAR(50),
  -- Denormalized totals — recomputed when repayment schedule is generated
  total_repayable       NUMERIC(15,2),
  outstanding_balance   NUMERIC(15,2),
  next_payment_date     DATE,
  notes                 TEXT,
  journal_entry_id      UUID,          -- FK added in 009
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT loans_mpesa_receipt_unique UNIQUE (mpesa_receipt_number)
);

CREATE INDEX idx_loans_group_id    ON loans (group_id);
CREATE INDEX idx_loans_member_id   ON loans (member_id);
CREATE INDEX idx_loans_status      ON loans (group_id, status);
CREATE INDEX idx_loans_next_payment ON loans (next_payment_date)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- loan_repayments
-- Individual installments for each loan (generated at disbursement time).
-- Each row = one monthly installment using reducing balance formula.
-- ---------------------------------------------------------------------------
CREATE TABLE loan_repayments (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID                NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  loan_id               UUID                NOT NULL REFERENCES loans  (id) ON DELETE CASCADE,
  member_id             UUID                NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  installment_number    INTEGER             NOT NULL CHECK (installment_number > 0),
  due_date              DATE                NOT NULL,
  -- Reducing balance breakdown
  opening_balance       NUMERIC(15,2)       NOT NULL,
  principal_component   NUMERIC(15,2)       NOT NULL CHECK (principal_component >= 0),
  interest_component    NUMERIC(15,2)       NOT NULL CHECK (interest_component >= 0),
  penalty_amount        NUMERIC(15,2)       NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  total_due             NUMERIC(15,2)       NOT NULL,
  closing_balance       NUMERIC(15,2)       NOT NULL,
  -- Payment tracking
  amount_paid           NUMERIC(15,2)       NOT NULL DEFAULT 0,
  payment_date          DATE,
  status                contribution_status NOT NULL DEFAULT 'pending',
  payment_method        payment_method,
  mpesa_receipt_number  VARCHAR(50),
  journal_entry_id      UUID,              -- FK added in 009
  created_at            TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT loan_repayments_unique_installment UNIQUE (loan_id, installment_number),
  CONSTRAINT loan_repayments_mpesa_unique        UNIQUE (mpesa_receipt_number)
);

CREATE INDEX idx_loan_repayments_group_id ON loan_repayments (group_id);
CREATE INDEX idx_loan_repayments_loan_id  ON loan_repayments (loan_id);
CREATE INDEX idx_loan_repayments_member   ON loan_repayments (member_id);
CREATE INDEX idx_loan_repayments_due_date ON loan_repayments (group_id, due_date)
  WHERE status = 'pending';
CREATE INDEX idx_loan_repayments_overdue  ON loan_repayments (due_date)
  WHERE status = 'pending' OR status = 'overdue';
