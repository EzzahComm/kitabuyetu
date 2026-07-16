-- Posting templates (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.9 — the audit's
-- "single highest-leverage architectural change", #2 in §29.13's foundational
-- ordering): which accounts a business event posts to becomes Configuration
-- Service data ('accounting' domain) instead of hardcoded account-code pairs
-- inside each module. First rollout covers every postSystemJournal call site
-- — the fixed-shape system postings added when §7's missing-GL-integration
-- finding was closed.
--
-- Each template is seeded to EXACTLY the mapping the call sites hardcoded
-- until now, so this changes zero posting behavior. Overrides (group or
-- organization scope, written via posting-templates.service.ts) may only
-- remap account codes — the line structure (side + amount role per line) is
-- locked to these defaults by application-side validation, which is what
-- keeps a tenant override from ever unbalancing an entry.
--
-- The variable-shape postings (contribution splits, loan disbursement fees,
-- repayment waterfalls in accounting.service.ts) are deliberately NOT
-- templated in this round — their line counts vary per transaction.

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('accounting', 'posting_template.share_purchase', '{"lines": [
     {"accountCode": "1001", "side": "debit",  "amount": "amount"},
     {"accountCode": "3001", "side": "credit", "amount": "amount"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.share_redemption', '{"lines": [
     {"accountCode": "3001", "side": "debit",  "amount": "amount"},
     {"accountCode": "1001", "side": "credit", "amount": "amount"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.welfare_disbursement', '{"lines": [
     {"accountCode": "2102", "side": "debit",  "amount": "amount"},
     {"accountCode": "1001", "side": "credit", "amount": "amount"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.welfare_pool_contribution', '{"lines": [
     {"accountCode": "1001", "side": "debit",  "amount": "amount"},
     {"accountCode": "2102", "side": "credit", "amount": "amount"}
   ]}'::jsonb, 1),

  -- gross = net + tax is guaranteed by the dividend computation; a zero tax
  -- drops the 2104 line at build time, reproducing the old two-line entry.
  ('accounting', 'posting_template.dividend_declaration', '{"lines": [
     {"accountCode": "3101", "side": "debit",  "amount": "gross"},
     {"accountCode": "2103", "side": "credit", "amount": "net"},
     {"accountCode": "2104", "side": "credit", "amount": "tax"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.dividend_payment', '{"lines": [
     {"accountCode": "2103", "side": "debit",  "amount": "net"},
     {"accountCode": "1001", "side": "credit", "amount": "net"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.subscription_payment', '{"lines": [
     {"accountCode": "5003", "side": "debit",  "amount": "amount"},
     {"accountCode": "1001", "side": "credit", "amount": "amount"}
   ]}'::jsonb, 1),

  ('accounting', 'posting_template.loan_writeoff', '{"lines": [
     {"accountCode": "5004", "side": "debit",  "amount": "outstanding"},
     {"accountCode": "1101", "side": "credit", "amount": "outstanding"}
   ]}'::jsonb, 1);
