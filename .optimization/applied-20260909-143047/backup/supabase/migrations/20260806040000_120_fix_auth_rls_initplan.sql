-- ─────────────────────────────────────────────────────────────────────────────
-- 120: fix auth_rls_initplan — 6 policies re-evaluate current_setting() per row
--
-- Found by DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md (F3), via Supabase's
-- performance advisor against production. Each of these 6 policies calls
-- current_setting() directly in USING, unwrapped — Postgres's planner cannot
-- hoist that out of the per-row evaluation, so it re-runs once per row
-- scanned instead of once per statement. Standard fix: wrap the call in a
-- sub-select, `(select current_setting(...))`, so the planner caches it as
-- an InitPlan. Semantically identical (current_setting() is STABLE — same
-- value for the whole statement either way), purely a cost fix.
--
-- Behaviour-preserving: ALTER POLICY only replaces each policy's USING
-- expression (same predicate, same FOR ALL command, same lack of a separate
-- WITH CHECK — Postgres already reuses USING for WITH CHECK on FOR ALL
-- policies with none specified). Nothing about who can see/write which rows
-- changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- sms_trigger_rules (052): own group's rules + inherited org/platform rules
ALTER POLICY rls_sms_trigger_rules ON public.sms_trigger_rules
  USING (
    (group_id IS NULL AND organization_id IS NULL)
    OR group_id::TEXT = (SELECT current_setting('app.current_group_id', TRUE))
    OR organization_id IN (
      SELECT nga.organization_id FROM public.organization_group_access nga
      WHERE nga.group_id::TEXT = (SELECT current_setting('app.current_group_id', TRUE))
        AND nga.is_active = true
    )
  );

-- sms_trigger_executions (052): own group only
ALTER POLICY rls_sms_trigger_executions ON public.sms_trigger_executions
  USING (group_id::TEXT = (SELECT current_setting('app.current_group_id', TRUE)));

-- sms_provider_balances (013, last redefined by 096): admin-only
ALTER POLICY rls_sms_balances_admin ON public.sms_provider_balances
  USING (
    (SELECT current_setting('app.current_role', TRUE)) IN ('super_admin', 'chairperson', 'treasurer')
  );

-- contact_submissions (014, last redefined by 096): admin-only
ALTER POLICY rls_contact_subs ON public.contact_submissions
  USING (
    (SELECT current_setting('app.current_role', TRUE)) IN ('super_admin', 'chairperson')
  );

-- mpesa_callbacks (012, last redefined by 096): admin-only, no group_id column
ALTER POLICY rls_mpesa_callbacks_admin ON public.mpesa_callbacks
  USING (
    (SELECT current_setting('app.current_role', TRUE)) IN ('super_admin', 'chairperson')
  );

-- reminder_dispatch_log (106): own group only
ALTER POLICY rls_reminder_dispatch_log ON public.reminder_dispatch_log
  USING (group_id::TEXT = (SELECT current_setting('app.current_group_id', TRUE)));
