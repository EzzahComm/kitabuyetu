export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { billingService } from '@/lib/services/billing.service';
import { RecordManualPaymentSchema, SmsTopupSchema } from '@/lib/validators/billing.schema';
import { ok, created } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'chairperson', async (auth) => {
    const body = await req.json();
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (body.type === 'sms_topup') {
      const input = SmsTopupSchema.parse(body);
      await billingService.addSmsCredits(ctx, input.amount);
      return ok({ message: 'SMS credits added successfully' });
    }

    const input = RecordManualPaymentSchema.parse(body);
    return created(await billingService.recordPayment(ctx, input));
  });
}
