-- ─────────────────────────────────────────────────────────────────────────────
-- 113: final-batch permission strings (Loans/Credit-scores/M-Pesa)
--
-- Found while migrating Loans/Treasury/M-Pesa/Payouts/Accounting
-- (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4, batch 9) onto
-- withPermission(). Most of this domain maps cleanly onto strings already
-- seeded in 077/079 (loans.approve, mpesa.view, payments.request,
-- payouts.manage, treasury.manage, accounting.manage, reports.view,
-- admin.recompute). Four routes had no fitting existing string:
--
--   - PUT /loans/policy (chairperson) — sets the group's default lending
--     terms; distinct from loans.approve's treasurer-tier operational
--     actions (approve/reject/disburse/default/writeOff).
--   - PUT /credit-scores/policy (chairperson) — sets the reliability-tier
--     ladder for every member; distinct from loan terms.
--   - POST /credit-scores/[memberId]/recompute (treasurer) — recompute ONE
--     member's score; distinct from the chairperson-tier bulk recompute
--     (which reuses admin.recompute, seeded exactly for this pattern).
--   - Bill Manager's chairperson-tier invoicing routes (GET/invoice/bulk/
--     cancel) — the 2 super_admin-only opt-in actions are untouched.
--
-- Additive and monotonic (chairperson ⊇ treasurer), matching migrations
-- 110/112's style.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['credit_scores.recompute']) AS p
)
WHERE group_id IS NULL AND code = 'treasurer';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['credit_scores.recompute']) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY[
    'loans.policy.manage', 'credit_scores.policy.manage', 'mpesa.bill_manager.manage'
  ]) AS p
)
WHERE group_id IS NULL AND code = 'chairperson';
