import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { compareOrganizations } from '@/lib/services/admin-organizations.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const data = await compareOrganizations();
    return ok(data);
  });
}
