export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { getResumeUrl } from '@/lib/services/careers.service';
import { ok, notFound } from '@/lib/utils/response';

/** GET — mints a fresh 1-hour signed URL, never stored, same discipline as report exports. */
export function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const url = await getResumeUrl(params.id);
    if (!url) return notFound('No resume on file for this application');
    return ok({ url });
  });
}
