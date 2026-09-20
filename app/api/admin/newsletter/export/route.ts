export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listNewsletterSubscribers } from '@/lib/services/newsletter.service';
import { rowsToCsv, csvFilename } from '@/lib/utils/csv';

const HEADERS = ['email', 'name', 'source', 'subscribed_at', 'unsubscribed_at'];

export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const subscribers = await listNewsletterSubscribers();
    const rows = subscribers.map((s) => ({
      email: s.email,
      name: s.name,
      source: s.source,
      subscribed_at: new Date(s.subscribed_at).toISOString(),
      unsubscribed_at: s.unsubscribed_at ? new Date(s.unsubscribed_at).toISOString() : null,
    }));
    const csv = rowsToCsv(HEADERS, rows);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename('newsletter-subscribers')}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
