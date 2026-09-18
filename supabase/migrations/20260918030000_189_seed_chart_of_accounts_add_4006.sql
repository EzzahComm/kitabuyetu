-- 189: seed_chart_of_accounts() was missing account 4006 (Changi$ha Donations)
--
-- Discovered while reconciling migration 185 with production reality:
-- register_group() was already correctly calling seed_chart_of_accounts()
-- (not a hardcoded INSERT), but seed_chart_of_accounts() itself was never
-- updated to include account 4006 — so every group created since
-- register_group() switched to this seeder has been missing it, even though
-- migration 185's one-time backfill only covered groups that existed before
-- that switch. Applied directly to production ahead of this file (name
-- 189_seed_chart_of_accounts_add_4006) since it's a genuine live gap
-- affecting real new-group signups, not merely a fresh-replay/CI concern
-- like 185's register_group() drift was.

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
    (p_group_id, '5004', 'Loan Write-offs',           'expense',   true)
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
$function$;

-- Backfill 4006 for any group that registered in the gap window (after
-- register_group() switched to seed_chart_of_accounts() out-of-band, before
-- this fix) — same idempotent shape as migration 185's original backfill.
INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT id, '4006', 'Changi$ha Donations', 'income', true
FROM groups
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE accounts.group_id = groups.id AND account_code = '4006'
);
