-- journal_lines.entry_date — prerequisite for the audit's partitioning
-- recommendation (ACCOUNTING_ARCHITECTURE_AUDIT.md §17/§19). journal_lines
-- has never carried its own accounting date; every date-ranged report
-- (P&L, cash flow, statement of changes in equity) reaches it only via a
-- join to journal_entries.entry_date, which migration 089's own comment
-- notes made a real (account_id, entry_date) index "impossible as written."
-- This migration is Phase 1 of that recommendation only: add the column,
-- make it self-maintaining, and index it. The actual PARTITION BY RANGE
-- table conversion is deliberately deferred to a separate future pass —
-- it needs its own Postgres-version compatibility check for the existing
-- deferred constraint trigger (trg_assert_posted_balance_deferred, migration
-- 027) cascading correctly to partitions, which this migration does not
-- attempt to verify.
--
-- Safe to add now: journal_lines.id has no external FK references (unlike
-- journal_entries.id, which 6 other tables point at), and entry_date is
-- never updated on journal_entries anywhere in this codebase today, so a
-- denormalized copy here cannot drift under current code paths.

ALTER TABLE journal_lines ADD COLUMN entry_date DATE;

-- Auto-derive from the parent entry so none of the 8 existing INSERT INTO
-- journal_lines call sites (single-row loops, multi-row VALUES, and
-- reallocations.service.ts's bulk INSERT ... SELECT in mirrorJournal) need
-- to change.
CREATE OR REPLACE FUNCTION derive_journal_line_entry_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entry_date IS NULL THEN
    SELECT entry_date INTO NEW.entry_date
    FROM journal_entries WHERE id = NEW.journal_entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_derive_entry_date ON journal_lines;
CREATE TRIGGER trg_journal_lines_derive_entry_date
  BEFORE INSERT ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION derive_journal_line_entry_date();

-- Backfill existing rows.
UPDATE journal_lines jl
SET entry_date = je.entry_date
FROM journal_entries je
WHERE je.id = jl.journal_entry_id AND jl.entry_date IS NULL;

ALTER TABLE journal_lines ALTER COLUMN entry_date SET NOT NULL;

-- Defensive sync: no code path updates journal_entries.entry_date today,
-- but if that ever changes, keep the denormalized copy honest instead of
-- silently going stale.
CREATE OR REPLACE FUNCTION sync_journal_lines_entry_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entry_date IS DISTINCT FROM OLD.entry_date THEN
    UPDATE journal_lines SET entry_date = NEW.entry_date WHERE journal_entry_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_sync_line_dates ON journal_entries;
CREATE TRIGGER trg_journal_entries_sync_line_dates
  AFTER UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION sync_journal_lines_entry_date();

-- Supersedes migration 089's idx_journal_lines_account_covering: this index
-- still serves account_id-only lookups (leftmost prefix) and now also
-- serves date-ranged report queries, so there's no reason to keep both.
CREATE INDEX idx_journal_lines_account_entry_date
  ON journal_lines (account_id, entry_date)
  INCLUDE (journal_entry_id, debit, credit);

DROP INDEX IF EXISTS idx_journal_lines_account_covering;
