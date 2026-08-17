export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { assignOrganizationPlan, getOrganizationPlan } from '@/lib/services/organization-plan.service';
import { ok, badRequest } from '@/lib/utils/response';

const customPlanSchema = z.object({
  monthlyFee:           z.number().min(0),
  maxLinkedGroups:      z.number().int().positive().nullable().optional(),
  maxStaff:             z.number().int().positive().nullable().optional(),
  maxFundingPrograms:   z.number().int().positive().nullable().optional(),
  smsAllowanceIncluded: z.number().min(0).optional(),
  supportTier:          z.enum(['standard', 'priority', 'priority_plus']).optional(),
});

const changePlanSchema = z.object({
  planType: z.enum(['starter', 'growth', 'premium', 'premium_plus']),
  custom:   customPlanSchema.optional(),
  notes:    z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.planType === 'premium_plus' && !v.custom) {
    ctx.addIssue({ code: 'custom', path: ['custom'], message: 'Premium+ requires custom terms, including the monthly fee' });
  }
});

/** GET current plan + usage vs. caps. POST changes the plan. Both super_admin only — organizations never self-serve a plan. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    return ok(await getOrganizationPlan(id));
  });
}

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const parsed = changePlanSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await assignOrganizationPlan(id, parsed.data.planType, auth.userId, {
      custom: parsed.data.custom, notes: parsed.data.notes,
    });
    return ok(result);
  });
}
