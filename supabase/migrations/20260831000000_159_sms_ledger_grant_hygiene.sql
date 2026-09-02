-- =============================================================================
-- 159: Remove the redundant UPDATE/DELETE grants on sms_credit_ledger
--      (SMS-AUDIT-v3 V3-06 / INV-07)
--
-- The ledger is append-only and that IS enforced: trigger
-- sms_ledger_no_update fires BEFORE DELETE OR UPDATE on every row and raises
-- 42501 unconditionally (migration 141). So the append-only property holds
-- today regardless of this change.
--
-- But the trigger is the ONLY thing holding it. app_tenant still carries
-- UPDATE and DELETE privileges on the table, so a single future
-- `CREATE OR REPLACE FUNCTION sms_ledger_immutable()` that changed the body,
-- or a DROP TRIGGER in an unrelated migration, would silently make the
-- ledger mutable with nothing else in the way. This project has been bitten
-- twice by exactly that shape: CREATE OR REPLACE resetting function
-- privileges and re-opening a PostgREST hole (migrations 107, 126), and
-- migration 131 silently undoing migration 120's RLS-initplan work.
--
-- Revoking costs nothing to verify: any code path that tried either verb
-- would already be failing on the trigger, so there is nothing to break.
-- After this, an attempt fails with a PERMISSION error instead of reaching
-- the trigger at all — two independent barriers rather than one.
--
-- Deliberately NOT touching service_role or postgres. service_role is the
-- admin pool this application actually writes through, and postgres owns the
-- table; both legitimately need full DML for maintenance and backfills, and
-- both are still stopped by the trigger.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    REVOKE UPDATE, DELETE ON public.sms_credit_ledger FROM app_tenant;
  END IF;
END
$$;
