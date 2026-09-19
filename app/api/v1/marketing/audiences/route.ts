export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { createAudience, listAudiences, type AudienceSource } from '@/lib/services/marketing-campaigns.service';
import { ok, created, badRequest } from '@/lib/utils/response';

const SOURCES: AudienceSource[] = ['all_members', 'active_members', 'crm_contacts_opted_in'];

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const audiences = await listAudiences(ctx);
    return ok(audiences);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { name, source } = body;

    if (!name || typeof name !== 'string' || !name.trim()) return badRequest('name is required');
    if (!source || !SOURCES.includes(source)) return badRequest('A valid source is required');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const audience = await createAudience(ctx, { name, source });
    return created(audience);
  });
}
