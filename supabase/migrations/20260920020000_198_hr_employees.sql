-- =============================================================================
-- 198: Phase 11 — HRM foundation: employee records
--
-- "HRM is infrastructure, not identity" (roadmap). Confirmed by research
-- before writing this: `members` is the platform's ONE identity table for
-- every human who logs in — chama members, backoffice staff (via
-- platform_role), organization coordinators. There is no separate
-- platform_users table. `organization_members` (101) already establishes
-- the precedent this migration follows: a join/extension table layering
-- role-specific fields onto an identity, rather than a second parallel
-- identity system.
--
-- hr_employees extends that precedent one step further than
-- organization_members did, the same way crm_contacts (192) did: it owns
-- its OWN name/email/phone fields rather than requiring a members row to
-- exist first, and bridges to one via a NULLABLE member_id. Reason: HR
-- records are created at hiring time, which routinely precedes (or never
-- reaches) platform-account creation — a driver or office administrator may
-- never need to log in at all. Forcing every hire through `members` would
-- mean inserting throwaway password_hash/email rows into the platform's
-- shared identity table just to satisfy its NOT NULL constraints, which is
-- worse than a nullable bridge FK.
--
-- Platform-level, not tenant: no group_id/organization_id. "Kitabu Yetu
-- manages its OWN people" (roadmap exit criteria) — this is scoped to the
-- company's internal team for v1, not org-level field-staff HR (a
-- genuinely separate, larger scope, left for a later increment).
-- =============================================================================

CREATE TYPE hr_employment_type AS ENUM ('full_time', 'part_time', 'contract', 'intern');
CREATE TYPE hr_employment_status AS ENUM ('active', 'on_leave', 'suspended', 'terminated');

CREATE SEQUENCE hr_employee_number_seq START 1;

CREATE TABLE hr_employees (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Set once the employee also has (or is given) platform login access.
  -- Nullable: an HR record can exist before, or entirely without, one.
  member_id         UUID                  REFERENCES members (id) ON DELETE SET NULL,

  employee_number   VARCHAR(20)           NOT NULL,
  first_name        TEXT                  NOT NULL,
  last_name         TEXT                  NOT NULL,
  email             TEXT                  NOT NULL,
  phone             TEXT,
  department        TEXT,
  job_title         TEXT,
  employment_type   hr_employment_type    NOT NULL DEFAULT 'full_time',
  employment_status hr_employment_status  NOT NULL DEFAULT 'active',
  hire_date         DATE                  NOT NULL,
  termination_date  DATE,
  -- Self-referential org chart. ON DELETE SET NULL, not CASCADE: removing a
  -- manager's row must never cascade-delete their reports.
  manager_id        UUID                  REFERENCES hr_employees (id) ON DELETE SET NULL,
  notes             TEXT,

  created_by        UUID                  REFERENCES members (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT hr_employees_termination_date_consistent CHECK (
    (employment_status = 'terminated') = (termination_date IS NOT NULL)
  ),
  CONSTRAINT hr_employees_not_own_manager CHECK (manager_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX idx_hr_employees_number ON hr_employees (employee_number);
CREATE UNIQUE INDEX idx_hr_employees_email  ON hr_employees (lower(email));
CREATE UNIQUE INDEX idx_hr_employees_member ON hr_employees (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX idx_hr_employees_status  ON hr_employees (employment_status);
CREATE INDEX idx_hr_employees_manager ON hr_employees (manager_id) WHERE manager_id IS NOT NULL;

ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employees FORCE ROW LEVEL SECURITY;

-- Employee records are sensitive PII (and, once payroll lands, compensation
-- data) — restricted to super_admin only, not the wider support tier that
-- withPlatformRole often includes elsewhere.
CREATE POLICY rls_hr_employees_super_admin ON hr_employees
  FOR ALL
  USING ((SELECT is_super_admin()));

REVOKE ALL ON public.hr_employees FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employees TO service_role;
