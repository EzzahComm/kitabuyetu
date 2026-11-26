export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programMembershipsService } from '@/lib/services/programs.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    const { id } = await params;
    const memberships = await programMembershipsService.listForProgram(ctx, id);
    const active = memberships.filter((membership) => membership.status === 'active').length;
    return ok({ active, total: memberships.length });
  });
}
