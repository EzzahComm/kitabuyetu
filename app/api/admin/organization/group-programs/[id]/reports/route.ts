export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { getProgramReport } from '@/lib/services/program-reports.service';
import { ok } from '@/lib/utils/response';

const ParamsSchema = z.object({ id: z.string().uuid('Invalid program id') });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    const { id } = ParamsSchema.parse(await params);
    return ok(await getProgramReport(ctx, id));
  });
}
