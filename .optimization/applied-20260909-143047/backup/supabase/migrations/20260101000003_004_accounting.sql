-- =============================================================================
-- 004_accounting.sql
-- Chart of accounts, double-entry journal entries, and journal lines
-- =============================================================================

-- ---------------------------------------------------------------------------
-- accounts
-- Chart of accounts per group. Supports hierarchical accounts via parent_id.
-- Balance is denormalized and updated by trigger on journal_lines posting.
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID         NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  account_code VARCHAR(20)  NOT NULL,
  name         VARCHAR(255) NOT NULL,
  type         account_type NOT NULL,
  parent_id    UUID         REFERENCES accounts (id) ON DELETE RESTRICT,
  description  TEXT,
  is_system    BOOLEAN      NOT NULL DEFAULT false,  -- system accounts cannot be deleted
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  -- Denormalized running balance (DR positive for assets/expenses, CR positive for liability/equity/income)
  balance      NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT accounts_code_unique UNIQUE (group_id, account_code),
  -- Prevent circular parent references (enforced at app layer with this as DB backup)
  CONSTRAINT accounts_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX idx_accounts_group_id   ON accounts (group_id);
CREATE INDEX idx_accounts_type       ON accounts (group_id, type);
CREATE INDEX idx_accounts_parent_id  ON accounts (parent_id);
CREATE INDEX idx_accounts_is_active  ON accounts (group_id, is_active);

-- ---------------------------------------------------------------------------
-- journal_entries
-- Header record for each double-entry accounting event.
-- Lines must balance (sum of debits = sum of credits) before status = posted.
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID           NOT NULL REFERENCES groups  (id) ON DELETE RESTRICT,
  entry_date  DATE           NOT NULL DEFAULT CURRENT_DATE,
  reference   VARCHAR(100),
  description TEXT           NOT NULL,
  status      journal_status NOT NULL DEFAULT 'draft',
  created_by  UUID           NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  posted_by   UUID           REFERENCES members (id) ON DELETE SET NULL,
  posted_at   TIMESTAMPTZ,
  voided_by   UUID           REFERENCES members (id) ON DELETE SET NULL,
  voided_at   TIMESTAMPTZ,
  void_reason TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_journal_entries_group_id   ON journal_entries (group_id);
CREATE INDEX idx_journal_entries_entry_date ON journal_entries (group_id, entry_date DESC);
CREATE INDEX idx_journal_entries_status     ON journal_entries (group_id, status);
CREATE INDEX idx_journal_entries_reference  ON journal_entries (group_id, reference)
  WHERE reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- journal_lines
-- Individual debit/credit lines for each journal entry.
-- Exactly one of debit or credit should be non-zero per line.
-- Validation that SUM(debit) = SUM(credit) per entry is done before posting.
-- ---------------------------------------------------------------------------
CREATE TABLE journal_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID          NOT NULL REFERENCES groups          (id) ON DELETE RESTRICT,
  journal_entry_id UUID          NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  account_id       UUID          NOT NULL REFERENCES accounts        (id) ON DELETE RESTRICT,
  debit            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Each line must be purely debit or purely credit
  CONSTRAINT journal_lines_debit_xor_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

CREATE INDEX idx_journal_lines_group_id   ON journal_lines (group_id);
CREATE INDEX idx_journal_lines_entry_id   ON journal_lines (journal_entry_id);
CREATE INDEX idx_journal_lines_account_id ON journal_lines (account_id);

-- ---------------------------------------------------------------------------
-- Add deferred FK from contributions and loans to journal_entries
-- ---------------------------------------------------------------------------
ALTER TABLE contributions   ADD CONSTRAINT fk_contributions_journal
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL;

ALTER TABLE loans            ADD CONSTRAINT fk_loans_journal
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL;

ALTER TABLE loan_repayments  ADD CONSTRAINT fk_loan_repayments_journal
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE SET NULL;
