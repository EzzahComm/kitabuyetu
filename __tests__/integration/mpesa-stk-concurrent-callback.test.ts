/**
 * Safaricom retries STK callbacks, so the same success body can arrive twice
 * at the same moment. Both deliveries must serialise on the STK request lock
 * and the second must see the first's commit — otherwise the loan waterfall,
 * which has no per-receipt guard of its own, applies the money twice.
 */
import { handleSTKCallback, type StkCallbackBody } from '@/lib/services/mpesa-stk.service';
import { createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

jest.mock('@/lib/redis', () => ({
  cacheMpesaStatus: jest.fn().mockResolvedValue(undefined),
  acquireStkLock: jest.fn().mockResolvedValue(true),
  releaseStkLock: jest.fn().mockResolvedValue(undefined),
}));

function successBody(checkoutRequestId: string, receipt: string, amount: number, phone: string): StkCallbackBody {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: `merchant-${checkoutRequestId}`,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'PhoneNumber', Value: phone },
          ],
        },
      },
    },
  };
}

describe('STK callback — concurrent duplicate deliveries', () => {
  let groupId: string;
  let memberId: string;
  let phone: string;
  let firstInstallmentId: string;
  const checkoutRequestId = `ws_CO_conc_${Date.now()}`;
  const receipt = `CONC${Date.now().toString().slice(-8)}`;
  const amount = 300; // short of the 500 installment, so a second run would still find it open

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId: memberId } = await createTestGroup('treasurer'));
    [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [memberId]);
    const [{ id: gmId }] = await rawQuery<{ id: string }>(
      `SELECT id FROM group_members WHERE group_id=$1 AND member_id=$2`,
      [groupId, memberId],
    );

    // Loan + funding split in one statement: the "fully attributed" check is a
    // deferred trigger that runs at COMMIT (migration 118).
    const [{ id: loanId }] = await rawQuery<{ id: string }>(
      `WITH new_loan AS (
         INSERT INTO loans (group_id, member_id, group_membership_id, principal_amount, interest_rate,
                            loan_term_months, status, outstanding_balance, total_repayable)
         VALUES ($1,$2,$3,1000,0,2,'active',1000,1000) RETURNING id, group_id
       )
       INSERT INTO loan_funding_splits (group_id, loan_id, funding_source_id, amount)
       SELECT group_id, id,
              (SELECT id FROM group_funding_sources WHERE group_id=$1 AND source_type='internal_savings'),
              1000
       FROM new_loan
       RETURNING loan_id AS id`,
      [groupId, memberId, gmId],
    );
    const installments = await rawQuery<{ id: string }>(
      `INSERT INTO loan_repayments (group_id, loan_id, member_id, group_membership_id, installment_number,
                                    due_date, opening_balance, principal_component, interest_component,
                                    total_due, closing_balance, status)
       VALUES ($1,$2,$3,$4,1,CURRENT_DATE,1000,500,0,500,500,'pending'),
              ($1,$2,$3,$4,2,CURRENT_DATE + 30,500,500,0,500,0,'pending')
       RETURNING id`,
      [groupId, loanId, memberId, gmId],
    );
    firstInstallmentId = installments[0].id;

    await rawQuery(
      `INSERT INTO mpesa_stk_requests
         (group_id, checkout_request_id, merchant_request_id, phone, amount,
          account_reference, description, purpose, status, loan_repayment_id)
       VALUES ($1,$2,$3,$4,$5,'LOAN','Loan repayment','loan_repayment','pending',$6)`,
      [groupId, checkoutRequestId, `merchant-${checkoutRequestId}`, phone, amount.toFixed(2), firstInstallmentId],
    );
    await rawQuery(
      `INSERT INTO payments
         (group_id, amount, payment_method, status, mpesa_checkout_request_id, mpesa_phone, channel)
       VALUES ($1,$2,'mpesa','pending',$3,$4,'stk')`,
      [groupId, amount.toFixed(2), checkoutRequestId, phone],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('applies the money exactly once and both deliveries report the same payment', async () => {
    const body = successBody(checkoutRequestId, receipt, amount, phone);
    const results = await Promise.all([
      handleSTKCallback(body, '0.0.0.0', { skipIpCheck: true }),
      handleSTKCallback(body, '0.0.0.0', { skipIpCheck: true }),
    ]);

    const [{ total }] = await rawQuery<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paid),0)::text AS total FROM loan_repayments WHERE group_id=$1`,
      [groupId],
    );
    expect(parseFloat(total)).toBeCloseTo(amount, 2);

    const [payment] = await rawQuery<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE mpesa_checkout_request_id=$1`,
      [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');
    // The duplicate must still hand back the payment id so the post-commit
    // receipt step stays reachable (it is exactly-once on its own).
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.paymentId).toBe(payment.id);
    }

    const [{ count }] = await rawQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM payment_events WHERE payment_id=$1 AND event='received'`,
      [payment.id],
    );
    expect(count).toBe('1');
  });
});
