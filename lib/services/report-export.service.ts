/**
 * Async report export (PDF/Excel/CSV) + scheduled reports — organization
 * axis, Phase 5 gap analysis items 1-2 (everything else on that axis — the
 * KPI dashboard, portfolio health, audit-on-read, member/programme
 * drill-down — already ships).
 *
 * Heavy report generation stays off the request path (product principle
 * §1.3): a request only ever inserts a row and enqueues a job; the actual
 * render + upload happens inside the existing lib/jobs queue, off any HTTP
 * request/response cycle. A signed download URL is never stored — it is
 * minted fresh, bounded by a short TTL, every time a caller asks for one
 * (getExportStatus below, and emailScheduledReport for the mailed link).
 *
 * Reused, not rebuilt:
 *   - organizationFinanceService.programBudgetReport/donorSpendReport are the
 *     report DATA — called unchanged, signatures untouched.
 *   - components/pdf/organization-report.tsx renders the PDF format, in the
 *     same react-pdf idiom as components/pdf/contribution-receipt.tsx (the
 *     only existing precedent — report-email.service.ts does NOT itself
 *     render PDFs, it only emails pre-built attachments, so there was no
 *     "PDF service" to extend here).
 *   - lib/jobs/* is the SAME job queue every other background task uses —
 *     organization_report_export and organization_report_schedules_process
 *     are new job TYPES in it, not a second queue.
 *   - email.service.ts's sendTemplatedEmail is the existing send path used
 *     to email a scheduled report's signed link once it's ready.
 */
import ExcelJS from 'exceljs';
import { renderToBuffer } from '@react-pdf/renderer';
import { withDb, pool, type TenantContext } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { organizationService } from './organization.service';
import { organizationFinanceService, type ProgramBudgetLine, type DonorSpendLine } from './organization-finance.service';
import { assertReportsAccess } from './organization-plan.service';
import { sendTemplatedEmail } from './email.service';
import {
  uploadReportArtifact, createReportSignedUrl,
  REPORT_SIGNED_URL_TTL_SECONDS, REPORT_EMAIL_SIGNED_URL_TTL_SECONDS,
} from '@/lib/supabase/storage';
import { ProgramBudgetReportPdf, DonorSpendReportPdf } from '@/components/pdf/organization-report';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import type {
  CreateReportExportInput, CreateReportScheduleInput, UpdateReportScheduleInput,
} from '@/lib/validators/organization.schema';

const orgId = (ctx: TenantContext): string => {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

export type ReportType   = 'program_budget' | 'donor_spend';
export type ReportFormat = 'pdf' | 'xlsx' | 'csv';
export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ReportCadence = 'daily' | 'weekly' | 'monthly';

const REPORT_NAMES: Record<ReportType, string> = {
  program_budget: 'Program Budget & Utilization Report',
  donor_spend:    'Donor / Grant Spend Report',
};

const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf:  'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv:  'text/csv',
};

export interface ExportRow {
  id:           string;
  reportType:   ReportType;
  format:       ReportFormat;
  status:       ExportStatus;
  createdAt:    string;
  completedAt:  string | null;
  error:        string | null;
}

export interface ScheduleRow {
  id:                string;
  reportType:        ReportType;
  format:            ReportFormat;
  cadence:           ReportCadence;
  recipientEmails:   string[];
  notifyCoordinator: boolean;
  isActive:          boolean;
  nextRunAt:         string;
  lastRunAt:         string | null;
  createdAt:         string;
}

const SCHEDULE_COLUMNS = `
  id, report_type AS "reportType", format, cadence,
  recipient_emails AS "recipientEmails", notify_coordinator AS "notifyCoordinator",
  is_active AS "isActive", next_run_at::text AS "nextRunAt", last_run_at::text AS "lastRunAt",
  created_at::text AS "createdAt"
`;

