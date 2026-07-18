-- Second posting-templates rollout (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.9):
-- loan_disbursement / loan_repayment join the 8 events migration 090 seeded.
-- These turned out to be bounded, conditional-shape (2-3 lines each) rather
-- than genuinely variable — unlike contribution splits, which stay out of
-- this engine (see posting-templates.service.ts's header comment). Seeded to
-- EXACTLY the mapping accounting.service.ts's postLoanDisbursementJournal/
-- postLoanRepaymentJournal hardcoded until now, so this changes zero posting
-- behavior until a tenant overrides one.

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('accounting', 'posting_template.loan_disbursement',
   '{"lines": [
     {"accountCode": "1101", "side": "debit",  "amount": "principal"},
     {"accountCode": "1001", "side": "credit", "amount": "principal"},
     {"accountCode": "5001", "side": "debit",  "amount": "charge"},
     {"accountCode": "1001", "side": "credit", "amount": "charge"}
   ]}'::jsonb,
   1),
  ('accounting', 'posting_template.loan_repayment',
   '{"lines": [
     {"accountCode": "1001", "side": "debit",  "amount": "principal"},
     {"accountCode": "1101", "side": "credit", "amount": "principal"},
     {"accountCode": "1001", "side": "debit",  "amount": "interest"},
     {"accountCode": "4002", "side": "credit", "amount": "interest"}
   ]}'::jsonb,
   1);
