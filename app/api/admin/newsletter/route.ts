export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listNewsletterSubscribers, getNewsletterStats } from '@/lib/services/newsletter.service';
import { ok } from '@/lib/utils/response';

export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const [subscribers, stats] = await Promise.all([listNewsletterSubscribers(), getNewsletterStats()]);
    return ok({ subscribers, stats });
  });
}
