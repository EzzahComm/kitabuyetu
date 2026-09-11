import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest, notFound } from '@/lib/utils/response';
import {
  getOrganizationDetail, setOrganizationActive,
} from '@/lib/services/admin-organizations.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    const org = await getOrganizationDetail(id);
    if (!org) return notFound('Organization not found');
    return ok(org);
  });
}

const actionSchema = z.object({
  action: z.enum(['activate', 'deactivate']),
});

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id }  = await params;
    const body    = await req.json();
    const parsed  = actionSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await setOrganizationActive(id, parsed.data.action === 'activate');
    return ok(result);
  });
}
