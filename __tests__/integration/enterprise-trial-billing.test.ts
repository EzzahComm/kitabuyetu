import { createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { assignOrganizationPlan } from '@/lib/services/organization-plan.service';
import {
  getEnterpriseBilling,
  assertEnterpriseCoverage,
  sendEnterpriseInvoice,
} from '@/lib/services/enterprise-billing.service';
import { handleC2BConfirmation } from '@/lib/services/mpesa-c2b.service';
import { handleSTKCallback } from '@/lib/services/mpesa-stk.service';
import { sendEmailWithFallback } from '@/lib/email/provider';

jest.mock('@/lib/email/provider', () => ({ sendEmailWithFallback: jest.fn().mockResolvedValue({ success: true }) }));

it('issues one invoice at expiry, combines PayBill and STK receipts and unlocks once', async () => {
  await resetDatabase();
  try {
    const { organizationId: id, coordinatorId } = await createTestOrganization();
    const initial = await getEnterpriseBilling(id);
    expect(initial.state).toBe('trial');
    expect(new Date(initial.trial_ends_at).getTime() - Date.now()).toBeCloseTo(7 * 86400000, -4);
    await assignOrganizationPlan(id, 'starter', coordinatorId);
    expect((await getEnterpriseBilling(id)).trial_ends_at).toEqual(initial.trial_ends_at);
    await rawQuery("UPDATE enterprise_coverage SET trial_ends_at=now()-interval '1 minute' WHERE organization_id=$1", [
      id,
    ]);
    await rawQuery("UPDATE organizations SET email='billing@example.org' WHERE id=$1", [id]);
    await expect(assertEnterpriseCoverage(id)).rejects.toThrow(/billing/i);
    await sendEnterpriseInvoice();
    await sendEnterpriseInvoice();
    expect(sendEmailWithFallback).toHaveBeenCalledTimes(1);
    const { reference, balance } = await getEnterpriseBilling(id);
    expect(Number(balance)).toBe(2999);
    const paybill = {
      TransactionType: 'Pay Bill',
      TransID: 'TESTPART01',
      TransTime: '',
      TransAmount: '2000',
      BusinessShortCode: process.env.MPESA_SHORTCODE!,
      BillRefNumber: reference,
      MSISDN: '',
    };
    await handleC2BConfirmation(paybill, '', { skipIpCheck: true });
    expect(Number((await getEnterpriseBilling(id)).balance)).toBe(999);
    const [attempt] = await rawQuery<{ id: string }>(
      'INSERT INTO enterprise_stk_attempts(reference,amount) VALUES ($1,$2) RETURNING id',
      [reference, 999],
    );
    const stk = {
      enterpriseAttempt: attempt.id,
      Body: {
        stkCallback: {
          CheckoutRequestID: 'checkout',
          MerchantRequestID: 'merchant',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 999 },
              { Name: 'MpesaReceiptNumber', Value: 'TESTREST02' },
            ],
          },
        },
      },
    };
    await handleSTKCallback(stk, '', { skipIpCheck: true });
    const paid = await getEnterpriseBilling(id);
    expect(paid.state).toBe('paid');
    await handleC2BConfirmation({ ...paybill, TransID: 'TESTREST02', TransAmount: '999' }, '', { skipIpCheck: true });
    await handleSTKCallback(stk, '', { skipIpCheck: true });
    expect((await getEnterpriseBilling(id)).paid_until).toEqual(paid.paid_until);
    await expect(assertEnterpriseCoverage(id)).resolves.toBeUndefined();
  } finally {
    await resetDatabase();
  }
});
