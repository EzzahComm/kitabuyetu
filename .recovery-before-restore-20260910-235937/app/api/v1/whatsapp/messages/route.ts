export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { whatsappService } from '@/lib/services/whatsapp.service';
import { SendWhatsAppMessageSchema, WhatsAppQuerySchema } from '@/lib/validators/whatsapp.schema';
import { created, ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = WhatsAppQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await whatsappService.list(ctx, params);
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'secretary', async (auth) => {
    const body  = await req.json();
    const input = SendWhatsAppMessageSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const msg   = await whatsappService.send(ctx, input);
    return created(msg);
  });
}
