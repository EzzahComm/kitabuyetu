export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { initiateSTKPush } from '@/lib/services/mpesa.service';
import { withIdempotencyKey } from '@/lib/utils/idempotency';
import { StkPushSchema } from '@/lib/validators/mpesa.schema';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, (auth) =>
    // Idempotency-Key (§13): a client retry with the same key returns the
    // original response — never a second prompt on the member's phone.
    withIdempotencyKey(req, auth.userId, 'stk-push', async () => {
      const body  = await req.json();
      const input = StkPushSchema.parse(body);

      const result = await initiateSTKPush({
        ...input,
        groupId:     auth.groupId,
        invoiceId:   input.invoiceId ?? undefined,
        initiatedBy: auth.userId,
      });

      return ok({
        checkoutRequestId:   result.checkoutRequestId,
        merchantRequestId:   result.merchantRequestId,
        responseDescription: result.responseDescription,
        message:             'STK Push sent. Please complete the payment on your phone.',
      });
    }),
  );
}
