/**
 * HR onboarding checklist (migration 214). A fixed per-employee checklist
 * seeded at hire time (see seedOnboardingTasks, called from
 * hr.service.ts's createEmployeeWith inside its own transaction — same
 * reasoning as careers.service.ts's hireApplicant: one commit, not two
 * systems that happen to agree).
 *
 * The default checklist lives here in code, not a template table — it's
 * small and rarely changes, so a code change is simpler than a migration.
 * A task is never deleted once seeded or added: an unwanted one is marked
 * 'skipped' instead, so the checklist stays an honest record of what
 * happened during onboarding, not just what's still open.
 */
import { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import type { AddOnboardingTaskInput, UpdateOnboardingTaskInput } from '@/lib/validators/hr-onboarding.schema';

export type OnboardingTaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface OnboardingTask {
  id: string;
  employee_id: string;
  category: string;
  title: string;
  description: string | null;
  status: OnboardingTaskStatus;
  due_date: string | null;
  notes: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

const DEFAULT_CHECKLIST: { category: string; title: string; description?: string; dueOffsetDays: number }[] = [
  { category: 'Paperwork', title: 'Collect signed offer letter & contract', dueOffsetDays: -3 },
  { category: 'Paperwork', title: 'Collect ID, KRA PIN and bank details', dueOffsetDays: 0 },
  { category: 'Access', title: 'Create company email account', dueOffsetDays: 0 },
  {
    category: 'Access',
    title: 'Grant platform login access',
    description: 'Only if this role needs to log in to Kitabu Yetu itself — link member_id once granted.',
    dueOffsetDays: 1,
  },
  { category: 'Equipment', title: 'Issue laptop and any other equipment', dueOffsetDays: 0 },
  { category: 'Team', title: 'Introduce to manager and team', dueOffsetDays: 0 },
  { category: 'Training', title: 'Complete company orientation', dueOffsetDays: 3 },
  { category: 'Training', title: 'Shadow a team member for the first week', dueOffsetDays: 5 },
  { category: 'Payroll', title: 'Add to payroll', dueOffsetDays: 7 },
];

/** hireDate arrives as whatever `pg` hands back for a DATE column — normalize both shapes. */
function offsetDate(hireDate: string | Date, days: number): string {
  const base = typeof hireDate === 'string' ? new Date(`${hireDate}T00:00:00Z`) : hireDate;
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function logOnboardingAudit(
  db: PoolClient,
  actorId: string,
  action: string,
  taskId: string,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, $2, 'hr_onboarding_task', $3, $4, $5)`,
    [
      actorId,
      action,
      taskId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ],
  );
}

/** Takes the caller's own transaction client — see this file's header. */
export async function seedOnboardingTasks(db: PoolClient, employeeId: string, hireDate: string | Date): Promise<void> {
  for (let i = 0; i < DEFAULT_CHECKLIST.length; i++) {
    const t = DEFAULT_CHECKLIST[i];
    await db.query(
      `INSERT INTO hr_onboarding_tasks (employee_id, category, title, description, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [employeeId, t.category, t.title, t.description ?? null, offsetDate(hireDate, t.dueOffsetDays), i],
    );
  }
}

export async function listOnboardingTasks(employeeId: string): Promise<OnboardingTask[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<OnboardingTask>(
      `SELECT * FROM hr_onboarding_tasks WHERE employee_id = $1 ORDER BY sort_order, created_at`,
      [employeeId],
    );
    return rows;
  });
}

export async function addOnboardingTask(
  actorId: string,
  employeeId: string,
  data: AddOnboardingTaskInput,
): Promise<OnboardingTask> {
  return withAdminDb(async (db) => {
    const { rows: employeeRows } = await db.query(`SELECT 1 FROM hr_employees WHERE id = $1`, [employeeId]);
    if (!employeeRows.length) throw new NotFoundError('Employee', employeeId);

    const { rows: maxRows } = await db.query<{ max: number | null }>(
      `SELECT MAX(sort_order) AS max FROM hr_onboarding_tasks WHERE employee_id = $1`,
      [employeeId],
    );
    const nextSort = (maxRows[0].max ?? -1) + 1;

    const { rows } = await db.query<OnboardingTask>(
      `INSERT INTO hr_onboarding_tasks (employee_id, category, title, description, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employeeId, data.category, data.title, data.description ?? null, data.dueDate ?? null, nextSort],
    );
    const task = rows[0];
    await logOnboardingAudit(db, actorId, 'hr_onboarding_task.add', task.id, null, task);
    return task;
  });
}

/**
 * Status drives completed_at/completed_by, not the caller: moving INTO
 * 'done' stamps them with NOW()/actorId, moving OUT of 'done' clears them,
 * and any other update (notes, due date) while already 'done' leaves them
 * alone — matches hr_onboarding_tasks_done_consistent's CHECK constraint.
 */
export async function updateOnboardingTask(
  actorId: string,
  taskId: string,
  data: UpdateOnboardingTaskInput,
): Promise<OnboardingTask> {
  return withAdminDb(async (db) => {
    const { rows: existingRows } = await db.query<OnboardingTask>(
      `SELECT * FROM hr_onboarding_tasks WHERE id = $1`,
      [taskId],
    );
    if (!existingRows.length) throw new NotFoundError('Onboarding task', taskId);
    const before = existingRows[0];

    const nextStatus = data.status ?? before.status;
    const nowDone = nextStatus === 'done';
    const wasDone = before.status === 'done';
    const dueDateProvided = data.dueDate !== undefined;
    const notesProvided = data.notes !== undefined;

    const { rows } = await db.query<OnboardingTask>(
      `UPDATE hr_onboarding_tasks
       SET status       = $2,
           due_date      = CASE WHEN $3 THEN $4::date ELSE due_date END,
           notes         = CASE WHEN $5 THEN $6 ELSE notes END,
           completed_at  = CASE WHEN $7 AND NOT $8 THEN NOW() WHEN NOT $7 THEN NULL ELSE completed_at END,
           completed_by  = CASE WHEN $7 AND NOT $8 THEN $9::uuid WHEN NOT $7 THEN NULL ELSE completed_by END,
           updated_at    = NOW()
       WHERE id = $1 RETURNING *`,
      [taskId, nextStatus, dueDateProvided, data.dueDate ?? null, notesProvided, data.notes ?? null, nowDone, wasDone, actorId],
    );
    const task = rows[0];
    await logOnboardingAudit(db, actorId, 'hr_onboarding_task.update', taskId, before, task);
    return task;
  });
}
