-- =============================================================================
-- 214: HR onboarding checklist — per-employee tasks tracked from hire date
-- through their first weeks (paperwork, access, equipment, training).
--
-- Seeded from a fixed default checklist in hr.service.ts's createEmployeeWith,
-- in the same transaction as the hr_employees insert (same reasoning as
-- careers.service.ts's hireApplicant: one commit, not two systems that happen
-- to agree). The checklist itself is not stored as a template table — it is
-- small, rarely changes, and keeping it in code means no migration is needed
-- to adjust it. A task can be checked off, skipped (status, not deleted — a
-- skipped task is still an audit-visible decision), or added ad hoc for a
-- one-off item the standard checklist doesn't cover.
--
-- Platform-level, same tier as hr_employees: no group_id/organization_id,
-- RLS restricted to super_admin only.
-- =============================================================================

CREATE TYPE hr_onboarding_task_status AS ENUM ('pending', 'in_progress', 'done', 'skipped');

CREATE TABLE hr_onboarding_tasks (
  id            UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID                        NOT NULL REFERENCES hr_employees (id) ON DELETE CASCADE,

  category      TEXT                        NOT NULL,
  title         TEXT                        NOT NULL,
  description   TEXT,

  status        hr_onboarding_task_status   NOT NULL DEFAULT 'pending',
  due_date      DATE,
  notes         TEXT,

  completed_at  TIMESTAMPTZ,
  completed_by  UUID                        REFERENCES members (id) ON DELETE SET NULL,

  sort_order    SMALLINT                    NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

  CONSTRAINT hr_onboarding_tasks_done_consistent CHECK (
    (status = 'done') = (completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_hr_onboarding_tasks_employee ON hr_onboarding_tasks (employee_id, sort_order);
CREATE INDEX idx_hr_onboarding_tasks_open     ON hr_onboarding_tasks (employee_id) WHERE status NOT IN ('done', 'skipped');

CREATE TRIGGER trg_hr_onboarding_tasks_updated_at
  BEFORE UPDATE ON hr_onboarding_tasks
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE hr_onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_onboarding_tasks FORCE ROW LEVEL SECURITY;

-- Same tier as hr_employees — onboarding detail (manager, equipment, access)
-- is restricted to super_admin only, not the wider support tier.
CREATE POLICY rls_hr_onboarding_tasks_super_admin ON hr_onboarding_tasks
  FOR ALL
  USING ((SELECT is_super_admin()));

REVOKE ALL ON public.hr_onboarding_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_onboarding_tasks TO service_role;
