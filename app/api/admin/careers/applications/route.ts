export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listApplications, type ApplicationStage } from '@/lib/services/careers.service';
import { ok } from '@/lib/utils/response';

export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const params = req.nextUrl.searchParams;
    const applications = await listApplications({
      jobSlug: params.get('jobSlug') ?? undefined,
      stage: (params.get('stage') as ApplicationStage | null) ?? undefined,
    });
    return ok(applications);
  });
}
