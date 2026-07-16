-- Fiscal period locking (ACCOUNTING_ARCHITECTURE_AUDIT.md §13 Critical
-- finding): no period-locking mechanism existed anywhere — a treasurer could
-- post a journal dated arbitrarily in the past or future, forever, and every
-- report would silently include it. There was no way to "close the books".
--
-- Scope: blocks MANUAL journal postings (a human treasurer creating/posting
-- a journal entry) into a closed period. System-posted entries
-- (created_by IS NULL — contributions/loans posted automatically off a real
-- M-Pesa event) are exempt: the money already moved in the real world, and
-- refusing to record it because the books are "closed for review" would be
-- actively harmful, not protective. Automated postings always target the
-- current date anyway (confirmed in accounting.service.ts's
-- postContributionJournal/postLoanDisbursementJournal/postLoanRepaymentJournal
-- call sites), so in practice this only ever gates deliberate back/future-dated
-- manual entries — exactly the finding's scenario.

CREATE TYPE fiscal_period_status AS ENUM ('open', 'closed');

CREATE TABLE fiscal_periods (
  id             UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID                   NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  period_start   DATE                   NOT NULL,
  period_end     DATE                   NOT NULL,
  status         fiscal_period_status  NOT NULL DEFAULT 'closed',
  closed_by      UUID                   REFERENCES members (id) ON DELETE SET NULL,
  closed_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  reopened_by    UUID                   REFERENCES members (id) ON DELETE SET NULL,
  reopened_at    TIMESTAMPTZ,
  reopen_reason  TEXT,
  created_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_periods_valid_range CHECK (period_end >= period_start),
  -- A period is only ever created via the "close" action, so this is the
  -- record of that close event — reopening flips status in place rather than
  -- deleting the row, preserving the audit trail of who closed/reopened when.
  CONSTRAINT uq_fiscal_periods_group_start UNIQUE (group_id, period_start)
);

CREATE INDEX idx_fiscal_periods_group_range ON fiscal_periods (group_id, period_start, period_end);

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods FORCE  ROW LEVEL SECURITY;

CREATE POLICY fiscal_periods_select ON fiscal_periods
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY fiscal_periods_insert ON fiscal_periods
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );
CREATE POLICY fiscal_periods_update ON fiscal_periods
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('group_admin','treasurer'))
  );

CREATE OR REPLACE FUNCTION assert_period_open()
RETURNS TRIGGER AS $$
DECLARE
  v_closed BOOLEAN;
BEGIN
  -- Only human-initiated postings are gated (see header comment).
  IF NEW.status = 'posted' AND NEW.created_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM fiscal_periods
      WHERE group_id = NEW.group_id
        AND status = 'closed'
        AND NEW.entry_date BETWEEN period_start AND period_end
    ) INTO v_closed;
    IF v_closed THEN
      RAISE EXCEPTION 'Cannot post to %: this fiscal period is closed for group %. Reopen the period first.',
        NEW.entry_date, NEW.group_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assert_period_open ON journal_entries;
CREATE TRIGGER trg_assert_period_open
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION assert_period_open();
