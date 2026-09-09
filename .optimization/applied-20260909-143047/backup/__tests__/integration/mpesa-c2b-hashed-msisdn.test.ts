/**
 * C2B PayBill confirmations must survive a HASHED MSISDN.
 *
 * Written after finding, in live production data, that every direct PayBill
 * payment had been failing to record since at least 2026-05-28.
 * `handleC2BConfirmation` called `normalizePhone(body.MSISDN)` on its FIRST
 * line, and Safaricom sends a hashed MSISDN (64-char SHA-256, not a number)
 * on C2B confirmations depending on shortcode configuration. normalizePhone
 * throws on that, so the handler died before the idempotency check, before
 * account-number routing, and before the `mpesa_unrouted` insert that exists
 * precisely to catch payments it cannot route.
 *
 * The damage was invisible from the outside: the callback route always ACKs
 * 200 to Safaricom, and the DLQ replay job re-ran the same doomed handler
 * every tick, recording the same error forever. 16 callbacks were affected;
 * 11 were harmless duplicates of an STK payment that the STK path had
 * already credited (STK callbacks carry a real phone), but **5 were direct
 * PayBill payments with no STK counterpart — KES 15,631 received by
 * Safaricom and recorded nowhere at all**, not even in the unrouted queue.
 *
 * The payer phone is incidental to this path and always was: the handler's
 * own comment states the member is identified by the ACCOUNT NUMBER, never
 * by the paying phone, because third parties may pay. So the rule this file
 * pins is: an unusable MSISDN degrades the RECORD, it never rejects the
 * MONEY.
 */
import { handleC2BConfirmation, type C2BCallbackBody } from '@/lib/services/mpesa-c2b.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/redis', () => ({
  cacheMpesaStatus: jest.fn().mockResolvedValue(undefined),
  acquireStkLock:   jest.fn().mockResolvedValue(true),
  releaseStkLock:   jest.fn().mockResolvedValue(undefined),
}));

/** A real Safaricom-style hashed MSISDN: 64 hex chars, not a phone number. */
const HASHED_MSISDN = '1bc5cfe71c4ed76d6881e05f1e396f82e91b796046c8df5051a4b8945c7d0d2a';

function c2bBody(receipt: string, billRef: string, amount: number, msisdn: string): C2BCallbackBody {
  return {
    TransactionType: 'Pay Bill',
    TransID:         receipt,
    TransTime:       '20260815120000',
    TransAmount:     amount.toFixed(2),
    BusinessShortCode: '4137755',
    BillRefNumber:   billRef,
    MSISDN:          msisdn,
    FirstName:       'TEST',
  } as C2BCallbackBody;
}

describe('C2B confirmation with a hashed MSISDN', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('does not throw, and files an unroutable payment to mpesa_unrouted instead of discarding it', async () => {
    // An account reference that matches no membership — the case that used to
    // vanish entirely. Before the fix this threw on line 1 and never reached
    // the unrouted insert; production's mpesa_unrouted table was empty (0
    // rows) while 5 real payments had gone missing.
    const receipt = 'TESTHASH01';

    await expect(
      handleC2BConfirmation(c2bBody(receipt, 'NOSUCHACCT', 250, HASHED_MSISDN), '196.201.214.200', { skipIpCheck: true }),
    ).resolves.not.toThrow();

    const rows = await rawQuery<{ receipt: string; amount: string; phone: string; reason: string }>(
      `SELECT receipt, amount, phone, reason FROM mpesa_unrouted WHERE receipt = $1`,
      [receipt],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(250);
    // The 64-char hash cannot go in a varchar(20) NOT NULL column, so the
    // sentinel stands in for "we genuinely do not know the payer".
    expect(rows[0].phone).toBe('unknown');
  });

  it('credits a payment whose account reference DOES resolve, despite the hashed MSISDN', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');

    const [membership] = await rawQuery<{ membership_no: string }>(
      `SELECT membership_no FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, officerId],
    );
    expect(membership.membership_no).toBeTruthy();

    const receipt = 'TESTHASH02';
    await expect(
      handleC2BConfirmation(
        c2bBody(receipt, membership.membership_no, 500, HASHED_MSISDN),
        '196.201.214.200',
        { skipIpCheck: true },
      ),
    ).resolves.not.toThrow();

    // The money is recorded against the right group — the whole point.
    const tx = await rawQuery<{ group_id: string; amount: string; phone_number: string }>(
      `SELECT group_id, amount, phone_number FROM mpesa_transactions WHERE mpesa_receipt_number = $1`,
      [receipt],
    );
    expect(tx).toHaveLength(1);
    expect(tx[0].group_id).toBe(groupId);
    expect(Number(tx[0].amount)).toBe(500);
  });

  it(
    'never files to unrouted when this exact receipt already has a completed payment ' +
    '(found 2026-08-26: a race between the STK success callback and a separate C2B ' +
    'notification for the same transaction filed 7 real payments to mpesa_unrouted as ' +
    '"unroutable" even though every one of them had already activated correctly via STK — ' +
    'this asserts the end-to-end outcome; the exact in-transaction race window that produced ' +
    'the duplicates is not reproducible by sequential calls, so this covers the invariant, ' +
    'not the specific line that closes it)',
    async () => {
      const { groupId } = await createTestGroup('chairperson');
      const receipt = 'TESTHASH04';

      // Simulates the STK callback having already committed its payments row
      // — 'SUBSCRIPT' is a real STK-only account reference (plan-purchase.tsx's
      // PRODUCT_REFERENCE), never a group-resolvable one, so this exact
      // situation is what actually happened in production.
      await rawQuery(
        `INSERT INTO payments
           (group_id, amount, payment_method, status, mpesa_receipt_number, mpesa_phone, channel)
         VALUES ($1, 150.00, 'mpesa', 'completed', $2, '254700000000', 'stk')`,
        [groupId, receipt],
      );

      await expect(
        handleC2BConfirmation(c2bBody(receipt, 'SUBSCRIPT', 150, HASHED_MSISDN), '196.201.214.200', { skipIpCheck: true }),
      ).resolves.not.toThrow();

      const unrouted = await rawQuery(`SELECT id FROM mpesa_unrouted WHERE receipt = $1`, [receipt]);
      expect(unrouted).toHaveLength(0);

      // The original STK-recorded payment must be untouched — this path only
      // ever recognises the duplicate and logs it, never mutates the payment.
      const payment = await rawQuery<{ status: string }>(
        `SELECT status FROM payments WHERE mpesa_receipt_number = $1`, [receipt],
      );
      expect(payment[0].status).toBe('completed');
    },
  );

  it('still records the real payer phone when Safaricom sends an unhashed MSISDN', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');
    const [membership] = await rawQuery<{ membership_no: string }>(
      `SELECT membership_no FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [groupId, officerId],
    );

    const receipt = 'TESTHASH03';
    await handleC2BConfirmation(
      c2bBody(receipt, membership.membership_no, 300, '254712345678'),
      '196.201.214.200',
      { skipIpCheck: true },
    );

    const tx = await rawQuery<{ phone_number: string }>(
      `SELECT phone_number FROM mpesa_transactions WHERE mpesa_receipt_number = $1`,
      [receipt],
    );
    expect(tx).toHaveLength(1);
    // Not the sentinel — a usable MSISDN must still be normalised and kept.
    expect(tx[0].phone_number).toBe('254712345678');
  });
});
