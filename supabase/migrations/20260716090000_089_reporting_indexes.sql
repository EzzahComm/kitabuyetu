-- Interim reporting indexes ahead of journal_lines partitioning
-- (ACCOUNTING_ARCHITECTURE_AUDIT.md §17/§19 — the backlog's "add the missing
-- (account_id, entry_date) composite index in the interim"). journal_lines
-- carries no entry_date column (dates live on journal_entries), so the
-- faithful equivalent for the actual report query shape —
--
--   FROM accounts a
--   LEFT JOIN journal_lines   jl ON jl.account_id = a.id
--   LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
--     AND je.status = 'posted' [AND je.entry_date BETWEEN $2 AND $3]
--
-- (trial balance, P&L, balance sheet, GL-vs-balance reconciliation) — is a
-- pair of covering indexes so both sides of that join can be answered with
-- index-only scans instead of per-row heap fetches:
--
--   1. journal_lines(account_id) INCLUDE (journal_entry_id, debit, credit)
--      — every report aggregates SUM(debit)/SUM(credit) per account; with
--      the payload columns in the index leaf, the whole lines side never
--      touches the heap. Supersedes the plain idx_journal_lines_account_id
--      (same leading column), which is dropped to avoid paying double
--      write amplification for a strictly weaker index.
--
--   2. journal_entries(id) INCLUDE (status, entry_date)
--      — the join probes entries by primary key but only ever needs
--      status + entry_date; this lets that probe skip the heap too. The
--      PK index itself stays, as it must.

CREATE INDEX idx_journal_lines_account_covering
  ON journal_lines (account_id)
  INCLUDE (journal_entry_id, debit, credit);

DROP INDEX IF EXISTS idx_journal_lines_account_id;

CREATE INDEX idx_journal_entries_id_covering
  ON journal_entries (id)
  INCLUDE (status, entry_date);
