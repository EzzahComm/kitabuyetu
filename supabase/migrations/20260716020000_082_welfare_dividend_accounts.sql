-- New chart-of-accounts rows needed to close ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §7/§10's Critical finding: Shares, Welfare, Dividends, and Subscriptions
-- moved real cash with zero GL integration. Shares (existing 3001 Member
-- Equity) and Subscriptions (existing 5003 Platform Subscription) already
-- have a suitable seeded account — only Welfare and Dividends need new ones.
-- Seed for every existing group; accounting.service.ts seeds these for new
-- groups going forward (same pattern as migration 055's 4005 backfill).

INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '2102', 'Welfare Fund', 'liability', true FROM groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '2103', 'Dividends Payable', 'liability', true FROM groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '2104', 'Withholding Tax Payable', 'liability', true FROM groups g
ON CONFLICT (group_id, account_code) DO NOTHING;
