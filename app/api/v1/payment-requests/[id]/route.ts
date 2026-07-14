export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { paymentRequestsService } from '@/lib/services/payment-requests.service';
import { noContent, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/v1/payment-requests/:id — cancel an open request (treasurer+). */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      await paymentRequestsService.cancel(ctx, id);
      return noContent();
    } catch (err) {
      return handleError(err);
    }
  });
}
