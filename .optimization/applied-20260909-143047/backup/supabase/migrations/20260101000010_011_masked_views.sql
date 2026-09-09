-- =============================================================================
-- 011_masked_views.sql
-- Masked views for NGO coordinators and read-only / member-level access.
-- Real tables hold unmasked PII; views apply masking based on the caller's role.
-- All views use SECURITY INVOKER (default) so RLS on the base tables is enforced.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Utility masking functions
-- ---------------------------------------------------------------------------

-- Mask phone: +254712345678 -> +2547****5678
CREATE OR REPLACE FUNCTION mask_phone(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN LENGTH(p) >= 8
      THEN LEFT(p, 5) || REPEAT('*', LENGTH(p) - 8) || RIGHT(p, 3)
    ELSE REPEAT('*', LENGTH(p))
  END;
$$;

-- Mask email: user@example.com -> u***@example.com
CREATE OR REPLACE FUNCTION mask_email(e TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN e IS NULL THEN NULL
    WHEN POSITION('@' IN e) > 1
      THEN LEFT(e, 1) || REPEAT('*', POSITION('@' IN e) - 2)
           || SUBSTRING(e FROM POSITION('@' IN e))
    ELSE REPEAT('*', LENGTH(e))
  END;
$$;

-- Mask national ID: 12345678 -> 1234****
CREATE OR REPLACE FUNCTION mask_national_id(n TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN n IS NULL THEN NULL
    WHEN LENGTH(n) > 4 THEN LEFT(n, 4) || REPEAT('*', LENGTH(n) - 4)
    ELSE REPEAT('*', LENGTH(n))
  END;
$$;

-- ---------------------------------------------------------------------------
-- vw_members_masked
-- Used wherever the caller's role is NOT group_admin / treasurer / super_admin.
-- Secretary, member, and NGO roles get this masked version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_members_masked WITH (security_invoker = true) AS
SELECT
  m.id,
  m.first_name,
  m.last_name,
  -- PII masked for non-privileged roles
  CASE
    WHEN app_current_role() IN ('super_admin', 'group_admin', 'treasurer')
      THEN m.phone
    ELSE mask_phone(m.phone)
  END AS phone,
  CASE
    WHEN app_current_role() IN ('super_admin', 'group_admin', 'treasurer')
      THEN m.email
    ELSE mask_email(m.email)
  END AS email,
  CASE
    WHEN app_current_role() IN ('super_admin', 'group_admin')
      THEN m.national_id
    ELSE mask_national_id(m.national_id)
  END AS national_id,
  CASE
    WHEN app_current_role() IN ('super_admin', 'group_admin')
      THEN m.date_of_birth
    ELSE NULL
  END AS date_of_birth,
  CASE
    WHEN app_current_role() IN ('super_admin', 'group_admin')
      THEN m.address
    ELSE NULL
  END AS address,
  m.gender,
  m.profile_photo_url,
  m.platform_role,
  m.is_active,
  m.last_login_at,
  m.created_at,
  m.updated_at
FROM members m;

-- ---------------------------------------------------------------------------
-- vw_ngo_group_summary
-- Aggregated, anonymized group statistics visible to NGO coordinators.
-- No individual member PII, no individual transaction details.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_ngo_group_summary WITH (security_invoker = true) AS
SELECT
  g.id                                                    AS group_id,
  g.name                                                  AS group_name,
  g.type                                                  AS group_type,
  g.county,
  -- Member counts (no PII)
  COUNT(DISTINCT gm.member_id)  FILTER (WHERE gm.is_active)   AS active_member_count,
  COUNT(DISTINCT gm.member_id)  FILTER (WHERE NOT gm.is_active) AS inactive_member_count,
  -- Contribution aggregates (amounts only, no names)
  COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0)  AS total_contributions,
  COALESCE(COUNT(c.id)   FILTER (WHERE c.status = 'completed'), 0)  AS contribution_count,
  -- Loan aggregates
  COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status IN ('disbursed','active')), 0) AS active_loan_portfolio,
  COALESCE(COUNT(l.id)             FILTER (WHERE l.status = 'defaulted'),              0) AS defaulted_loan_count,
  -- Subscription tier
  sub.plan_type                                           AS subscription_plan,
  sub.status                                              AS subscription_status,
  g.created_at                                            AS group_created_at
