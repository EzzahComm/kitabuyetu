import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listGroupOptions } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

/** id + name only, for filter dropdowns/pickers — see listGroupOptions. */
export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const data = await listGroupOptions();
    return ok(data);
  });
}
