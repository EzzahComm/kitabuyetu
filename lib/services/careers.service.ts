/**
 * Job applications (Phase 12 groundwork). Platform-level, same as
 * hr_employees/newsletter_subscribers — Kitabu Yetu's own hiring pipeline,
 * not a multi-tenant job board.
 *
 * Job POSTING content stays in Sanity (kitabuyetu-studio/); this only
 * tracks candidates who applied. job_slug is a soft reference to a Sanity
 * job document — see migration 199's header for why that can't be a real FK.
 */
import { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/utils/errors';
import { createEmployeeWith } from './hr.service';
import type { Employee } from './hr.service';
import { uploadResume, createResumeSignedUrl } from '@/lib/supabase/resume-storage';
import type {
  SubmitApplicationInput,
  UpdateApplicationStageInput,
  HireApplicantInput,
} from '@/lib/validators/careers.schema';

export type ApplicationStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

export interface JobApplication {
  id: string;
  job_slug: string;
  job_title: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  cover_note: string | null;
  resume_path: string | null;
  stage: ApplicationStage;
  stage_notes: string | null;
  source: string;
  hired_employee_id: string | null;
  reviewed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

async function logCareersAudit(
  db: PoolClient,
  actorId: string | null,
  action: string,
  applicationId: string,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, $2, 'job_application', $3, $4, $5)`,
    [
      actorId,
      action,
      applicationId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ],
  );
}

/**
 * A public visitor submitting an application has no `members` row and
 * therefore no actor to attribute the audit entry to — actor_id is NULL,
 * same convention as any other system/anonymous-originated audit row
 * elsewhere in this codebase.
 */
export async function submitApplication(
  data: SubmitApplicationInput,
  resume?: { buffer: Buffer; contentType: string; filename: string },
): Promise<JobApplication> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<JobApplication>(
      `INSERT INTO job_applications (job_slug, job_title, applicant_name, applicant_email, applicant_phone, cover_note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.jobSlug,
        data.jobTitle,
        data.applicantName,
        data.applicantEmail,
        data.applicantPhone ?? null,
        data.coverNote ?? null,
      ],
    );
    let application = rows[0];

    // Resume upload is best-effort: a Storage misconfiguration or transient
    // failure must never block the application itself from going through —
    // the candidate's contact info and cover note are already saved.
    if (resume) {
      try {
        const ext = resume.filename.includes('.') ? resume.filename.split('.').pop() : 'pdf';
        const path = `${application.id}/resume.${ext}`;
        await uploadResume(path, resume.buffer, resume.contentType);
        const { rows: updated } = await db.query<JobApplication>(
          `UPDATE job_applications SET resume_path = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [application.id, path],
        );
        application = updated[0];
      } catch {
        // Swallowed deliberately — see comment above. The application still succeeds.
      }
    }

    await logCareersAudit(db, null, 'job_application.submit', application.id, null, application);
    return application;
  });
}

export async function listApplications(filters?: {
  jobSlug?: string;
  stage?: ApplicationStage;
}): Promise<JobApplication[]> {
  return withAdminDb(async (db) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.jobSlug) {
      params.push(filters.jobSlug);
      conditions.push(`job_slug = $${params.length}`);
    }
    if (filters?.stage) {
      params.push(filters.stage);
      conditions.push(`stage = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query<JobApplication>(
      `SELECT * FROM job_applications ${where} ORDER BY created_at DESC`,
      params,
    );
    return rows;
  });
}

export async function getApplicationById(id: string): Promise<JobApplication | null> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<JobApplication>(`SELECT * FROM job_applications WHERE id = $1`, [id]);
    return rows[0] ?? null;
  });
}

/** A resume's signed URL is minted fresh on every view, never stored — same discipline as report exports. */
export async function getResumeUrl(id: string): Promise<string | null> {
  const application = await getApplicationById(id);
  if (!application?.resume_path) return null;
  return createResumeSignedUrl(application.resume_path);
}

export async function updateApplicationStage(
  actorId: string,
  id: string,
  data: UpdateApplicationStageInput,
): Promise<JobApplication> {
  return withAdminDb(async (db) => {
    const { rows: existingRows } = await db.query<JobApplication>(`SELECT * FROM job_applications WHERE id = $1`, [id]);
    if (!existingRows.length) throw new NotFoundError('Application', id);
    const before = existingRows[0];
    if (before.stage === 'hired')
      throw new ConflictError('This application is already hired — its stage cannot be changed further');

    const { rows } = await db.query<JobApplication>(
      `UPDATE job_applications
       SET stage = $2, stage_notes = COALESCE($3, stage_notes), reviewed_by = $4, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, data.stage, data.notes ?? null, actorId],
    );
    const application = rows[0];
    await logCareersAudit(db, actorId, 'job_application.stage_change', id, before, application);
    return application;
  });
}

/**
 * The Phase 11 integration point: hiring a candidate creates a real
 * hr_employees row from their application (name/email carried over,
 * everything else supplied here) and links the two records together.
 */
export async function hireApplicant(
  actorId: string,
  id: string,
  data: HireApplicantInput,
): Promise<{ application: JobApplication; employee: Employee }> {
  return withAdminDb(async (db) => {
    const { rows: existingRows } = await db.query<JobApplication>(`SELECT * FROM job_applications WHERE id = $1`, [id]);
    if (!existingRows.length) throw new NotFoundError('Application', id);
    const before = existingRows[0];
    if (before.stage === 'hired') throw new ConflictError('This application has already been hired');
    if (before.stage === 'rejected')
      throw new ValidationError('Cannot hire a rejected application — move it back to a live stage first');

    const [firstName, ...rest] = before.applicant_name.trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    // createEmployeeWith (not createEmployee) — takes this transaction's
    // own client rather than opening a second, independent one, so the new
    // hr_employees row and the application's hired_employee_id link commit
    // or roll back together. A separate transaction here would let a
    // failure on the UPDATE below leave a hired employee record with no
    // application ever marked as hired — a real inconsistency, not a
    // theoretical one, since this is the one place the two tables meet.
    const employee = await createEmployeeWith(db, actorId, {
      firstName,
      lastName,
      email: before.applicant_email,
      phone: before.applicant_phone ?? undefined,
      department: data.department,
      jobTitle: data.jobTitle ?? before.job_title,
      employmentType: data.employmentType,
      hireDate: data.hireDate,
      managerId: data.managerId,
      notes: `Hired via application for "${before.job_title}" (${before.job_slug}).`,
    });

    const { rows } = await db.query<JobApplication>(
      `UPDATE job_applications
       SET stage = 'hired', hired_employee_id = $2, reviewed_by = $3, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, employee.id, actorId],
    );
    const application = rows[0];
    await logCareersAudit(db, actorId, 'job_application.hire', id, before, application);
    return { application, employee };
  });
}