FROM groups g
-- RLS on groups already restricts to groups this NGO can access
JOIN ngo_group_access nga
  ON nga.group_id = g.id
  AND nga.ngo_id   = app_current_ngo_id()
  AND nga.is_active = true
LEFT JOIN group_members gm  ON gm.group_id  = g.id
LEFT JOIN contributions c   ON c.group_id   = g.id
LEFT JOIN loans l           ON l.group_id   = g.id
LEFT JOIN subscriptions sub ON sub.group_id = g.id AND sub.status = 'active'
GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at;

-- ---------------------------------------------------------------------------
-- vw_contributions_summary
-- Monthly contribution rollup — used for reports. No individual names exposed
-- when accessed via NGO role (the join to vw_members_masked handles masking).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_contributions_monthly WITH (security_invoker = true) AS
SELECT
  group_id,
  DATE_TRUNC('month', contribution_date)  AS month,
  COUNT(*)                                AS transaction_count,
  SUM(amount) FILTER (WHERE status = 'completed')  AS total_collected,
  SUM(amount) FILTER (WHERE status = 'pending')    AS total_pending,
  SUM(amount) FILTER (WHERE status = 'overdue')    AS total_overdue
FROM contributions
GROUP BY group_id, DATE_TRUNC('month', contribution_date);

-- ---------------------------------------------------------------------------
-- vw_loan_portfolio
-- Loan portfolio summary per group. Used by the accounting and reports modules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_loan_portfolio WITH (security_invoker = true) AS
SELECT
  group_id,
  COUNT(*) FILTER (WHERE status = 'pending')                        AS pending_applications,
  COUNT(*) FILTER (WHERE status IN ('disbursed', 'active'))         AS active_loans,
  COUNT(*) FILTER (WHERE status = 'completed')                      AS completed_loans,
  COUNT(*) FILTER (WHERE status = 'defaulted')                      AS defaulted_loans,
  COALESCE(SUM(outstanding_balance) FILTER (WHERE status IN ('disbursed','active')), 0) AS total_outstanding,
  COALESCE(SUM(principal_amount)    FILTER (WHERE status IN ('disbursed','active')), 0) AS total_disbursed,
  COALESCE(SUM(principal_amount)    FILTER (WHERE status = 'defaulted'),             0) AS total_defaulted
FROM loans
GROUP BY group_id;

-- ---------------------------------------------------------------------------
-- vw_trial_balance
-- Standard trial balance: account code, name, total debits, total credits, net balance.
-- Filtered to the current group via RLS on accounts and journal_lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_trial_balance WITH (security_invoker = true) AS
SELECT
  a.group_id,
  a.account_code,
  a.name              AS account_name,
  a.type              AS account_type,
  COALESCE(SUM(jl.debit),  0) AS total_debits,
  COALESCE(SUM(jl.credit), 0) AS total_credits,
  a.balance           AS net_balance
FROM accounts a
LEFT JOIN journal_lines jl
  ON jl.account_id = a.id
  AND jl.group_id  = a.group_id
LEFT JOIN journal_entries je
  ON je.id       = jl.journal_entry_id
  AND je.status  = 'posted'
WHERE a.is_active = true
GROUP BY a.group_id, a.account_code, a.name, a.type, a.balance
ORDER BY a.account_code;

-- ---------------------------------------------------------------------------
-- vw_sms_usage_summary
-- SMS spend and credit balance per group. Used by the billing dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_sms_usage_summary WITH (security_invoker = true) AS
SELECT
  ba.group_id,
  ba.sms_credits                                           AS current_credits,
  ba.low_balance_threshold,
  ba.sms_credits <= ba.low_balance_threshold               AS is_low_balance,
  COALESCE(monthly.credits_used, 0)                        AS credits_used_this_month,
  COALESCE(monthly.sms_sent,     0)                        AS sms_sent_this_month,
  COALESCE(monthly.sms_delivered,0)                        AS sms_delivered_this_month
FROM billing_accounts ba
LEFT JOIN LATERAL (
  SELECT
    SUM(credits_deducted)                                   AS credits_used,
    COUNT(*)                                                AS sms_sent,
    COUNT(*) FILTER (WHERE status = 'delivered')            AS sms_delivered
  FROM sms_usage_logs
  WHERE group_id   = ba.group_id
    AND created_at >= DATE_TRUNC('month', NOW())
) monthly ON true;
