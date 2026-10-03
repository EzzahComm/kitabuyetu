export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { reportExportService } from '@/lib/services/report-export.service';
import { UpdateReportScheduleSchema } from '@/lib/validators/organization.schema';
import { ok, noContent, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH  /api/admin/organization/reports/schedules/:id — update cadence,
 *   recipients, notifyCoordinator, or pause/resume (isActive).
 * DELETE /api/admin/organization/reports/schedules/:id — remove a schedule.
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withOrganizationAccess(req, 'organization.reports.schedules.manage', async (auth) => {
    try {
      const input = UpdateReportScheduleSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      return ok(await reportExportService.updateSchedule(ctx, id, input));
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withOrganizationAccess(req, 'organization.reports.schedules.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      await reportExportService.deleteSchedule(ctx, id);
      return noContent();
    } catch (err) {
      return handleError(err);
    }
  });
}
