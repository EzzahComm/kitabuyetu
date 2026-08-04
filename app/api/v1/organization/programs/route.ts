export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { CreateProgramSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/programs — list this organization's funding programs
 *   ?report=budget — budget variance/utilization report instead (per program:
 *   budget vs disbursed vs reserved-under-approval, plus schedule variance
 *   for dated programs).
 *   ?report=donor — donor/grant spend report instead (programs rolled up by
 *   funding_source, with a per-recipient-group settled-spend breakdown).
 * POST /api/v1/organization/programs — create a funding program
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.programs.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const report = req.nextUrl.searchParams.get('report');
    if (report === 'budget') {
      return ok({ items: await organizationFinanceService.programBudgetReport(ctx) });
    }
    if (report === 'donor') {
      return ok({ items: await organizationFinanceService.donorSpendReport(ctx) });
    }
    return ok({ items: await organizationFinanceService.listPrograms(ctx) });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.programs.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = CreateProgramSchema.parse(await req.json());
    return ok(await organizationFinanceService.createProgram(ctx, input), 201);
  });
}
