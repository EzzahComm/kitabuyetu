import { createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import {
  reportExportService,
  processDueReportSchedules,
  processReportExport,
} from '@/lib/services/report-export.service';
import { uploadReportArtifact } from '@/lib/supabase/storage';
import { sendTemplatedEmail } from '@/lib/services/email.service';

jest.mock('@/lib/redis', () => ({
  ...jest.requireActual('@/lib/redis'),
  cached: (_key: string, _ttl: number, read: () => Promise<unknown>) => read(),
}));
jest.mock('@react-pdf/renderer', () => ({ StyleSheet: { create: (styles: unknown) => styles } }));
jest.mock('@/lib/supabase/storage', () => ({ uploadReportArtifact: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/services/email.service', () => ({
  ...jest.requireActual('@/lib/services/email.service'),
  sendTemplatedEmail: jest.fn().mockResolvedValue(undefined),
}));

describe('Recurring organization reports', () => {
  beforeEach(resetDatabase);
  afterAll(resetDatabase);

  it('resumes an overdue schedule once and sends the organization report link for the generated CSV', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const ctx = { organizationId, userId: coordinatorId, groupId: '', role: 'organization_coordinator' };
    const schedule = await reportExportService.createSchedule(ctx, {
      reportType: 'program_budget',
      format: 'csv',
      cadence: 'daily',
      recipientEmails: ['reports@example.org'],
    });
    await reportExportService.updateSchedule(ctx, schedule.id, { isActive: false });
    await rawQuery("UPDATE report_schedules SET next_run_at = NOW() - INTERVAL '2 months' WHERE id = $1", [
      schedule.id,
    ]);
    await reportExportService.updateSchedule(ctx, schedule.id, { isActive: true });
    expect(await processDueReportSchedules()).toEqual({ processed: 1 });
    expect(await processDueReportSchedules()).toEqual({ processed: 0 });

    const [row] = await rawQuery<{ id: string; job_id: string }>(
      'SELECT id, job_id FROM organization_report_exports WHERE schedule_id = $1',
      [schedule.id],
    );
    expect(row.job_id).toBeTruthy();
    await processReportExport(row.id, { isFinalAttempt: true });
    expect(uploadReportArtifact).toHaveBeenCalledWith(
      `${organizationId}/program_budget/${row.id}.csv`,
      expect.any(Buffer),
      'text/csv',
    );
    expect(sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'reports@example.org',
        vars: expect.objectContaining({ reportUrl: expect.stringContaining(`/enterprise/reports/exports/${row.id}`) }),
      }),
    );
    const changed = await reportExportService.updateSchedule(ctx, schedule.id, { cadence: 'weekly' });
    expect(Date.parse(changed.nextRunAt) - Date.parse(changed.lastRunAt!)).toBe(7 * 86400_000);
    await reportExportService.deleteSchedule(ctx, schedule.id);
    expect(await reportExportService.listSchedules(ctx)).toEqual([]);
  });
});
