import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { getBillingOverview } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

// Platform billing is finance data. Support keeps operational access elsewhere
// but must not read billing revenue, so this route is super_admin only.
export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin'], async () => {
    const data = await getBillingOverview();
    return ok(data);
  });
}
