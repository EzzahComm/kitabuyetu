-- =============================================================================
-- 131: Capture the group_admin -> chairperson fix on 3 policies migration 050 missed
--
-- PRODUCTION_READINESS_AUDIT Pass 2 (docs/audit/02-ORPHAN-TABLES-AND-RLS-
-- PREDICATES.md): migration 050 (rename_organization_and_chairperson)
-- explicitly recreated ~20 policies to replace the literal 'group_admin'
-- with 'chairperson' after the member_role enum rename, since ALTER TYPE
-- RENAME VALUE doesn't touch string literals baked into a policy body.
-- Three policies were missed by that migration's own list but are already
-- correctly fixed live in production today (someone hand-patched them
-- directly, and that fix was never captured in any migration since):
--
--   mpesa_callbacks.rls_mpesa_callbacks_admin        (012_mpesa_dedicated_tables.sql:366)
--   sms_provider_balances.rls_sms_balances_admin     (013_sms_advanced_tables.sql:292)
--   contact_submissions.rls_contact_subs             (014_email_billing_tables.sql:237)
--
-- Production itself is correct and not at risk. The gap is reproducibility:
-- 'group_admin' no longer exists as a member_role value at all after 050's
-- ALTER TYPE ... RENAME VALUE, so a FRESH build/CI replay would recreate
-- these three policies checking a role literal that can never again match
-- anything — silently locking every chairperson out of mpesa_callbacks and
-- sms_provider_balances (both actively used) with zero error.
--
-- Zero behavior change against production — this only makes a fresh build
-- match what's already live.
-- =============================================================================

DROP POLICY IF EXISTS rls_mpesa_callbacks_admin ON public.mpesa_callbacks;
CREATE POLICY rls_mpesa_callbacks_admin ON public.mpesa_callbacks
  FOR ALL USING (current_setting('app.current_role', true) IN ('super_admin', 'chairperson'));

DROP POLICY IF EXISTS rls_sms_balances_admin ON public.sms_provider_balances;
CREATE POLICY rls_sms_balances_admin ON public.sms_provider_balances
  FOR ALL USING (current_setting('app.current_role', true) IN ('super_admin', 'chairperson', 'treasurer'));

DROP POLICY IF EXISTS rls_contact_subs ON public.contact_submissions;
CREATE POLICY rls_contact_subs ON public.contact_submissions
  FOR ALL USING (current_setting('app.current_role', true) IN ('super_admin', 'chairperson'));
