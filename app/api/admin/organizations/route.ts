import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, created, badRequest } from '@/lib/utils/response';
import {
  listOrganizations, createOrganization, ORGANIZATION_TYPES,
} from '@/lib/services/admin-organizations.service';
import { assignOrganizationPlan } from '@/lib/services/organization-plan.service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p    = new URL(req.url).searchParams;
    const data = await listOrganizations({
      page:   parseInt(p.get('page')  ?? '1',  10),
      limit:  parseInt(p.get('limit') ?? '20', 10),
      search: p.get('search') ?? undefined,
      type:   p.get('type')   ?? undefined,
      status: p.get('status') ?? undefined,
    });
    return ok(data);
  });
}

const customPlanSchema = z.object({
  monthlyFee:            z.number().min(0),
  maxLinkedGroups:       z.number().int().positive().nullable().optional(),
  maxStaff:              z.number().int().positive().nullable().optional(),
  maxFundingPrograms:    z.number().int().positive().nullable().optional(),
  smsAllowanceIncluded:  z.number().min(0).optional(),
  supportTier:           z.enum(['standard', 'priority', 'priority_plus']).optional(),
});

// A plan is required at creation — no organization exists without one, since
// only super_admin ever creates one and there's no "sign up unpaid, pay
// later" path here the way group registration has.
const createSchema = z.object({
  name:               z.string().min(2).max(255),
  type:               z.enum(ORGANIZATION_TYPES),
  registrationNumber: z.string().max(100).optional(),
  phone:              z.string().max(20).optional(),
  email:              z.string().email().max(255).optional().or(z.literal('')),
  county:             z.string().max(100).optional(),
  address:            z.string().max(500).optional(),
  planType:           z.enum(['starter', 'growth', 'premium', 'premium_plus']),
  custom:             customPlanSchema.optional(),
  planNotes:          z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.planType === 'premium_plus' && !v.custom) {
    ctx.addIssue({ code: 'custom', path: ['custom'], message: 'Premium+ requires custom terms, including the monthly fee' });
  }
});

export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const body   = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const org = await createOrganization({
      name: parsed.data.name, type: parsed.data.type,
      registrationNumber: parsed.data.registrationNumber, phone: parsed.data.phone,
      email: parsed.data.email || undefined, county: parsed.data.county, address: parsed.data.address,
    });

    // Deliberately a second step, not inside createOrganization's own
    // transaction — the org record and its plan are two different services
    // (admin-organizations.service.ts / organization-plan.service.ts). A
    // failure here is rare (the schema above already validated premium_plus's
    // required fields) but would leave a planless org; logged loudly rather
    // than silently swallowed so it gets caught and fixed by hand.
    try {
      await assignOrganizationPlan(org.id, parsed.data.planType, auth.userId, {
        custom: parsed.data.custom, notes: parsed.data.planNotes,
      });
    } catch (err) {
      logger.error('[admin/organizations] created org but plan assignment failed', {
        organizationId: org.id, err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return created(org);
  });
}
