export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { billingService } from '@/lib/services/billing.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'billing.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await billingService.listInvoices(ctx));
  });
}
