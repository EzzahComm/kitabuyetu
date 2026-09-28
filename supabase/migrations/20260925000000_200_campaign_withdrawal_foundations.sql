-- =============================================================================
-- 200_campaign_withdrawal_foundations.sql
-- Changi$ha monetization, part 1: additive changes to existing tables/
-- functions needed before campaign_withdrawals (migration 201) can post
-- anywhere. No new table here.
--
-- 1. campaigns.payout_phone — where a campaign's withdrawal is paid out to.
--    No NOT NULL at the DB level: a draft campaign legitimately has none yet.
--    Enforced in campaignsService.submitForReview() instead (app layer),
--    matching how officer-role gating already lives in application code
--    rather than a DB CHECK for this table.
--
-- 2. Two new per-group chart-of-accounts codes for the withdrawal journal:
--    5005 Changi$ha Withdrawals (the net amount actually paid to the
--    beneficiary) and 5006 Changi$ha Platform Fee (the platform's own
--    revenue-side expense, from the GROUP's perspective — see
--    campaign-withdrawals.service.ts for why this needs its own line rather
--    than reusing 5001). Same two-step backfill+seeder-update migration 185
--    used for 4006, done in one pass this time. The M-Pesa B2C cost itself
--    reuses the existing 5001 Administrative Expenses — no new code needed.
--
-- 3. Widen settlement_approvals' subject_type CHECK to admit
--    'campaign_withdrawal', so the existing dual-control primitive
--    (settlement-approvals.service.ts's recordApproval) can be reused as-is.
-- =============================================================================

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS payout_phone text;

-- Backfill 5005/5006 for every existing group.
INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT id, '5005', 'Changi$ha Withdrawals', 'expense', true FROM groups
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE accounts.group_id = groups.id AND account_code = '5005');

INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT id, '5006', 'Changi$ha Platform Fee', 'expense', true FROM groups
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE accounts.group_id = groups.id AND account_code = '5006');

-- Same body as the live seed_chart_of_accounts() (verified via
-- pg_get_functiondef before writing this), plus the two new rows, so every
-- group created after this migration gets them too.
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_group_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO accounts (group_id, account_code, name, type, is_system) VALUES
    (p_group_id, '1001', 'Cash and M-Pesa',          'asset',     true),
    (p_group_id, '1002', 'Bank Account',              'asset',     true),
    (p_group_id, '1101', 'Loans Receivable',          'asset',     true),
    (p_group_id, '1201', 'Fixed Assets',              'asset',     true),
    (p_group_id, '2001', 'Accounts Payable',          'liability', true),
    (p_group_id, '2101', 'Member Savings',            'liability', true),
    (p_group_id, '3001', 'Member Equity',             'equity',    true),
    (p_group_id, '3101', 'Retained Surplus',          'equity',    true),
    (p_group_id, '4001', 'Member Contributions',      'income',    true),
    (p_group_id, '4002', 'Interest Income — Loans',   'income',    true),
    (p_group_id, '4003', 'Registration Fees',         'income',    true),
    (p_group_id, '4004', 'Other Income',              'income',    true),
    (p_group_id, '4006', 'Changi$ha Donations',       'income',    true),
    (p_group_id, '5001', 'Administrative Expenses',   'expense',   true),
    (p_group_id, '5002', 'SMS Expenses',              'expense',   true),
    (p_group_id, '5003', 'Platform Subscription',     'expense',   true),
    (p_group_id, '5004', 'Loan Write-offs',           'expense',   true),
    (p_group_id, '5005', 'Changi$ha Withdrawals',     'expense',   true),
    (p_group_id, '5006', 'Changi$ha Platform Fee',    'expense',   true)
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
$function$;

-- Widen the existing constraint (verified live name via pg_constraint
-- before writing this) to admit the new subject type.
ALTER TABLE public.settlement_approvals
  DROP CONSTRAINT settlement_approvals_subject_type_check;
ALTER TABLE public.settlement_approvals
  ADD CONSTRAINT settlement_approvals_subject_type_check
  CHECK (subject_type = ANY (ARRAY['bank_account'::text, 'settlement'::text, 'vendor_payment'::text, 'campaign_withdrawal'::text]));

-- No permission-catalog migration needed: payouts.manage/treasury.manage are
-- already granted to treasurer/chairperson (migration 077), the correct
-- narrower tier (excludes secretary, unlike campaigns.manage).
