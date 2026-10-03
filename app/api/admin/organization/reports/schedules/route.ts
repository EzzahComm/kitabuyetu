export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { reportExportService } from '@/lib/services/report-export.service';
import { CreateReportScheduleSchema } from '@/lib/validators/organization.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * GET  /api/admin/organization/reports/schedules — this organization's
 *   recurring report schedules.
 * POST /api/admin/organization/reports/schedules — create one. The first run
 *   fires on the next due 5-minute sweep tick (next_run_at defaults to now);
 *   subsequent runs follow `cadence` from there.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.reports.schedules.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      return ok({ items: await reportExportService.listSchedules(ctx) });
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.reports.schedules.manage', async (auth) => {
    try {
      const input = CreateReportScheduleSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      return ok(await reportExportService.createSchedule(ctx, input), 201);
    } catch (err) {
      return handleError(err);
    }
  });
}
