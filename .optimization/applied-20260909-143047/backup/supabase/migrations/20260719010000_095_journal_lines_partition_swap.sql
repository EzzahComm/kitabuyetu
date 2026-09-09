-- journal_lines partitioning, step 2 of 2 (ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §17/§19 — Phase 2). Backfills journal_lines_partitioned (created by
-- migration 094) from the live journal_lines, then atomically renames the
-- old table out of the way and the new one into place.
--
-- BEFORE RUNNING AGAINST PRODUCTION: run
--   SELECT COUNT(*), MIN(entry_date), MAX(entry_date) FROM journal_lines;
-- first. No row count for this table is recorded anywhere in this repo —
-- "millions of journals" in the audit is a stated future goal, not a
-- measured figure. Under roughly 500k rows, the single-pass INSERT ...
-- SELECT below is fine. Above that, chunk it by month instead (keep the
-- DISABLE/ENABLE TRIGGER lines below wrapping the whole chunked sequence,
-- not per chunk — see the comment above them for why), e.g.:
--
--   INSERT INTO journal_lines_partitioned
--     (id, group_id, journal_entry_id, account_id, debit, credit, description, entry_date, created_at, updated_at)
--   SELECT id, group_id, journal_entry_id, account_id, debit, credit,
--          description, entry_date, created_at, updated_at
--   FROM journal_lines
--   WHERE entry_date >= '2026-01-01' AND entry_date < '2026-02-01';
--   -- repeat per month, with a brief pause between chunks
--
-- journal_lines_legacy is kept, not dropped — a real observation window
-- before a later, separate, manually-triggered migration drops it.
--
-- The BEGIN/COMMIT wrapper below is a deliberate, one-off exception to this
-- repo's usual no-explicit-transaction convention: both renames must
-- succeed or fail together, since a partial rename would leave no table
-- named journal_lines at all. Apply during a low-traffic window — the
-- rename briefly needs an exclusive lock on the table.

-- Disable the balance-maintenance trigger for the backfill: these rows
-- already applied their effect on accounts.balance when first inserted into
-- the original journal_lines. Re-firing it here would double-count every
-- account's balance. DISABLE TRIGGER on a partitioned table (without ONLY)
-- is documented to cascade to every partition automatically, so this one
-- statement covers all of them.
ALTER TABLE journal_lines_partitioned DISABLE TRIGGER trg_journal_lines_update_balance;

INSERT INTO journal_lines_partitioned
  (id, group_id, journal_entry_id, account_id, debit, credit, description, entry_date, created_at, updated_at)
SELECT id, group_id, journal_entry_id, account_id, debit, credit, description, entry_date, created_at, updated_at
FROM journal_lines;

ALTER TABLE journal_lines_partitioned ENABLE TRIGGER trg_journal_lines_update_balance;

BEGIN;

ALTER TABLE journal_lines RENAME TO journal_lines_legacy;
ALTER TABLE journal_lines_legacy RENAME CONSTRAINT journal_lines_pkey TO journal_lines_legacy_pkey;
ALTER INDEX idx_journal_lines_group_id            RENAME TO idx_journal_lines_legacy_group_id;
ALTER INDEX idx_journal_lines_entry_id             RENAME TO idx_journal_lines_legacy_entry_id;
ALTER INDEX idx_journal_lines_account_entry_date   RENAME TO idx_journal_lines_legacy_account_entry_date;

ALTER TABLE journal_lines_partitioned RENAME TO journal_lines;
ALTER TABLE journal_lines RENAME CONSTRAINT journal_lines_partitioned_pkey TO journal_lines_pkey;
ALTER INDEX idx_journal_lines_partitioned_group_id           RENAME TO idx_journal_lines_group_id;
ALTER INDEX idx_journal_lines_partitioned_entry_id            RENAME TO idx_journal_lines_entry_id;
ALTER INDEX idx_journal_lines_partitioned_account_entry_date  RENAME TO idx_journal_lines_account_entry_date;

COMMIT;
