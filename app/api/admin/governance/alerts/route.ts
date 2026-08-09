import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listGovernanceAlerts } from '@/lib/services/governance.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p    = new URL(req.url).searchParams;
    const data = await listGovernanceAlerts({
      page:     parseInt(p.get('page')  ?? '1',  10),
      limit:    parseInt(p.get('limit') ?? '20', 10),
      status:   p.get('status')   ?? undefined,
      severity: p.get('severity') ?? undefined,
      groupId:  p.get('groupId')  ?? undefined,
    });
    return ok(data);
  });
}
