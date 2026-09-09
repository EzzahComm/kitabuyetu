/**
 * End-to-end regression test for the STK Push -> payment -> contribution ->
 * journal-posting pipeline.
 *
 * Written after a real production incident: migration 091 (journal_lines.
 * entry_date) was committed to the repo and the accounting code was updated
 * to assume it existed, but the migration was never actually applied to
 * production — so every INSERT INTO journal_lines (which explicitly lists
 * entry_date) failed with "column entry_date of relation journal_lines does
 * not exist", rolling back the whole handleSTKCallback transaction. Payments
 * stayed 'pending' forever and no contribution was ever created, silently,
 * for over a week, because the STK callback route always acks 200 to
 * Safaricom regardless of what happens in the background `after()` task.
 *
 * This test can't catch "production's migration state is stale" (a fresh
 * test Postgres always has every migration applied), but it does guard
 * against the pipeline itself regressing — the second `it` proves a
 * replayed callback (Safaricom retries, or the mpesa_replay_callbacks DLQ
 * job re-processing an unprocessed row) never creates a duplicate
 * contribution or a second, unbalanced journal entry.
 */
import { handleSTKCallback, type StkCallbackBody } from '@/lib/services/mpesa-stk.service';
import { createTestGroup } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

// Redis is a real, external Upstash instance in every environment (no local
// emulator) — mocked the same way any other external dependency is elsewhere
// in this suite (email/SMS in organization-members.test.ts). Without this,
// handleSTKCallback's cache/lock calls try to reach the env's placeholder
// Upstash URL for real and fail with a TLS mismatch locally or ENOTFOUND in
// CI, masking the actual pipeline assertions below with an unrelated network
// error. acquireStkLock must resolve `true` (lock acquired) so the real
// allocation logic actually runs instead of being skipped as "already locked."
jest.mock('@/lib/redis', () => ({
  cacheMpesaStatus: jest.fn().mockResolvedValue(undefined),
  acquireStkLock: jest.fn().mockResolvedValue(true),
  releaseStkLock: jest.fn().mockResolvedValue(undefined),
}));

function stkSuccessBody(checkoutRequestId: string, receipt: string, amount: number, phone: string): StkCallbackBody {
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
            { Name: 'TransactionDate', Value: 20260729154000 },
            { Name: 'PhoneNumber', Value: phone },
          ],
        },
      },
    },
  };
}

describe('STK contribution allocation pipeline', () => {
  let groupId: string;
  let memberId: string;
  let phone: string;
  const checkoutRequestId = `ws_CO_test_${Date.now()}`;
  const receipt = `TEST${Date.now().toString().slice(-8)}`;
  const amount = 500;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId: memberId } = await createTestGroup('treasurer'));
    [{ phone }] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id=$1`, [memberId]);

    // Mirror initiateSTKPush's own writes (purpose='contribution', pending).
    await rawQuery(
      `INSERT INTO mpesa_stk_requests
         (group_id, checkout_request_id, merchant_request_id, phone, amount,
          account_reference, description, purpose, status)
       VALUES ($1,$2,$3,$4,$5,'CONTRIB','Contribution','contribution','pending')`,
      [groupId, checkoutRequestId, `merchant-${checkoutRequestId}`, phone, amount.toFixed(2)],
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

  it('allocates a successful STK callback into a completed payment, a contribution, and a balanced journal entry', async () => {
    const result = await handleSTKCallback(
      stkSuccessBody(checkoutRequestId, receipt, amount, phone),
      '0.0.0.0',
      { skipIpCheck: true },
    );
    expect(result.success).toBe(true);

    const [payment] = await rawQuery<{ status: string; allocation_status: string }>(
      `SELECT status, allocation_status FROM payments WHERE mpesa_checkout_request_id=$1`,
      [checkoutRequestId],
    );
    expect(payment.status).toBe('completed');
    expect(payment.allocation_status).toBe('allocated');

    const contributions = await rawQuery<{ id: string; amount: string; status: string }>(
      `SELECT id, amount, status FROM contributions WHERE mpesa_receipt_number=$1`,
      [receipt],
    );
    expect(contributions).toHaveLength(1);
    expect(contributions[0].status).toBe('completed');
    expect(parseFloat(contributions[0].amount)).toBeCloseTo(amount, 2);

    const journalLines = await rawQuery<{ entry_date: string; debit: string; credit: string }>(
      `SELECT jl.entry_date, jl.debit, jl.credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE je.reference = $1`,
      [receipt],
    );
    expect(journalLines.length).toBeGreaterThan(0);
    for (const line of journalLines) expect(line.entry_date).toBeTruthy();
    const totalDebit  = journalLines.reduce((s, l) => s + parseFloat(l.debit), 0);
    const totalCredit = journalLines.reduce((s, l) => s + parseFloat(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });

  it('is idempotent: replaying the same callback never creates a duplicate contribution or journal entry', async () => {
    const before = await rawQuery<{ count: string }>(
      `SELECT COUNT(*) FROM contributions WHERE mpesa_receipt_number=$1`, [receipt],
    );

    const replay = await handleSTKCallback(
      stkSuccessBody(checkoutRequestId, receipt, amount, phone),
      '0.0.0.0',
      { skipIpCheck: true },
    );
    expect(replay.success).toBe(true);

    const after = await rawQuery<{ count: string }>(
      `SELECT COUNT(*) FROM contributions WHERE mpesa_receipt_number=$1`, [receipt],
    );
    expect(after[0].count).toBe(before[0].count);

    const journalEntries = await rawQuery<{ count: string }>(
      `SELECT COUNT(*) FROM journal_entries WHERE reference=$1`, [receipt],
    );
    expect(journalEntries[0].count).toBe('1');
  });
});