export const reportExportService = {
  // ── Ad-hoc export ───────────────────────────────────────────────────────

  /** POST /api/admin/organization/reports/export */
  async requestExport(
    ctx: TenantContext,
    input: CreateReportExportInput,
  ): Promise<{ id: string; status: ExportStatus }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);
    await withDb(ctx, (db) => assertReportsAccess(db, organizationId));

    const exportId = await withDb(ctx, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO organization_report_exports (organization_id, requested_by, report_type, format, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [organizationId, ctx.userId, input.reportType, input.format],
      );
      const id = rows[0]!.id;

      // Write-path audit: same transaction as the state change, mirroring
      // organization.service.ts's setBranding — a write's audit row belongs
      // beside the change it describes, unlike a read's (see audit.service.ts).
      await db.query(
        `INSERT INTO audit_logs (organization_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          organizationId, ctx.userId, 'organization.report.export.request', 'organization_report_export', id,
          JSON.stringify({ reportType: input.reportType, format: input.format }),
        ],
      );
      return id;
    });

    const jobId = await enqueueJob('organization_report_export', { exportId }, {
      priority:  2,
      dedup_key: `report_export:${exportId}`,
    });
    if (jobId) {
      await pool.query(
        `UPDATE organization_report_exports SET job_id = $2 WHERE id = $1`,
        [exportId, jobId],
      ).catch((err) => logger.warn('[report-export] failed to record job_id', { exportId, err: String(err) }));
    }

    return { id: exportId, status: 'pending' };
  },

  /**
   * GET /api/admin/organization/reports/export/:id — the signed URL is
   * generated fresh on every call (never persisted), so it can never outlive
   * REPORT_SIGNED_URL_TTL_SECONDS from the moment this is read.
   */
  async getExportStatus(
    ctx: TenantContext,
    exportId: string,
  ): Promise<ExportRow & { downloadUrl: string | null }> {
    await organizationService.assertOrganizationCoordinator(ctx);

    const row = await withDb(ctx, async (db) => {
      const { rows } = await db.query<{
        id: string; report_type: ReportType; format: ReportFormat; status: ExportStatus;
        object_path: string | null; error: string | null;
        created_at: string; completed_at: string | null;
      }>(
        `SELECT id, report_type, format, status, object_path, error,
                created_at::text, completed_at::text
         FROM organization_report_exports
         WHERE id = $1 AND organization_id = $2`,
        [exportId, orgId(ctx)],
      );
      return rows[0] ?? null;
    });
    if (!row) throw new NotFoundError('Report export', exportId);

    let downloadUrl: string | null = null;
    if (row.status === 'completed' && row.object_path) {
      try {
        downloadUrl = await createReportSignedUrl(row.object_path, REPORT_SIGNED_URL_TTL_SECONDS);
      } catch (err) {
        // The export itself succeeded; a signing hiccup shouldn't read as a
        // failed report. The route can retry by polling again.
        logger.error('[report-export] failed to mint signed URL', { exportId, err: String(err) });
      }
    }

    return {
      id: row.id, reportType: row.report_type, format: row.format, status: row.status,
      createdAt: row.created_at, completedAt: row.completed_at, error: row.error, downloadUrl,
    };
  },

  // ── Schedule CRUD ─────────────────────────────────────────────────────

  async listSchedules(ctx: TenantContext): Promise<ScheduleRow[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<ScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM report_schedules WHERE organization_id = $1 ORDER BY created_at DESC`,
        [orgId(ctx)],
      );
      return rows;
    });
  },

  async createSchedule(ctx: TenantContext, input: CreateReportScheduleInput): Promise<ScheduleRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);
    await withDb(ctx, (db) => assertReportsAccess(db, organizationId));

    return withDb(ctx, async (db) => {
      const { rows } = await db.query<ScheduleRow>(
        `INSERT INTO report_schedules
           (organization_id, created_by, report_type, format, cadence, recipient_emails, notify_coordinator)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SCHEDULE_COLUMNS}`,
        [
          organizationId, ctx.userId, input.reportType, input.format, input.cadence,
          input.recipientEmails ?? [], input.notifyCoordinator ?? false,
        ],
      );
      const created = rows[0]!;

      await db.query(
        `INSERT INTO audit_logs (organization_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, ctx.userId, 'organization.report.schedule.create', 'report_schedule', created.id, JSON.stringify(created)],
      );
      return created;
    });
  },

  async updateSchedule(
    ctx: TenantContext,
    scheduleId: string,
    input: UpdateReportScheduleInput,
  ): Promise<ScheduleRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    return withDb(ctx, async (db) => {
      const { rows: current } = await db.query<ScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM report_schedules WHERE id = $1 AND organization_id = $2`,
        [scheduleId, organizationId],
      );
      const prev = current[0];
      if (!prev) throw new NotFoundError('Report schedule', scheduleId);

      const cadence           = input.cadence ?? prev.cadence;
      const recipientEmails   = input.recipientEmails ?? prev.recipientEmails;
      const notifyCoordinator = input.notifyCoordinator ?? prev.notifyCoordinator;
      const isActive          = input.isActive ?? prev.isActive;

      if (!notifyCoordinator && recipientEmails.length === 0) {
        throw new ValidationError('Set at least one recipient email or enable notifyCoordinator');
      }

      const { rows } = await db.query<ScheduleRow>(
        `UPDATE report_schedules
         SET cadence = $3, recipient_emails = $4, notify_coordinator = $5, is_active = $6
         WHERE id = $1 AND organization_id = $2
         RETURNING ${SCHEDULE_COLUMNS}`,
        [scheduleId, organizationId, cadence, recipientEmails, notifyCoordinator, isActive],
      );
      const updated = rows[0]!;

      await db.query(
        `INSERT INTO audit_logs (organization_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          organizationId, ctx.userId, 'organization.report.schedule.update', 'report_schedule', scheduleId,
          JSON.stringify(prev), JSON.stringify(updated),
        ],
      );
      return updated;
    });
  },

  async deleteSchedule(ctx: TenantContext, scheduleId: string): Promise<void> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    await withDb(ctx, async (db) => {
      const { rows: current } = await db.query<ScheduleRow>(
        `SELECT ${SCHEDULE_COLUMNS} FROM report_schedules WHERE id = $1 AND organization_id = $2`,
        [scheduleId, organizationId],
      );
      const prev = current[0];
      if (!prev) throw new NotFoundError('Report schedule', scheduleId);

      await db.query(`DELETE FROM report_schedules WHERE id = $1 AND organization_id = $2`, [scheduleId, organizationId]);

      await db.query(
        `INSERT INTO audit_logs (organization_id, actor_id, action, resource_type, resource_id, old_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [organizationId, ctx.userId, 'organization.report.schedule.delete', 'report_schedule', scheduleId, JSON.stringify(prev)],
      );
    });
  },
};

