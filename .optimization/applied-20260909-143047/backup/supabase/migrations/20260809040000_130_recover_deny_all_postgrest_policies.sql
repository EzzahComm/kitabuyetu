-- =============================================================================
-- 130: Recover 3 tables' deny-all RLS hardening into migration history
--
-- PRODUCTION_READINESS_AUDIT Pass 2 (docs/audit/02-ORPHAN-TABLES-AND-RLS-
-- PREDICATES.md): job_logs, job_queue, and member_mfa_secrets each carry a
-- real `FOR ALL USING (false) WITH CHECK (false)` policy in production
-- today (correct, deliberate hardening — nobody except a BYPASSRLS role can
-- touch these via any RLS-respecting connection), but none of the three
-- policy names appear anywhere in this migration history. A fresh build/CI
-- replay would come up with these tables RLS-enabled but zero policies —
-- which happens to be equivalent to deny-all only by coincidence (a
-- PERMISSIVE-policy table with no policies denies everything), not because
-- any migration says so. Capturing it explicitly here so the protection is
-- guaranteed rather than incidental, and so a future permissive policy
-- added to any of these three tables composes against an explicit deny
-- rather than silent absence.
--
-- Zero behavior change — all three policies already exist in production.
-- =============================================================================

DROP POLICY IF EXISTS job_logs_no_postgrest ON public.job_logs;
CREATE POLICY job_logs_no_postgrest ON public.job_logs
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS job_queue_no_postgrest ON public.job_queue;
CREATE POLICY job_queue_no_postgrest ON public.job_queue
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS member_mfa_secrets_no_postgrest ON public.member_mfa_secrets;
CREATE POLICY member_mfa_secrets_no_postgrest ON public.member_mfa_secrets
  FOR ALL USING (false) WITH CHECK (false);
