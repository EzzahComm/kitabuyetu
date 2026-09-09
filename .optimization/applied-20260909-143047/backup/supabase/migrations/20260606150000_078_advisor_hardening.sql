-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606150000  name: 078_advisor_hardening
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE OR REPLACE FUNCTION public.sync_group_member_role_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role_id IS NULL THEN
    SELECT id INTO NEW.role_id
      FROM public.roles
     WHERE group_id IS NULL AND base_role = NEW.role
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_governance_alerts_acknowledged_by
  ON public.governance_alerts (acknowledged_by);
