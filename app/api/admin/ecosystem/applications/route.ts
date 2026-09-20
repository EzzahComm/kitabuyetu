export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listAllApplications } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as
      | 'submitted'
      | 'shortlisted'
      | 'accepted'
      | 'rejected'
      | 'withdrawn'
      | null;

    const applications = await listAllApplications(status ? { status } : undefined);
    return ok(applications);
  });
}
