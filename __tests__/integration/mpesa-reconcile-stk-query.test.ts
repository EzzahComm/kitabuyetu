/**
 * The reconciliation sweep resolves STK requests whose callback never arrived
 * by asking Daraja (STK Push Query). ResultCode 1032 means the member
 * CANCELLED the prompt; it was once read as "still in process", so a cancelled
 * request whose callback was lost stayed pending forever and was re-queried
 * every five minutes. A request the sweep fails gets the same PayBill fallback
 * SMS the live failure callback sends — once.
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

const notifyMember = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/notifications.service', () => ({
  ...jest.requireActual('@/lib/services/notifications.service'),
  notifyMember: (...args: unknown[]) => notifyMember(...args),
}));

// checkout id -> what Daraja answers (an Error = the HTTP 500 "being processed"
// reply), plus an optional hook that runs just before it answers.
const darajaAnswers = new Map<string, { answer: string | Error; before?: () => Promise<void> }>();
jest.mock('@/lib/services/daraja.service', () => ({
  ...jest.requireActual('@/lib/services/daraja.service'),
  queryStkStatus: jest.fn(async (checkoutRequestId: string) => {
    const entry = darajaAnswers.get(checkoutRequestId);
    await entry?.before?.();
    if (entry?.answer instanceof Error) throw entry.answer;
    return {
      merchantRequestId: `merchant-${checkoutRequestId}`,
      checkoutRequestId,
      responseCode: '0',
      responseDescription: 'The service request has been accepted successsfully',
      resultCode: entry?.answer,
      resultDesc: 'test',
    };
  }),
}));

interface SeedOpts {
  purpose?: string;
  phone?: string;
  accountReference?: string;
  before?: () => Promise<void>;
}

async function seedStale(groupId: string, label: string, answer: string | Error, opts: SeedOpts = {}): Promise<string> {
  const checkoutRequestId = `ws_CO_recon_${label}_${Date.now()}`;
  const phone = opts.phone ?? '254700000000';
  darajaAnswers.set(checkoutRequestId, { answer, before: opts.before });
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status, initiated_at)
     VALUES ($1,$2,$3,$4,100,$5,'Test',$6,'pending', NOW() - INTERVAL '10 minutes')`,
    [
      groupId,
      checkoutRequestId,
      `merchant-${checkoutRequestId}`,
      phone,
      opts.accountReference ?? 'SUBSCRIPT',
      opts.purpose ?? 'subscription',
    ],
  );
  await rawQuery(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_checkout_request_id, mpesa_phone, channel)
     VALUES ($1,100,'mpesa','pending',$2,$3,'stk')`,
    [groupId, checkoutRequestId, phone],
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
  let memberPhone: string;

  beforeEach(async () => {
    await resetDatabase();
    notifyMember.mockClear();
    const g = await createTestGroup('treasurer');
    groupId = g.groupId;
    [{ phone: memberPhone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [
      g.officerId,
    ]);
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

    // Billing prompts (subscription) never get the member PayBill nudge.
    expect(notifyMember).not.toHaveBeenCalled();
  });

  it('self-heals a paid contribution prompt and links the contribution to its payment', async () => {
    const paid = await seedStale(groupId, 'contrib_paid', '0', {
      purpose: 'contribution',
      phone: memberPhone,
      accountReference: 'CONTRIB',
    });

    await runReconciliation(groupId, null);

    const [row] = await rawQuery<{ payment_id: string; contribution_payment_id: string | null }>(
      `SELECT p.id AS payment_id, c.payment_id AS contribution_payment_id
       FROM mpesa_stk_requests s
       JOIN payments p ON p.mpesa_checkout_request_id = s.checkout_request_id
       JOIN contributions c ON c.id = s.contribution_id
       WHERE s.checkout_request_id = $1`,
      [paid],
    );
    expect(row).toBeDefined();
    // Without this link the self-healed contribution is real money in the
    // ledger that payment-level reporting reads as unclassified.
    expect(row.contribution_payment_id).toBe(row.payment_id);
  });

  it('sends the PayBill fallback SMS once for a cancelled contribution prompt', async () => {
    await seedStale(groupId, 'contrib_cancelled', '1032', {
      purpose: 'contribution',
      phone: memberPhone,
      accountReference: 'KY12345',
    });
    await seedStale(groupId, 'contrib_processing', '4999', { purpose: 'contribution', phone: memberPhone });

    await runReconciliation(groupId, null);
    expect(notifyMember).toHaveBeenCalledTimes(1);
    const [arg] = notifyMember.mock.calls[0] as [{ phone: string; body: string; referenceType: string }];
    expect(arg.referenceType).toBe('stk_fallback');
    expect(arg.phone).toBe(memberPhone);
    expect(arg.body).toContain('was cancelled');
    expect(arg.body).toContain('Account KY12345');

    // A second sweep re-queries only the still-pending one; no repeat SMS.
    await runReconciliation(groupId, null);
    expect(notifyMember).toHaveBeenCalledTimes(1);
  });

  it('leaves a row a late callback settled mid-sweep alone, with no second SMS', async () => {
    let checkout = '';
    checkout = await seedStale(groupId, 'raced', '1032', {
      purpose: 'contribution',
      phone: memberPhone,
      // The live failure callback lands after the sweep's scan, before its lock.
      before: async () => {
        await rawQuery(`UPDATE mpesa_stk_requests SET status='failed' WHERE checkout_request_id=$1`, [checkout]);
        await rawQuery(`UPDATE payments SET status='failed' WHERE mpesa_checkout_request_id=$1`, [checkout]);
      },
    });

    const res = await runReconciliation(groupId, null);
    expect(res.resolvedCount).toBe(0);
    expect(await statuses(checkout)).toEqual({ stk: 'failed', payment: 'failed' });
    expect(notifyMember).not.toHaveBeenCalled();
  });
});
