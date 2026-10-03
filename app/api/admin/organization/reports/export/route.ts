export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { reportExportService } from '@/lib/services/report-export.service';
import { CreateReportExportSchema } from '@/lib/validators/organization.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/admin/organization/reports/export — enqueue an async report
 * export (Phase 5 gap analysis item 1). Returns immediately with a pending
 * export id; the actual render/upload happens off the request path in the
 * existing job queue (job type organization_report_export). Poll
 * GET .../export/:id for status and, once complete, a fresh signed download
 * URL.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.reports.export', async (auth) => {
    try {
      const input = CreateReportExportSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      return ok(await reportExportService.requestExport(ctx, input), 202);
    } catch (err) {
      return handleError(err);
    }
  });
}
