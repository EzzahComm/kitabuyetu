/**
 * The STK callback must survive a payload whose phone is unusable.
 *
 * PREVENTIVE, not a live incident — but not speculative either. The direct
 * PayBill path carried the identical construct
 * (`normalizePhone(<field from Safaricom>)` on the way in) and it silently
 * discarded every C2B payment for ~11 weeks, losing KES 15,631, because
 * Safaricom sends a HASHED MSISDN (64-char SHA-256) on this org's C2B
 * confirmations. Same provider, same shortcode, same shape — and STK is the
 * PRIMARY payment path, so if it ever fires here the blast radius is larger.
 * See PR #77 and lib/utils/phone.ts's safeNormalizePhone.
 *
 * The rule pinned here matches the C2B one: the payment is identified by the
 * STK request row and its AccountReference, never by the prompted phone
 * (which may legitimately belong to a third party), so an unusable phone must
 * degrade the RECORD and never reject the MONEY.
 */
import { handleSTKCallback, type StkCallbackBody } from '@/lib/services/mpesa-stk.service';
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

function stkSuccess(
  checkoutRequestId: string,
  receipt: string,
  amount: number,
  phone: string | null,
): StkCallbackBody {
  const items: { Name: string; Value: string | number }[] = [
    { Name: 'Amount', Value: amount },
    { Name: 'MpesaReceiptNumber', Value: receipt },
    { Name: 'TransactionDate', Value: 20260815120000 },
  ];
  // Omit the item entirely when phone is null — the "metadata present but
  // PhoneNumber missing" shape.
  if (phone !== null) items.push({ Name: 'PhoneNumber', Value: phone });

  return {
    Body: {
      stkCallback: {
        MerchantRequestID: `merchant-${checkoutRequestId}`,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: { Item: items },
      },
    },
  } as StkCallbackBody;
}

async function seedStkRequest(groupId: string, checkoutRequestId: string, accountRef: string, amount: number, phone: string) {
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status)
     VALUES ($1,$2,$3,$4,$5,$6,'Contribution','contribution','pending')`,
    [groupId, checkoutRequestId, `merchant-${checkoutRequestId}`, phone, amount.toFixed(2), accountRef],
  );
  await rawQuery(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_checkout_request_id, mpesa_phone, channel)
     VALUES ($1,$2,'mpesa','pending',$3,$4,'stk')`,
    [groupId, amount.toFixed(2), checkoutRequestId, phone],
  );
}

describe('STK callback with an unusable payer phone', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('still credits the payment when the MSISDN is hashed, routing by AccountReference', async () => {
    const { groupId, officerId } = await createTestGroup('treasurer');
    const [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [officerId]);
    const [{ membership_no }] = await rawQuery<{ membership_no: string }>(
      `SELECT membership_no FROM group_members WHERE group_id=$1 AND member_id=$2`,
      [groupId, officerId],
    );

    const checkoutRequestId = `ws_CO_hashed_${Date.now()}`;
    const receipt = `HSH${Date.now().toString().slice(-7)}`;
    await seedStkRequest(groupId, checkoutRequestId, membership_no, 500, phone);

    // Before the fix this threw on normalizePhone and never reached the
    // crediting transaction at all.
    const result = await handleSTKCallback(
      stkSuccess(checkoutRequestId, receipt, 500, HASHED_MSISDN),
      '0.0.0.0',
      { skipIpCheck: true },
    );
    expect(result.success).toBe(true);

    const [payment] = await rawQuery<{ status: string; allocation_status: string }>(
      `SELECT status, allocation_status FROM payments WHERE mpesa_checkout_request_id=$1`,
      [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');
    // AccountReference identified the member, so the money still landed.
    expect(payment.allocation_status).toBe('allocated');

    const contributions = await rawQuery<{ amount: string }>(
      `SELECT amount FROM contributions WHERE mpesa_receipt_number=$1`, [receipt],
    );
    expect(contributions).toHaveLength(1);
    expect(parseFloat(contributions[0].amount)).toBeCloseTo(500, 2);
  });

  it('does not crash when a success payload omits PhoneNumber entirely', async () => {
    const { groupId, officerId } = await createTestGroup('treasurer');
    const [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [officerId]);
    const [{ membership_no }] = await rawQuery<{ membership_no: string }>(
      `SELECT membership_no FROM group_members WHERE group_id=$1 AND member_id=$2`,
      [groupId, officerId],
    );

    const checkoutRequestId = `ws_CO_nophone_${Date.now()}`;
    const receipt = `NOP${Date.now().toString().slice(-7)}`;
    await seedStkRequest(groupId, checkoutRequestId, membership_no, 250, phone);

    const result = await handleSTKCallback(
      stkSuccess(checkoutRequestId, receipt, 250, null),
      '0.0.0.0',
      { skipIpCheck: true },
    );
    expect(result.success).toBe(true);

    const [payment] = await rawQuery<{ status: string }>(
      `SELECT status FROM payments WHERE mpesa_checkout_request_id=$1`, [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');
  });

  it('treats a ResultCode-0 callback with no receipt as a failure instead of writing a row keyed on undefined', async () => {
    const { groupId, officerId } = await createTestGroup('treasurer');
    const [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [officerId]);
    const checkoutRequestId = `ws_CO_noreceipt_${Date.now()}`;
    await seedStkRequest(groupId, checkoutRequestId, 'CONTRIB', 100, phone);

    const malformed = stkSuccess(checkoutRequestId, 'PLACEHOLDER', 100, phone);
    // Strip the receipt item — a success code with no MpesaReceiptNumber.
    malformed.Body.stkCallback.CallbackMetadata!.Item =
      malformed.Body.stkCallback.CallbackMetadata!.Item.filter((i) => i.Name !== 'MpesaReceiptNumber');

    const result = await handleSTKCallback(malformed, '0.0.0.0', { skipIpCheck: true });
    expect(result.success).toBe(false);

    // The pending payment must be left alone, not completed against a null receipt.
    const [payment] = await rawQuery<{ status: string }>(
      `SELECT status FROM payments WHERE mpesa_checkout_request_id=$1`, [checkoutRequestId],
    );
    expect(payment.status).toBe('pending');
  });
});
