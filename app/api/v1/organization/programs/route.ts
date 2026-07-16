export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/programs — list this organization's funding programs
 *   ?report=budget — budget variance/utilization report instead (per program:
 *   budget vs disbursed vs reserved-under-approval, plus schedule variance
 *   for dated programs).
 * POST /api/v1/organization/programs — create a funding program
 */

const PROGRAM_TYPES = [
  'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
  'seed_capital', 'emergency_support', 'operational_support',
  'scholarship', 'insurance', 'investment',
] as const;

const CreateProgramSchema = z.object({
  name:                  z.string().min(3).max(160),
  programType:           z.enum(PROGRAM_TYPES),
  budget:                z.number().positive().max(100_000_000_000),
  fundingSource:         z.string().max(160).optional(),
  description:           z.string().max(2000).optional(),
  eligibilityCriteria:   z.record(z.unknown()).optional(),
  geographicCoverage:    z.array(z.string().max(80)).max(100).optional(),
  reportingRequirements: z.string().max(2000).optional(),
  startsOn:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn:                z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    if (req.nextUrl.searchParams.get('report') === 'budget') {
      return ok({ items: await organizationFinanceService.programBudgetReport(ctx) });
    }
    return ok({ items: await organizationFinanceService.listPrograms(ctx) });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = CreateProgramSchema.parse(await req.json());
    return ok(await organizationFinanceService.createProgram(ctx, input), 201);
  });
}
