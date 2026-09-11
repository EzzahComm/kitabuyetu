export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { whatsappService } from '@/lib/services/whatsapp.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const msg = await whatsappService.get(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(msg);
  });
}
