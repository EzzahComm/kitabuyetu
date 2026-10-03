export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { whatsappService } from '@/lib/services/whatsapp.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/whatsapp/status — whether the Meta Cloud API is configured.
 * Drives the dry-run banner on the /whatsapp page.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async () => {
    return ok({ configured: whatsappService.isConfigured() });
  });
}