// ── Job-processing internals — called from lib/jobs/handlers.ts ──────────

async function getOrganizationName(organizationId: string): Promise<string> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return rows[0]?.name ?? 'Organization';
}

function toBuffer(data: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function renderProgramBudgetSheet(sheet: ExcelJS.Worksheet, lines: ProgramBudgetLine[]): void {
  sheet.addRow([
    'Program', 'Type', 'Status', 'Budget', 'Disbursed', 'Reserved', 'Remaining',
    'Utilization %', 'Expected %', 'Variance %', 'Starts On', 'Ends On',
  ]);
  for (const l of lines) {
    sheet.addRow([
      l.name, l.programType, l.status, l.budget, l.disbursed, l.reserved, l.remaining,
      Number(l.utilizationPct.toFixed(2)),
      l.expectedUtilizationPct === null ? '' : Number(l.expectedUtilizationPct.toFixed(2)),
      l.variancePct === null ? '' : Number(l.variancePct.toFixed(2)),
      l.startsOn ?? '', l.endsOn ?? '',
    ]);
  }
}

function renderDonorSpendSheets(workbook: ExcelJS.Workbook, lines: DonorSpendLine[], includeGroupSheet: boolean): void {
  const bySource = workbook.addWorksheet('By Program');
  bySource.addRow(['Funding Source', 'Program', 'Budget', 'Disbursed']);
  for (const d of lines) {
    for (const p of d.programs) bySource.addRow([d.fundingSource, p.name, p.budget, p.disbursed]);
  }

  // A second sheet only makes sense for xlsx — CSV is a single flat file, so
  // the per-recipient-group breakdown is intentionally left out of the CSV
  // export; the PDF and XLSX formats both carry it in full.
  if (includeGroupSheet) {
    const byGroup = workbook.addWorksheet('By Recipient Group');
    byGroup.addRow(['Funding Source', 'Recipient Group', 'Settled Amount']);
    for (const d of lines) {
      for (const g of d.byGroup) byGroup.addRow([d.fundingSource, g.groupName ?? 'Unknown group', g.amount]);
    }
  }
}

/** Runs the existing report-data method and renders it to the requested format. */
async function renderReportArtifact(
  organizationId: string,
  reportType: ReportType,
  format: ReportFormat,
): Promise<{ buffer: Buffer; extension: string }> {
  // A background job has no live JWT/role to reuse. It doesn't need one:
  // generating an organization's OWN report on its behalf is exactly what
  // 'organization_coordinator' + that organization's id represents,
  // regardless of who originally triggered the job (an ad-hoc request or the
  // schedule sweep) — so this is deliberately fixed rather than threading
  // the original requester's role through the job payload and trusting it.
  const ctx: TenantContext = { userId: 'system', groupId: '', role: 'organization_coordinator', organizationId };
  const organizationName = await getOrganizationName(organizationId);
  const generatedAt = new Date().toISOString();

  if (reportType === 'program_budget') {
    const lines = await organizationFinanceService.programBudgetReport(ctx);
    if (format === 'pdf') {
      const buffer = await renderToBuffer(ProgramBudgetReportPdf({ organizationName, generatedAt, lines }));
      return { buffer: toBuffer(buffer), extension: 'pdf' };
    }
    const workbook = new ExcelJS.Workbook();
    renderProgramBudgetSheet(workbook.addWorksheet('Program Budget'), lines);
    if (format === 'xlsx') return { buffer: toBuffer(await workbook.xlsx.writeBuffer()), extension: 'xlsx' };
    return { buffer: toBuffer(await workbook.csv.writeBuffer()), extension: 'csv' };
  }

  const lines = await organizationFinanceService.donorSpendReport(ctx);
  if (format === 'pdf') {
    const buffer = await renderToBuffer(DonorSpendReportPdf({ organizationName, generatedAt, lines }));
    return { buffer: toBuffer(buffer), extension: 'pdf' };
  }
  const workbook = new ExcelJS.Workbook();
  renderDonorSpendSheets(workbook, lines, format === 'xlsx');
  if (format === 'xlsx') return { buffer: toBuffer(await workbook.xlsx.writeBuffer()), extension: 'xlsx' };
  return { buffer: toBuffer(await workbook.csv.writeBuffer()), extension: 'csv' };
}

/**
 * Email a finished scheduled report's signed link via the existing
 * templated-send path (email.service.ts). Best-effort per recipient — one
 * bad address must not block the others.
 */
async function emailScheduledReport(
  organizationId: string,
  scheduleId: string,
  objectPath: string,
  reportType: ReportType,
  format: ReportFormat,
): Promise<void> {
  const { rows } = await pool.query<{ recipient_emails: string[]; notify_coordinator: boolean }>(
    `SELECT recipient_emails, notify_coordinator FROM report_schedules WHERE id = $1`,
    [scheduleId],
  );
  const schedule = rows[0];
  if (!schedule) return;

  const recipients = new Set<string>(schedule.recipient_emails ?? []);
  if (schedule.notify_coordinator) {
    // Same shape as email.service's other organization-lead lookups
    // (organization_members.status = 'active', org_role = 'lead' —
    // organization-members.service.ts is the schema authority for this join).
    const { rows: leads } = await pool.query<{ email: string }>(
      `SELECT m.email FROM organization_members om JOIN members m ON m.id = om.member_id
       WHERE om.organization_id = $1 AND om.status = 'active' AND om.org_role = 'lead' AND m.email IS NOT NULL`,
      [organizationId],
    );
    for (const l of leads) recipients.add(l.email);
  }
  if (recipients.size === 0) return;

  const downloadUrl = await createReportSignedUrl(objectPath, REPORT_EMAIL_SIGNED_URL_TTL_SECONDS);
  const organizationName = await getOrganizationName(organizationId);

  for (const to of recipients) {
    await sendTemplatedEmail({
      templateKey: 'organization_report_ready',
      to,
      vars: {
        reportName:      REPORT_NAMES[reportType],
        organizationName,
        downloadUrl,
        format:          format.toUpperCase(),
        generatedAt:     new Date().toLocaleString('en-KE'),
      },
      referenceType: 'organization_report_export',
    }).catch((err) => logger.warn('[report-export] scheduled report email failed', { to, err: String(err) }));
  }
}

/**
 * Process one organization_report_export job — called by
 * lib/jobs/handlers.ts's handleOrganizationReportExport.
 *
 * `isFinalAttempt` decides whether a failure is recorded as a terminal
 * 'failed' status: job_queue itself always retries with its own exponential
 * backoff regardless (this rethrows on every failure), but marking the row
 * 'failed' before that retry budget is exhausted would show a coordinator a
 * permanent failure for what may just be a transient render/upload error
 * about to succeed a few minutes later.
 */
export async function processReportExport(exportId: string, opts: { isFinalAttempt: boolean }): Promise<string> {
  const { rows } = await pool.query<{
    id: string; organization_id: string; report_type: ReportType; format: ReportFormat;
    schedule_id: string | null;
  }>(
    `UPDATE organization_report_exports
     SET status = 'processing'
     WHERE id = $1
     RETURNING id, organization_id, report_type, format, schedule_id`,
    [exportId],
  );
  const row = rows[0];
  if (!row) throw new Error(`organization_report_exports row ${exportId} not found`);

  try {
    const { buffer, extension } = await renderReportArtifact(row.organization_id, row.report_type, row.format);
    const objectPath = `${row.organization_id}/${row.report_type}/${exportId}.${extension}`;
    await uploadReportArtifact(objectPath, buffer, CONTENT_TYPES[row.format]);

    await pool.query(
      `UPDATE organization_report_exports
       SET status = 'completed', object_path = $2, completed_at = NOW(), error = NULL
       WHERE id = $1`,
      [exportId, objectPath],
    );

    if (row.schedule_id) {
      await emailScheduledReport(row.organization_id, row.schedule_id, objectPath, row.report_type, row.format)
        .catch((err) => logger.error('[report-export] scheduled-report email failed', { exportId, err: String(err) }));
    }

    return `Report export ${exportId} completed (${row.report_type}/${row.format})`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.isFinalAttempt) {
      await pool.query(
        `UPDATE organization_report_exports SET status = 'failed', error = $2 WHERE id = $1`,
        [exportId, message.slice(0, 2000)],
      ).catch(() => {});
    }
    throw err;
  }
}

