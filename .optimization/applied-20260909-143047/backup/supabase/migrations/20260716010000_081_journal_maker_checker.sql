-- Manual journal maker-checker (ACCOUNTING_ARCHITECTURE_AUDIT.md, Critical
-- finding — §15). Every other path that moves money across a trust boundary
-- (disbursement_requests, organization_disbursements, payment_reallocations)
-- already enforces a distinct-approver CHECK above a per-group threshold.
-- Manual journal create/post/void had none: a single treasurer could create,
-- post, and void an arbitrarily large journal entry unilaterally.
--
-- Mirrors that same pattern: a configurable per-group threshold, defaulting
-- to 0 (always require a distinct second actor) since this was flagged
-- Critical — raise per-group if a genuine single-officer workflow is needed
-- for small corrections. Enforced at the DB level via a BEFORE UPDATE
-- trigger (not just application code) because this codebase's own history
-- (migration 027) shows app-only enforcement of a posting invariant has
-- already been silently bypassed once.

ALTER TABLE groups
  ADD COLUMN journal_approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN groups.journal_approval_threshold IS
  'Manual journal entries whose total exceeds this amount require a poster distinct from the creator, and a voider distinct from the poster. Defaults to 0 (always require a distinct second actor).';

CREATE OR REPLACE FUNCTION assert_journal_maker_checker()
RETURNS TRIGGER AS $$
DECLARE
  v_threshold NUMERIC(15,2);
  v_total     NUMERIC(15,2);
BEGIN
  IF NEW.status = 'posted' AND OLD.status = 'draft' AND NEW.posted_by IS NOT NULL AND NEW.posted_by = NEW.created_by THEN
    SELECT journal_approval_threshold INTO v_threshold FROM groups WHERE id = NEW.group_id;
    SELECT COALESCE(SUM(debit), 0) INTO v_total FROM journal_lines WHERE journal_entry_id = NEW.id;
    IF v_total > COALESCE(v_threshold, 0) THEN
      RAISE EXCEPTION 'Maker-checker: journal entries above % require a poster different from the creator (entry %, amount %)',
        COALESCE(v_threshold, 0), NEW.id, v_total;
    END IF;
  END IF;

  IF NEW.status = 'void' AND OLD.status = 'posted' AND NEW.voided_by IS NOT NULL AND NEW.voided_by = NEW.posted_by THEN
    SELECT journal_approval_threshold INTO v_threshold FROM groups WHERE id = NEW.group_id;
    SELECT COALESCE(SUM(debit), 0) INTO v_total FROM journal_lines WHERE journal_entry_id = NEW.id;
    IF v_total > COALESCE(v_threshold, 0) THEN
      RAISE EXCEPTION 'Maker-checker: journal entries above % require a voider different from the poster (entry %, amount %)',
        COALESCE(v_threshold, 0), NEW.id, v_total;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_maker_checker ON journal_entries;
CREATE TRIGGER trg_journal_maker_checker
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION assert_journal_maker_checker();
