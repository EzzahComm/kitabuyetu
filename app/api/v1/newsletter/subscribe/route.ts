export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { subscribeToNewsletter } from '@/lib/services/newsletter.service';
import { NewsletterSubscribeSchema } from '@/lib/validators/newsletter.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/newsletter/subscribe — public. Whitelisted in proxy.ts's
 * PUBLIC_AUTH_PATHS (a marketing-site visitor has no session to verify) and
 * IP-rate-limited there like every other anonymous surface.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const input = NewsletterSubscribeSchema.parse(await req.json());
    await subscribeToNewsletter(input);
    return ok({ status: 'subscribed' });
  } catch (err) {
    return handleError(err);
  }
}
