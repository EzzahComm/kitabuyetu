-- =============================================================================
-- clear-tenant-data.sql
--
-- DESTRUCTIVE: wipes all tenant data (registered groups + everything that
-- depends on them). Schema, enums, functions, RLS policies, and reference
-- data (counties / sub_counties / wards / system email_templates) are kept.
--
-- After this runs:
--   • The platform is back to "fresh install" state for tenant tables.
--   • Next registration starts at group_code = 'KY0000001'.
--   • All sessions (refresh_tokens) are invalidated — every signed-in user
--     gets logged out on their next request.
--   • Audit history is GONE (intentional — audit_logs is a tenant table
--     here, not a system audit log).
--
-- HOW TO RUN
--   Option A (Supabase Dashboard): SQL Editor → paste this file → Run.
--                                  Read the verification block at the bottom.
--   Option B (Supabase CLI):       supabase db query < scripts/clear-tenant-data.sql
--   Option C (psql):               \i scripts/clear-tenant-data.sql
--
-- ROLLBACK
--   None. Once you commit this transaction the data is gone. Take a Supabase
--   backup first if there's anything you might want back:
--     Supabase Dashboard → Database → Backups → Create backup
-- =============================================================================

BEGIN;

-- TRUNCATE bypasses BEFORE-DELETE row triggers (the audit_logs immutable
-- trigger fires on per-row DELETE, not on TRUNCATE), so this works without
-- needing to disable triggers manually.
--
-- CASCADE handles any FK references we might have missed in the explicit list
-- below — belt-and-braces. RESTART IDENTITY resets any SERIAL/IDENTITY columns
-- in the truncated tables.
--
-- Order doesn't matter when CASCADE is used; all listed tables are emptied
-- in one statement.

TRUNCATE TABLE
  -- Core tenant tables (parents of most FKs)
  public.groups,
  public.members,
  public.person,
  public.group_members,
  public.group_officers,
  public.group_member_counters,
  public.registrant_verifications,
  public.idempotency_keys,
  public.refresh_tokens,

  -- Financial
  public.accounts,
  public.journal_entries,
  public.journal_lines,
  public.billing_accounts,
  public.subscriptions,
  public.invoices,
  public.invoice_items,
  public.invoice_line_items,
  public.invoice_schedules,
  public.invoice_sequences,
  public.payments,
  public.payment_receipts,
  public.bill_manager_invoices,
  public.failed_payment_logs,
  public.contributions,
  public.loans,
  public.loan_repayments,

  -- Comms — SMS
  public.sms_usage_logs,
  public.sms_credits,
  public.sms_campaigns,
  public.sms_delivery_reports,
  public.sms_failures,
  public.sms_group_settings,
  public.sms_schedules,
  public.sms_templates,

  -- Comms — Email (system templates kept via WHERE clause below)
  public.email_logs,
  public.email_failures,
  public.email_delivery_reports,
  public.email_campaigns,
  public.email_campaign_recipients,
  public.email_preferences,
  public.email_schedules,
  public.group_email_branding,

  -- M-Pesa
  public.mpesa_transactions,
  public.mpesa_callbacks,
  public.mpesa_stk_requests,
  public.mpesa_reconciliations,
  public.mpesa_reversals,
  public.mpesa_b2b_transactions,
  public.mpesa_b2c_transactions,

  -- Modules
  public.meetings,
  public.meeting_attendance,
  public.meeting_resolutions,
  public.welfare_requests,
  public.welfare_pool_contributions,
  public.welfare_votes,
  public.investments,
  public.investment_returns,
  public.member_investment_shares,

  -- Notifications + audit
  public.notifications,
  public.notification_rules,
  public.audit_logs,

  -- Organization links (organization accounts themselves preserved)
  public.organization_group_access,

  -- Support
  public.support_tickets,
  public.ticket_comments
RESTART IDENTITY CASCADE;

-- Clear per-group customisations from email_templates while preserving the
-- platform-level system templates (rows with group_id IS NULL).
DELETE FROM public.email_templates WHERE group_id IS NOT NULL;

-- Reset the human-readable group code sequence so the next registration
-- starts at KY0000001. group_seq is a standalone SEQUENCE (not a SERIAL),
-- so RESTART IDENTITY above does not touch it.
ALTER SEQUENCE public.group_seq RESTART WITH 1;

COMMIT;

-- =============================================================================
-- Verification — run after committing to confirm everything is gone.
-- All counts should be 0; sequence should be back at 1.
-- =============================================================================

SELECT 'groups'                  AS table_name, count(*) FROM public.groups
UNION ALL SELECT 'members',                  count(*) FROM public.members
UNION ALL SELECT 'person',                   count(*) FROM public.person
UNION ALL SELECT 'group_members',            count(*) FROM public.group_members
UNION ALL SELECT 'group_officers',           count(*) FROM public.group_officers
UNION ALL SELECT 'contributions',            count(*) FROM public.contributions
UNION ALL SELECT 'loans',                    count(*) FROM public.loans
UNION ALL SELECT 'invoices',                 count(*) FROM public.invoices
UNION ALL SELECT 'audit_logs',               count(*) FROM public.audit_logs
UNION ALL SELECT 'refresh_tokens',           count(*) FROM public.refresh_tokens
UNION ALL SELECT 'registrant_verifications', count(*) FROM public.registrant_verifications
UNION ALL SELECT 'email_templates (system, kept)', count(*) FROM public.email_templates
UNION ALL SELECT 'counties (kept, should be 47)', count(*) FROM public.counties
ORDER BY table_name;

SELECT last_value AS group_seq_next FROM public.group_seq;
-- last_value should be 1 (or 0 with is_called=false if untouched);
-- the next nextval() returns 1 either way.
