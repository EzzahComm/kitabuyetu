/**
 * notifyMember's never-throws contract (Phase 2a).
 *
 * Three callers depend on it and none of them guard: reminder.service.ts calls
 * it between a claim and a settle in SEPARATE transactions, so an escaping
 * error strands the claim row as 'pending' with attempts never incremented.
 *
 * The contract was aspirational before Phase 2a — sendText() sat outside any
 * try/catch, so a throwing WhatsApp client escaped. Since a credit reservation
 * now sits downstream of that call, these tests pin the repaired behaviour by
 * making each dependency throw in turn.
 */
import { notifyMember } from '@/lib/services/notifications.service';

jest.mock('@/lib/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [{ id: 'log-1' }], rowCount: 1 }) },
  withAdminDb: jest.fn(async (fn: (db: unknown) => unknown) =>
    fn({ query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
}));
jest.mock('@/lib/integrations/whatsapp-client', () => ({
  isWhatsAppConfigured: jest.fn(() => false),
  sendText: jest.fn(),
}));
jest.mock('@/lib/services/textsms.service', () => ({ sendSingleSms: jest.fn() }));
jest.mock('@/lib/jobs', () => ({ enqueueJob: jest.fn().mockResolvedValue('job-1') }));

import { pool } from '@/lib/db';
import { isWhatsAppConfigured, sendText } from '@/lib/integrations/whatsapp-client';
import { sendSingleSms } from '@/lib/services/textsms.service';

const mockPoolQuery  = pool.query as unknown as jest.Mock;
const mockWaEnabled  = isWhatsAppConfigured as unknown as jest.Mock;
const mockSendText   = sendText as unknown as jest.Mock;
const mockSendSms    = sendSingleSms as unknown as jest.Mock;

const RCPT = {
  groupId:  '11111111-1111-1111-1111-111111111111',
  memberId: '22222222-2222-2222-2222-222222222222',
  phone:    '0717548646',
  body:     'hello',
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: every query answers with a log-insert-shaped row, EXCEPT the two
  // lookups whose semantics are "did any row come back". A blanket resolve
  // makes sms_opt_outs read as "this member opted out" and feature_flags read
  // as "dispatch is halted", so the send under test is suppressed and the
  // assertion fails for a reason unrelated to what it is testing.
  mockPoolQuery.mockImplementation((sql: string) =>
    /sms_opt_outs|feature_flags/.test(String(sql))
      ? Promise.resolve({ rows: [], rowCount: 0 })
      : Promise.resolve({ rows: [{ id: 'log-1' }], rowCount: 1 }),
  );
  mockWaEnabled.mockReturnValue(false);
  mockSendSms.mockResolvedValue({
    success: true, messageId: 'm1', networkId: '1',
    responseCode: 200, responseDescription: 'Success', mobile: '254717548646',
  });
});

describe('notifyMember never throws', () => {
  it('returns an outcome when the SMS provider throws', async () => {
    mockSendSms.mockRejectedValue(new Error('provider exploded'));

    const out = await notifyMember(RCPT);

    expect(out.status).toBe('failed');
    expect(out.detail).toMatch(/provider exploded/);
  });

  it('returns an outcome when the WhatsApp client throws', async () => {
    // The specific hole Phase 2a repaired: sendText() was previously
    // unguarded, so this escaped to callers that do not catch.
    mockWaEnabled.mockReturnValue(true);
    mockSendText.mockRejectedValue(new Error('meta down'));

    const out = await notifyMember(RCPT);

    // Falls back to SMS rather than aborting the send.
    expect(out.channel).toBe('sms');
    expect(out.status).toBe('sent');
  });

  it('returns an outcome when every database write throws', async () => {
    mockPoolQuery.mockRejectedValue(new Error('db gone'));

    const out = await notifyMember(RCPT);

    expect(out).toHaveProperty('status');
    expect(['failed', 'suppressed', 'sent']).toContain(out.status);
  });

  it('suppresses rather than fails when credits are exhausted', async () => {
    // reminder_dispatch_log treats 'failed' as retryable, so reporting an
    // unaffordable send as failed would re-attempt it every cron tick forever.
    // Terminal suppression is what stops that.
    mockPoolQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('reserve_sms_credits')) {
        const err = Object.assign(new Error('insufficient SMS credits'), { code: '22003' });
        return Promise.reject(err);
      }
      // The kill-switch lookup must resolve to "no row" — i.e. no operator
      // halt. The catch-all below returns a row shaped like a log insert, and
      // a feature_flags row whose `enabled` is undefined reads as DISABLED,
      // which would halt dispatch and make this assert on the wrong reason.
      if (String(sql).includes('feature_flags')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // Same shape of problem for consent: sms_opt_outs is now a real table
      // and the check is "did any row come back", so the catch-all would read
      // as "this member opted out" and suppress the send being tested.
      if (String(sql).includes('sms_opt_outs')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [{ id: 'log-1' }], rowCount: 1 });
    });

    const out = await notifyMember({ ...RCPT, billingMode: 'billed' });

    expect(out.status).toBe('suppressed');
    expect(out.detail).toBe('insufficient_credits');
  });

  it('does not reserve anything when WhatsApp delivers', async () => {
    mockWaEnabled.mockReturnValue(true);
    mockSendText.mockResolvedValue({ status: 'sent', waMessageId: 'wa-1' });

    const out = await notifyMember({ ...RCPT, billingMode: 'billed' });

    expect(out.channel).toBe('whatsapp');
    const reserved = mockPoolQuery.mock.calls.some((c) => String(c[0]).includes('reserve_sms_credits'));
    // A WhatsApp-delivered message consumes no SMS credit — this is why the
    // reservation lives in the SMS fallback, not at the top of the function.
    expect(reserved).toBe(false);
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
