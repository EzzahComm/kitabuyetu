/**
 * retryFailures() must not spend a message's max_retries budget while the
 * SMS provider's circuit is open (SMS-AUDIT-v3 T3-3 closure test).
 *
 * Before this, an outage meant every due sms_failures row burned a real
 * provider call — and its backoff — on an outcome that was never in doubt:
 * the queue did maximum work at maximum latency for guaranteed-zero
 * delivery (see lib/sms/circuit-breaker.ts's own header). Worse, each
 * attempt still counted against retry_count, so a long enough outage could
 * exhaust a message's retries and mark it permanently failed for a reason
 * that had nothing to do with that specific message.
 *
 * The circuit breaker itself is unit-tested in isolation
 * (__tests__/unit/sms/circuit-breaker.test.ts and provider.test.ts) — this
 * file proves the one integration point that matters: retryFailures()
 * actually consults it, against a real row in real Postgres.
 */
import { smsService } from '@/lib/services/sms.service';
import { recordFailure, resetCircuit, circuitState } from '@/lib/sms/circuit-breaker';
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

/** Same shape as sms-retry-rebills.test.ts's identical helper. */
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

async function failureRow(groupId: string) {
  const [row] = await rawQuery<{
    retry_count: number; resolved: boolean; next_retry_at: string | null;
  }>(
    `SELECT retry_count, resolved, next_retry_at FROM sms_failures
     WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [groupId],
  );
  return row;
}

async function billingOf(groupId: string) {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return Number(row.sms_credits);
}

describe('retryFailures + provider circuit breaker', () => {
  let groupId: string, officerId: string;

  beforeEach(async () => {
    await resetDatabase();
    resetCircuit();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    mockSendSingleSms.mockReset();
    await provisionBilling(groupId, 10);
    await queueOneFailedSend(groupId, officerId);
  });

  afterEach(() => resetCircuit());

  it('skips a due row without touching retry_count/resolved while the circuit is open', async () => {
    const before = await failureRow(groupId);
    expect(before.retry_count).toBe(0);
    expect(before.resolved).toBe(false);

    // Simulate an ongoing outage directly on the real breaker module — the
    // same singleton lib/sms/provider.ts's isProviderAvailable() reads.
    for (let i = 0; i < 5; i++) recordFailure('textsms');
    expect(circuitState('textsms').state).toBe('open');

    mockSendSingleSms.mockClear();
    const result = await smsService.retryFailures();

    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
    expect(result.resolved).toBe(0);
    // The whole point: no provider call was attempted at all.
    expect(mockSendSingleSms).not.toHaveBeenCalled();

    // Row is untouched — same eligibility as before this tick, no budget
    // spent, no backoff imposed for a fault that was never this message's.
    const after = await failureRow(groupId);
    expect(after.retry_count).toBe(0);
    expect(after.resolved).toBe(false);
    expect(after.next_retry_at).toBe(before.next_retry_at);

    // No credits were reserved-then-released either — skipping happens
    // before any billing work, not after.
    expect(await billingOf(groupId)).toBe(10);
  });

  it('resumes normal retry behaviour once the circuit closes again', async () => {
    for (let i = 0; i < 5; i++) recordFailure('textsms');
    mockSendSingleSms.mockClear();

    let result = await smsService.retryFailures();
    expect(result.skipped).toBe(1);
    expect(mockSendSingleSms).not.toHaveBeenCalled();

    // Recovery: a real operator action or a later successful probe would
    // close it in production — asserted directly here since that transition
    // itself is unit-tested in circuit-breaker.test.ts.
    resetCircuit();
    mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });

    result = await smsService.retryFailures();
    expect(result.skipped).toBe(0);
    expect(result.retried).toBe(1);
    expect(result.resolved).toBe(1);
    expect(mockSendSingleSms).toHaveBeenCalledTimes(1);

    const after = await failureRow(groupId);
    expect(after.resolved).toBe(true);
  });

  it('does not skip when a DIFFERENT provider is open — only the row\'s own provider gates it', async () => {
    for (let i = 0; i < 5; i++) recordFailure('some-other-provider');
    mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });

    const result = await smsService.retryFailures();
    expect(result.skipped).toBe(0);
    expect(result.resolved).toBe(1);
  });
});
