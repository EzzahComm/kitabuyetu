/**
 * The reconciliation sweep resolves STK requests whose callback never arrived
 * by asking Daraja (STK Push Query). ResultCode 1032 means the member
 * CANCELLED the prompt; it was once read as "still in process", so a cancelled
 * request whose callback was lost stayed pending forever and was re-queried
 * every five minutes.
 */
import { runReconciliation, stkQueryOutcome } from '@/lib/services/mpesa-reconciliation.service';
import { createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

jest.mock('@/lib/redis', () => ({
  cacheMpesaStatus: jest.fn().mockResolvedValue(undefined),
  acquireStkLock: jest.fn().mockResolvedValue(true),
  releaseStkLock: jest.fn().mockResolvedValue(undefined),
}));

// checkout id -> what Daraja answers (an Error = the HTTP 500 "being processed" reply)
const darajaAnswers = new Map<string, string | Error>();
jest.mock('@/lib/services/daraja.service', () => ({
  ...jest.requireActual('@/lib/services/daraja.service'),
  queryStkStatus: jest.fn(async (checkoutRequestId: string) => {
    const answer = darajaAnswers.get(checkoutRequestId);
    if (answer instanceof Error) throw answer;
    return {
      merchantRequestId: `merchant-${checkoutRequestId}`,
      checkoutRequestId,
      responseCode: '0',
      responseDescription: 'The service request has been accepted successsfully',
      resultCode: answer,
      resultDesc: 'test',
    };
  }),
}));

async function seedStale(groupId: string, label: string, answer: string | Error): Promise<string> {
  const checkoutRequestId = `ws_CO_recon_${label}_${Date.now()}`;
  darajaAnswers.set(checkoutRequestId, answer);
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status, initiated_at)
     VALUES ($1,$2,$3,'254700000000',100,'SUBSCRIPT','Subscription','subscription','pending',
             NOW() - INTERVAL '10 minutes')`,
    [groupId, checkoutRequestId, `merchant-${checkoutRequestId}`],
  );
  await rawQuery(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_checkout_request_id, mpesa_phone, channel)
     VALUES ($1,100,'mpesa','pending',$2,'254700000000','stk')`,
    [groupId, checkoutRequestId],
  );
  return checkoutRequestId;
}

async function statuses(checkoutRequestId: string): Promise<{ stk: string; payment: string }> {
  const [row] = await rawQuery<{ stk: string; payment: string }>(
    `SELECT s.status AS stk, p.status AS payment
     FROM mpesa_stk_requests s JOIN payments p ON p.mpesa_checkout_request_id = s.checkout_request_id
     WHERE s.checkout_request_id = $1`,
    [checkoutRequestId],
  );
  return row;
}

describe('stkQueryOutcome', () => {
  it.each([
    ['0', 'completed'],
    [0, 'completed'],
    ['1032', 'failed'],
    [1032, 'failed'],
    ['1037', 'failed'],
    ['1', 'failed'],
    ['2001', 'failed'],
    ['4999', null],
    ['', null],
    [undefined, null],
    [null, null],
  ])('maps %p to %p', (code, expected) => {
    expect(stkQueryOutcome(code)).toBe(expected);
  });
});

describe('runReconciliation — STK Push Query outcomes', () => {
  let groupId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('treasurer'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('settles cancelled and failed prompts, completes paid ones, and leaves in-flight ones pending', async () => {
    const cancelled = await seedStale(groupId, 'cancelled', '1032');
    const timedOut = await seedStale(groupId, 'timeout', '1037');
    const paid = await seedStale(groupId, 'paid', '0');
    const processing = await seedStale(groupId, 'processing', '4999');
    const httpBusy = await seedStale(groupId, 'busy', new Error('500.001.1001 The transaction is being processed'));

    const res = await runReconciliation(groupId, null);
    expect(res.transactionsChecked).toBe(5);
    expect(res.resolvedCount).toBe(3);

    expect(await statuses(cancelled)).toEqual({ stk: 'failed', payment: 'failed' });
    expect(await statuses(timedOut)).toEqual({ stk: 'failed', payment: 'failed' });
    expect(await statuses(paid)).toEqual({ stk: 'completed', payment: 'completed' });
    expect(await statuses(processing)).toEqual({ stk: 'pending', payment: 'pending' });
    expect(await statuses(httpBusy)).toEqual({ stk: 'pending', payment: 'pending' });
  });
});
