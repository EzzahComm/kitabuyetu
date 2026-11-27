export const dynamic = 'force-dynamic';
import type { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { errorResponse } from '@/lib/utils/response';

/** Keep the former endpoint explicit for deployed clients with cached UI. */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async () =>
    errorResponse('Failed SMS messages cannot be resent.', 'SMS_REPLAY_DISABLED', 410),
  );
}
