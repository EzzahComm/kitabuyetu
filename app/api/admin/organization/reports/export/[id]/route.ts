export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { reportExportService } from '@/lib/services/report-export.service';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/organization/reports/export/:id — pending | processing |
 * complete | failed, plus a freshly-minted signed download URL once
 * complete. The URL is never stored: a new one is generated on every call
 * here, bounded by REPORT_SIGNED_URL_TTL_SECONDS (1 hour), so it can never
 * outlive that window regardless of how long ago the export finished.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withOrganizationAccess(req, 'organization.reports.export', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      return ok(await reportExportService.getExportStatus(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}
