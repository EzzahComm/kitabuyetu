-- ============================================================================
-- 053 — Pin search_path on sms_trigger_exec_immutable()
--
-- Migration 052 created this trigger function without `SET search_path`, which
-- the Supabase linter flags (0011_function_search_path_mutable) and which is
-- inconsistent with the rest of the schema — every other function pins its
-- search_path (migrations 016–019). A mutable search_path lets a caller's
-- session settings influence unqualified name resolution inside the function;
-- pinning it to `public` removes that ambiguity. Body is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION sms_trigger_exec_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sms_trigger_executions is append-only; DELETE is not permitted';
  END IF;

  -- Only the dispatch-outcome columns may ever change, and only out of 'pending'.
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'sms_trigger_executions row % is already terminal (%)', OLD.id, OLD.status;
  END IF;
  IF NEW.rule_id  <> OLD.rule_id  OR NEW.group_id <> OLD.group_id
     OR NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type
     OR NEW.created_at <> OLD.created_at OR NEW.event_payload <> OLD.event_payload THEN
    RAISE EXCEPTION 'sms_trigger_executions identity columns are immutable';
  END IF;

  RETURN NEW;
END;
$$;