/**
 * Self-idempotent 5-minute sweep — same idiom as sms_process_schedules
 * (lib/jobs/index.ts / sms-scheduler.service.ts): atomically claim every due,
 * active schedule (advancing next_run_at in the same UPDATE, so a slow tick
 * can never reclaim a row it already fired), then enqueue one
 * organization_report_export job per claimed row.
 */
export async function processDueReportSchedules(): Promise<{ processed: number }> {
  const { rows } = await pool.query<{
    id: string; organization_id: string; created_by: string | null;
    report_type: ReportType; format: ReportFormat;
  }>(
    `UPDATE report_schedules
     SET next_run_at = CASE cadence
           WHEN 'daily'   THEN next_run_at + INTERVAL '1 day'
           WHEN 'weekly'  THEN next_run_at + INTERVAL '7 days'
           WHEN 'monthly' THEN next_run_at + INTERVAL '1 month'
         END,
         last_run_at = NOW()
     WHERE id IN (
       SELECT id FROM report_schedules
       WHERE is_active = true AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 100
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, organization_id, created_by, report_type, format`,
  );

  for (const s of rows) {
    const { rows: created } = await pool.query<{ id: string }>(
      `INSERT INTO organization_report_exports
         (organization_id, requested_by, report_type, format, status, schedule_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [s.organization_id, s.created_by, s.report_type, s.format, s.id],
    );
    const exportId = created[0]!.id;

    const jobId = await enqueueJob('organization_report_export', { exportId }, {
      priority:  2,
      dedup_key: `report_export:${exportId}`,
    });
    if (jobId) {
      await pool.query(`UPDATE organization_report_exports SET job_id = $2 WHERE id = $1`, [exportId, jobId]).catch(() => {});
    }
  }

  return { processed: rows.length };
}
