export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { recordOptIn, recordOptOut } from '@/lib/services/crm.service';
import { ok } from '@/lib/utils/response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const contact = await recordOptIn(ctx, params.id);
    return ok(contact);
  });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const contact = await recordOptOut(ctx, params.id);
    return ok(contact);
  });
}
