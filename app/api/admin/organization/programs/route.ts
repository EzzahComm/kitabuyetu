export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { recordOrgRead, auditRequestMeta } from '@/lib/services/audit.service';
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
  return withOrganizationAccess(req, 'organization.programs.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const report = req.nextUrl.searchParams.get('report');

    // R11 — the three ?report= views are financial analyses across the whole
    // organization, so each is a significant read and is audited. The bare
    // list below deliberately is NOT: it is what the funding page polls on a
    // 120s interval, and recording that would bury the real accesses.
    const auditReport = async (kind: string) => {
      await recordOrgRead({
        ctx, action: `organization.report.${kind}.view`,
        resourceType: 'organization', resourceId: auth.organizationId ?? null,
        ...auditRequestMeta(req),
      });
    };

    if (report === 'budget') {
      const items = await organizationFinanceService.programBudgetReport(ctx);
      await auditReport('budget');
      return ok({ items });
    }
    if (report === 'donor') {
      const items = await organizationFinanceService.donorSpendReport(ctx);
      await auditReport('donor');
      return ok({ items });
    }
    if (report === 'balances') {
      const items = await organizationFinanceService.productBalances(ctx);
      await auditReport('balances');
      return ok({ items });
    }
    return ok({ items: await organizationFinanceService.listPrograms(ctx) });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.programs.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = CreateProgramSchema.parse(await req.json());
    return ok(await organizationFinanceService.createProgram(ctx, input), 201);
  });
}
