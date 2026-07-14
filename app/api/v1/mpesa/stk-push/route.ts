export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { initiateSTKPush } from '@/lib/services/mpesa.service';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { withIdempotencyKey } from '@/lib/utils/idempotency';
import { ok, handleError } from '@/lib/utils/response';

const StkPushSchema = z.object({
  phone:           z.string().refine(isValidKenyanPhone, 'Invalid phone number'),
  amount:          z.number().int().positive('Amount must be a positive integer (whole shillings)'),
  accountReference: z.string().min(1).max(12),
  description:     z.string().min(1).max(20),
  invoiceId:       z.string().uuid().optional().nullable(),
  purpose:         z.enum(['registration', 'subscription', 'sms_topup', 'contribution']),
});

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
