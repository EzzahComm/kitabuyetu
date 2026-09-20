import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listGovernanceAlerts } from '@/lib/services/governance.service';
import { parsePagination } from '@/lib/utils/pagination';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p = new URL(req.url).searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 20 });
    const data = await listGovernanceAlerts({
      page,
      limit,
      status: p.get('status') ?? undefined,
      severity: p.get('severity') ?? undefined,
      groupId: p.get('groupId') ?? undefined,
    });
    return ok(data);
  });
}
