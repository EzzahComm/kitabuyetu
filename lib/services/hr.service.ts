/**
 * HR employee records (Phase 11 foundation). Platform-level — "Kitabu Yetu
 * manages its own people" (roadmap), not a tenant/group concern, so this
 * runs entirely on the admin pool with no TenantContext.
 *
 * hr_employees owns its own name/email/phone rather than requiring a
 * `members` row first (mirrors crm_contacts, Phase 9.1) — an HR record is
 * created at hiring time, which routinely precedes or never reaches
 * platform-account creation. `member_id` is a nullable bridge, set only
 * once/if the employee is also given login access.
 */
import { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/utils/errors';
import type {
  CreateEmployeeInput, UpdateEmployeeInput, TerminateEmployeeInput,
} from '@/lib/validators/hr.schema';

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';
export type EmploymentStatus = 'active' | 'on_leave' | 'suspended' | 'terminated';

export interface Employee {
  id: string;
  member_id: string | null;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  hire_date: string;
  termination_date: string | null;
  manager_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

async function nextEmployeeNumber(db: PoolClient): Promise<string> {
  const { rows } = await db.query<{ n: string }>(`SELECT nextval('hr_employee_number_seq') AS n`);
  return `KY-EMP-${rows[0].n.padStart(4, '0')}`;
}

async function logHrAudit(
  db: PoolClient,
  actorId: string,
  action: string,
  employeeId: string,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, $2, 'hr_employee', $3, $4, $5)`,
    [actorId, action, employeeId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null],
  );
}

async function assertManagerExists(db: PoolClient, managerId: string, excludeId?: string): Promise<void> {
  if (excludeId && managerId === excludeId) throw new ValidationError('An employee cannot be their own manager');
  const { rows } = await db.query(`SELECT 1 FROM hr_employees WHERE id = $1`, [managerId]);
  if (!rows.length) throw new ValidationError('manager not found');
}

/**
 * Transaction-agnostic core, taking an already-open client rather than
 * opening its own — so a caller that needs employee creation atomic with
 * something else (careers.service.ts's hireApplicant, which must not leave
 * an hr_employees row committed if linking it back to the application then
 * fails) can run both in one transaction. createEmployee() below is the
 * normal entry point, wrapping this in its own transaction for every other
 * caller.
 */
async function createEmployeeWith(db: PoolClient, actorId: string, data: CreateEmployeeInput): Promise<Employee> {
  if (data.managerId) await assertManagerExists(db, data.managerId);

  const employeeNumber = await nextEmployeeNumber(db);
  const { rows } = await db.query<Employee>(
    `INSERT INTO hr_employees
       (member_id, employee_number, first_name, last_name, email, phone, department,
        job_title, employment_type, hire_date, manager_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.memberId ?? null, employeeNumber, data.firstName, data.lastName, data.email,
      data.phone ?? null, data.department ?? null, data.jobTitle ?? null,
      data.employmentType, data.hireDate, data.managerId ?? null, data.notes ?? null, actorId,
    ],
  );
  const employee = rows[0];
  await logHrAudit(db, actorId, 'hr_employee.create', employee.id, null, employee);
  return employee;
}

export async function createEmployee(actorId: string, data: CreateEmployeeInput): Promise<Employee> {
  return withAdminDb((db) => createEmployeeWith(db, actorId, data));
}

/** Exported for careers.service.ts's hireApplicant — see createEmployeeWith's doc comment. */
export { createEmployeeWith };

export async function listEmployees(filters?: {
  status?: EmploymentStatus;
  department?: string;
  search?: string;
}): Promise<Employee[]> {
  return withAdminDb(async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`employment_status = $${params.length}`);
    }
    if (filters?.department) {
      params.push(filters.department);
      conditions.push(`department = $${params.length}`);
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(first_name || ' ' || last_name || ' ' || email) ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query<Employee>(
      `SELECT * FROM hr_employees ${where} ORDER BY first_name, last_name`,
      params,
    );
    return rows;
  });
}

export async function getEmployeeById(id: string): Promise<Employee | null> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<Employee>(`SELECT * FROM hr_employees WHERE id = $1`, [id]);
    return rows[0] ?? null;
  });
}

const UPDATE_COLUMNS: Record<keyof UpdateEmployeeInput, string> = {
  firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
  department: 'department', jobTitle: 'job_title', employmentType: 'employment_type',
  managerId: 'manager_id', memberId: 'member_id', notes: 'notes',
};

export async function updateEmployee(actorId: string, id: string, updates: UpdateEmployeeInput): Promise<Employee> {
  const keys = Object.keys(updates) as (keyof UpdateEmployeeInput)[];
  if (!keys.length) throw new ValidationError('No fields to update');

  return withAdminDb(async (db) => {
    const { rows: existingRows } = await db.query<Employee>(`SELECT * FROM hr_employees WHERE id = $1`, [id]);
    if (!existingRows.length) throw new NotFoundError('Employee', id);
    const before = existingRows[0];

    if (updates.managerId) await assertManagerExists(db, updates.managerId, id);

    const sets = keys.map((k, i) => `${UPDATE_COLUMNS[k]} = $${i + 2}`);
    const values = keys.map((k) => updates[k]);
    sets.push('updated_at = NOW()');

    const { rows } = await db.query<Employee>(
      `UPDATE hr_employees SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const employee = rows[0];
    await logHrAudit(db, actorId, 'hr_employee.update', id, before, employee);
    return employee;
  });
}

export async function terminateEmployee(actorId: string, id: string, data: TerminateEmployeeInput): Promise<Employee> {
  return withAdminDb(async (db) => {
    const { rows: existingRows } = await db.query<Employee>(`SELECT * FROM hr_employees WHERE id = $1`, [id]);
    if (!existingRows.length) throw new NotFoundError('Employee', id);
    const before = existingRows[0];
    if (before.employment_status === 'terminated') {
      throw new ConflictError('This employee is already terminated');
    }

    // Reports of a terminated manager lose that link rather than pointing
    // at a former employee — same reasoning as the FK's ON DELETE SET NULL,
    // applied here since termination doesn't delete the row.
    await db.query(`UPDATE hr_employees SET manager_id = NULL WHERE manager_id = $1`, [id]);

    const { rows } = await db.query<Employee>(
      `UPDATE hr_employees
       SET employment_status = 'terminated', termination_date = $2,
           notes = CASE WHEN $3::text IS NOT NULL
                        THEN COALESCE(notes || E'\n\n', '') || 'Termination: ' || $3::text
                        ELSE notes END,
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, data.terminationDate, data.reason ?? null],
    );
    const employee = rows[0];
    await logHrAudit(db, actorId, 'hr_employee.terminate', id, before, employee);
    return employee;
  });
}
