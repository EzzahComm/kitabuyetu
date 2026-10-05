-- Fix: 181's report_schedules trigger used a new bespoke function instead of
-- the existing, already-correctly-pinned private.set_updated_at() that
-- budgets/budget_lines and loan_charge_types/loan_charges (178/179) already
-- use for the identical purpose. The bespoke function also failed the
-- function_search_path_mutable security lint (no SET search_path). Switch to
-- the shared function and drop the redundant one.
DROP TRIGGER IF EXISTS trg_report_schedules_updated_at ON report_schedules;
CREATE TRIGGER trg_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

DROP FUNCTION IF EXISTS update_report_schedules_updated_at();
