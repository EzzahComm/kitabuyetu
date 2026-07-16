-- Loan write-off workflow (ACCOUNTING_ARCHITECTURE_AUDIT.md §15 High finding):
-- `written_off` already existed as a loan_status value (and the state machine
-- in migration 028 already only allows defaulted -> written_off), but no
-- service method or API route ever reached it outside bulk import — the
-- seeded '5004 Loan Write-offs' expense account was unreachable dead code.
--
-- Maker-checker mirrors the disbursement/reallocation pattern already in this
-- codebase: the officer who marks a loan 'defaulted' cannot be the same one
-- who authorizes the write-off. Enforced at the DB level (not just app code)
-- for the same reason migration 081 added one for manual journals — this
-- codebase's own history shows app-only enforcement of a control has been
-- bypassed once already.

ALTER TABLE loans
  ADD COLUMN defaulted_by             UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN defaulted_at             TIMESTAMPTZ,
  ADD COLUMN default_reason          TEXT,
  ADD COLUMN written_off_by          UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN written_off_at          TIMESTAMPTZ,
  ADD COLUMN write_off_reason        TEXT,
  ADD COLUMN write_off_journal_entry_id UUID;

ALTER TABLE loans
  ADD CONSTRAINT chk_loan_writeoff_maker_checker
  CHECK (written_off_by IS NULL OR defaulted_by IS NULL OR written_off_by <> defaulted_by);
