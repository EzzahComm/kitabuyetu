-- ============================================================================
-- 196 — Pin search_path on email_trigger_exec_immutable()
--
-- Same gap migration 053 already fixed on its SMS twin
-- (sms_trigger_exec_immutable): migration 195 created this trigger function
-- without `SET search_path`, which the Supabase linter flags
-- (0011_function_search_path_mutable). Pinning it to `public` removes the
-- ambiguity that a mutable search_path introduces for unqualified name
-- resolution inside the function. Body unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION email_trigger_exec_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'email_trigger_executions is append-only; DELETE is not permitted';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'email_trigger_executions row % is already terminal (%)', OLD.id, OLD.status;
  END IF;
  IF NEW.rule_id  <> OLD.rule_id  OR NEW.group_id <> OLD.group_id
     OR NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type
     OR NEW.created_at <> OLD.created_at OR NEW.event_payload <> OLD.event_payload THEN
    RAISE EXCEPTION 'email_trigger_executions identity columns are immutable';
  END IF;

  RETURN NEW;
END;
$$;
