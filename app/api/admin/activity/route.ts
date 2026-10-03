export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listActivity } from '@/lib/notifications/activity-query';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/activity - platform activity + admin notification delivery status. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const sp = new URL(req.url).searchParams;
    const channel = sp.get('channel');
    const data = await listActivity({
      page: Number(sp.get('page') ?? 1),
      limit: Number(sp.get('limit') ?? 50),
      eventType: sp.get('eventType') || undefined,
      severity: sp.get('severity') || undefined,
      organizationId: sp.get('organizationId') || undefined,
      groupId: sp.get('groupId') || undefined,
      userId: sp.get('userId') || undefined,
      transaction: sp.get('transaction') || undefined,
      status: sp.get('status') || undefined,
      from: sp.get('from') || undefined,
      to: sp.get('to') || undefined,
      channel: channel === 'sms' || channel === 'email' ? channel : undefined,
      failedOnly: sp.get('failedOnly') === 'true',
    });
    return ok(data);
  });
}
