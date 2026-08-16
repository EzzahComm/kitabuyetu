/**
 * retryFailures() must BILL for what it delivers, against real Postgres.
 *
 * Found in production 2026-08-16 while sending real loan notifications. The
 * first attempt reserves credits and RELEASES them when the provider rejects
 * (billing_state='released', credits_deducted=0) — correct so far. Nothing
 * then re-reserved on retry, so a message that failed once and succeeded on
 * retry was delivered with credits_deducted = 0. Free SMS, for every tenant,
 * silently. Eight real messages went out that way before it was noticed.
 *
 * The ordering matters as much as the billing. The reservation has to happen
 * BEFORE the provider call: once the provider accepts, we cannot decline to
 * send, so discovering an empty balance at that point would leave us having
 * delivered something unbilled all over again — the very bug being fixed.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const mockSendSingleSms = jest.fn();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: (...args: unknown[]) => mockSendSingleSms(args[0]),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

/** A group with purchased credits and no bundled allowance, so every
 *  assertion below reads off sms_credits alone. */
async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1,$2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `UPDATE subscriptions SET sms_allowance_included = 0 WHERE group_id = $1`, [groupId],
  );
  await rawQuery(
    `UPDATE billing_accounts SET sms_allowance_used = 0, sms_allowance_reserved = 0
     WHERE group_id = $1`, [groupId],
  );
}

/** Queue one message, letting the provider reject it, so a retryable
 *  sms_failures row exists exactly as production produced it.
 *
 *  The first failure schedules an exponential backoff, so next_retry_at lands
 *  minutes in the future and retryFailures() would correctly skip the row.
 *  Backdate it — the point of these tests is the BILLING behaviour once a
 *  retry runs, not the backoff schedule (which sms-dispatch-exception covers).
 */
async function queueOneFailedSend(groupId: string, userId: string) {
  mockSendSingleSms.mockResolvedValueOnce({
    success: false, responseDescription: 'Request failed with status code 401',
  });
  await smsService.send(
    { groupId, userId, role: 'chairperson' } as never,
    '254700000001', 'first attempt', 'loan', null,
  );
  await rawQuery(
    `UPDATE sms_failures SET next_retry_at = NOW() - INTERVAL '1 minute'
     WHERE group_id = $1 AND NOT resolved`,
    [groupId],
  );
}

async function billingOf(groupId: string) {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return Number(row.sms_credits);
}

async function logOf(groupId: string) {
  const [row] = await rawQuery<{
    status: string; billing_state: string; credits_deducted: string;
  }>(
    `SELECT status, billing_state, credits_deducted FROM sms_usage_logs
     WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`, [groupId],
  );
  return row;
}

describe('retryFailures billing', () => {
  let groupId: string, officerId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    mockSendSingleSms.mockReset();
  });

  it('charges for a message the retry successfully delivers', async () => {
    await provisionBilling(groupId, 10);
    await queueOneFailedSend(groupId, officerId);

    // Released by the failed first attempt — nothing charged yet.
    expect(await billingOf(groupId)).toBe(10);
    expect((await logOf(groupId)).credits_deducted).toBe('0.0000');

    mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });
    const result = await smsService.retryFailures();

    expect(result.resolved).toBe(1);
    const log = await logOf(groupId);
    expect(log.status).toBe('sent');
    // The regression: this used to stay 'released' / 0.0000 forever.
    expect(log.billing_state).toBe('consumed');
    expect(Number(log.credits_deducted)).toBeGreaterThan(0);
    expect(await billingOf(groupId)).toBe(9);
  });

  it('does not charge when the retry fails again', async () => {
    await provisionBilling(groupId, 10);
    await queueOneFailedSend(groupId, officerId);

    mockSendSingleSms.mockResolvedValueOnce({
      success: false, responseDescription: 'still failing',
    });
    await smsService.retryFailures();

    // Reserved then released — the balance must come back untouched.
    expect(await billingOf(groupId)).toBe(10);
    expect((await logOf(groupId)).billing_state).toBe('released');
  });

  it('releases the reservation when the provider throws', async () => {
    await provisionBilling(groupId, 10);
    await queueOneFailedSend(groupId, officerId);

    mockSendSingleSms.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await smsService.retryFailures();

    // A throw must not strand the earmark until the stale sweeper reclaims it.
    expect(await billingOf(groupId)).toBe(10);
    expect((await logOf(groupId)).billing_state).toBe('released');
  });

  it('refuses to send when the payer cannot afford it', async () => {
    // Fund it first: the ORIGINAL send has to reserve successfully for a
    // failure row to exist at all. Draining the balance afterwards is what
    // reproduces the real case — credits ran out between the first attempt
    // and the retry.
    await provisionBilling(groupId, 10);
    await queueOneFailedSend(groupId, officerId);
    await rawQuery(`UPDATE billing_accounts SET sms_credits = 0 WHERE group_id = $1`, [groupId]);

    mockSendSingleSms.mockClear();
    const result = await smsService.retryFailures();

    // Reservation is checked BEFORE dispatch, so the provider is never called
    // for a message that cannot be paid for.
    expect(mockSendSingleSms).not.toHaveBeenCalled();
    expect(result.resolved).toBe(0);
    expect(await billingOf(groupId)).toBe(0);
  });
});
