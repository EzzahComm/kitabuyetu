-- Drops 10 tables confirmed dead: zero rows in production AND zero references
-- anywhere in app/lib/components code (docs/audits/optimization-2026-09/raw/
-- dead-weight-and-structural-duplication-a.json finding #6, re-verified live
-- before dropping rather than trusting the raw finder's list as-is).
--
-- `idempotency_keys` was on the raw finding's list too but is NOT included
-- here — it's actively wired into lib/utils/idempotency.ts and the
-- settlements/vendor-payments/disbursements/mpesa STK-push/B2C routes; its
-- zero-row count just reflects that keys are short-lived, not that the table
-- is unused. The raw finder's static analysis produced a false positive on
-- this one table; independently re-verified before excluding it.
--
-- Each remaining table was checked for: live row count (0), app-code
-- references (0), inbound foreign keys from any other table (none — all FKs
-- are outbound from these tables to groups/members/invoices/email_logs), and
-- dependent views (none). Their own triggers/policies/indexes/sequences drop
-- automatically with the table.
--
-- welfare_votes is the one genuinely half-built feature here: migration
-- 072b created it alongside investment_shares in the same file, but only
-- investment_shares ever got a service/UI built on top of it (see
-- lib/services/investments.service.ts, app/(dashboard)/investments/[id]).
-- platform_notifications additionally carries undocumented schema drift
-- from its migration-025 origin (see
-- project_kitabu_yetu_rls_policy_cost_audit_fixes memory / PR #164) — that
-- drift is orthogonal to this drop; it has zero code references either way.

DROP TABLE IF EXISTS public.contact_submissions CASCADE;
DROP TABLE IF EXISTS public.email_delivery_reports CASCADE;
DROP TABLE IF EXISTS public.email_failures CASCADE;
DROP TABLE IF EXISTS public.email_suppressions CASCADE;
DROP TABLE IF EXISTS public.invoice_line_items CASCADE;
DROP TABLE IF EXISTS public.newsletter_subscribers CASCADE;
DROP TABLE IF EXISTS public.notification_rules CASCADE;
DROP TABLE IF EXISTS public.platform_billing CASCADE;
DROP TABLE IF EXISTS public.welfare_votes CASCADE;
DROP TABLE IF EXISTS public.platform_notifications CASCADE;
