/**
 * The DLQ replay (mpesa_replay_callbacks) must do everything the live callback
 * route does after the money commits. It used to re-run only handleSTKCallback,
 * so a callback recovered by replay completed the payment but never credited
 * an SMS top-up and never sent the "payment received" receipt.
 */
import { replayUnprocessedCallbacks } from '@/lib/services/mpesa-callbacks.service';
import type { StkCallbackBody } from '@/lib/services/mpesa-stk.service';
import { SMS_EVENTS } from '@/lib/sms/events';
import { createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

jest.mock('@/lib/redis', () => ({
  cacheMpesaStatus: jest.fn().mockResolvedValue(undefined),
  acquireStkLock: jest.fn().mockResolvedValue(true),
  releaseStkLock: jest.fn().mockResolvedValue(undefined),
}));

// The provider send is out of scope here; the exactly-once claim it relies on
// is covered by the trigger engine's own tests.
const emitBusinessEvent = jest
  .fn()
  .mockResolvedValue({ evaluated: 0, matched: 0, dispatched: 0, deferred: 0, skipped: 0 });
jest.mock('@/lib/sms/trigger-engine', () => ({
  ...jest.requireActual('@/lib/sms/trigger-engine'),
  emitBusinessEvent: (...args: unknown[]) => emitBusinessEvent(...args),
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

async function seedPendingStk(
  groupId: string,
  phone: string,
  purpose: string,
  amount: number,
): Promise<{ checkoutRequestId: string; receipt: string }> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const checkoutRequestId = `ws_CO_replay_${suffix}`;
  const receipt = `RPL${suffix.slice(-9)}`;
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status)
     VALUES ($1,$2,$3,$4,$5,'REF','Test',$6,'pending')`,
    [groupId, checkoutRequestId, `merchant-${checkoutRequestId}`, phone, amount.toFixed(2), purpose],
  );
  await rawQuery(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_checkout_request_id, mpesa_phone, channel)
     VALUES ($1,$2,'mpesa','pending',$3,$4,'stk')`,
    [groupId, amount.toFixed(2), checkoutRequestId, phone],
  );
  return { checkoutRequestId, receipt };
}

/** A callback the live route audited but never finished processing. */
async function insertUnprocessedCallback(body: StkCallbackBody): Promise<void> {
  await rawQuery(
    `INSERT INTO mpesa_callbacks (callback_type, body, created_at)
     VALUES ('stk_push', $1::jsonb, NOW() - INTERVAL '3 minutes')`,
    [JSON.stringify(body)],
  );
}

describe('STK DLQ replay runs post-commit effects', () => {
  let groupId: string;
  let phone: string;

  beforeEach(async () => {
    await resetDatabase();
    emitBusinessEvent.mockClear();
    const g = await createTestGroup('treasurer');
    groupId = g.groupId;
    [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [g.officerId]);
    await rawQuery(
      `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 0)
       ON CONFLICT (group_id) DO UPDATE SET sms_credits = 0`,
      [groupId],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('credits an SMS top-up exactly once, even when Safaricom delivered it twice', async () => {
    const { checkoutRequestId, receipt } = await seedPendingStk(groupId, phone, 'sms_topup', 100);
    const body = successBody(checkoutRequestId, receipt, 100, phone);
    await insertUnprocessedCallback(body);
    await insertUnprocessedCallback(body);

    const res = await replayUnprocessedCallbacks();
    expect(res).toEqual({ examined: 2, replayed: 2, failed: 0 });

    const [payment] = await rawQuery<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE mpesa_checkout_request_id=$1`,
      [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');

    const [{ n }] = await rawQuery<{ n: string }>(`SELECT count(*)::text AS n FROM sms_credits WHERE payment_id=$1`, [
      payment.id,
    ]);
    expect(n).toBe('1');
    const [{ sms_credits }] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`,
      [groupId],
    );
    expect(Number(sms_credits)).toBeGreaterThan(0);

    const [{ unprocessed }] = await rawQuery<{ unprocessed: string }>(
      `SELECT count(*)::text AS unprocessed FROM mpesa_callbacks WHERE processed=false`,
    );
    expect(unprocessed).toBe('0');
  });

  it('emits the payment-received receipt for a replayed contribution', async () => {
    const { checkoutRequestId, receipt } = await seedPendingStk(groupId, phone, 'contribution', 500);
    await insertUnprocessedCallback(successBody(checkoutRequestId, receipt, 500, phone));

    await replayUnprocessedCallbacks();

    const [payment] = await rawQuery<{ id: string; status: string }>(
      `SELECT id, status FROM payments WHERE mpesa_checkout_request_id=$1`,
      [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');
    expect(emitBusinessEvent).toHaveBeenCalledTimes(1);
    expect(emitBusinessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: SMS_EVENTS.PAYMENT_RECEIVED, eventId: payment.id, groupId }),
    );
  });
});
