/**
 * Bulk SMS response alignment (SMS_MESSAGING_AUDIT_2026-08.md H6), against
 * real Postgres.
 *
 * sendBulkCampaign indexed result.responses[i] against logIds[i]/eligible[i]
 * by raw array position. A clientSmsId was sent to the provider per item
 * specifically so the response could be matched back unambiguously, but
 * nothing ever read it back — so a chunk returning responses out of order,
 * or fewer responses than items, silently wrote the wrong status onto the
 * wrong recipient's log row. This file proves the fix by mocking the
 * provider to return responses reordered and with a gap — the only way to
 * actually exercise the bug, since a real provider call always happens to
 * come back in order in the happy path a mocked-in-order test would give.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { BulkSmsResult } from '@/lib/services/textsms.service';

const mockSendBulkSmsChunked = jest.fn<Promise<BulkSmsResult>, [unknown]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: (...args: unknown[]) => mockSendBulkSmsChunked(args[0]),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

async function logsFor(groupId: string): Promise<{ recipient_phone: string; status: string; provider_msg_id: string | null; billing_state: string }[]> {
  return rawQuery(
    `SELECT recipient_phone, status, provider_msg_id, billing_state
     FROM sms_usage_logs WHERE group_id = $1 ORDER BY recipient_phone`,
    [groupId],
  );
}

describe('bulk SMS response alignment (H6)', () => {
  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
  });

  it('matches each response to its own recipient even when the provider returns them out of order', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const phones = ['254700000001', '254700000002', '254700000003'];

    // Reversed order relative to submission (clientSmsId 3, 1, 2), each
    // response carrying its own clientSmsId and a distinctive messageId so a
    // wrong match is unmistakable.
    mockSendBulkSmsChunked.mockResolvedValue({
      responses: [
        { responseCode: 200, responseDescription: 'Success', mobile: phones[2], messageId: 'msg-for-3', networkId: '1', success: true, clientSmsId: 3 },
        { responseCode: 1003, responseDescription: 'Invalid Mobile Number', mobile: phones[0], messageId: '', networkId: '', success: false, clientSmsId: 1 },
        { responseCode: 200, responseDescription: 'Success', mobile: phones[1], messageId: 'msg-for-2', networkId: '1', success: true, clientSmsId: 2 },
      ],
      sent: 2, failed: 1,
    });

    await smsService.sendBulkCampaign({ groupId, phones, message: 'test', sentBy: 'test' });

    const logs = await logsFor(groupId);
    const byPhone = new Map(logs.map((l) => [l.recipient_phone, l]));

    // Recipient 1's own response was a REJECTION (clientSmsId 1) — before the
    // fix, positional indexing would have given it responses[0], which in
    // this scrambled array actually belongs to recipient 3.
    expect(byPhone.get(phones[0])!.status).toBe('failed');
    expect(byPhone.get(phones[0])!.billing_state).toBe('released');

    expect(byPhone.get(phones[1])!.status).toBe('sent');
    expect(byPhone.get(phones[1])!.provider_msg_id).toBe('msg-for-2');
    expect(byPhone.get(phones[1])!.billing_state).toBe('consumed');

    expect(byPhone.get(phones[2])!.status).toBe('sent');
    expect(byPhone.get(phones[2])!.provider_msg_id).toBe('msg-for-3');
    expect(byPhone.get(phones[2])!.billing_state).toBe('consumed');
  });

  it('a genuinely dropped response only affects its own recipient, not the ones after it', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const phones = ['254700000004', '254700000005', '254700000006'];

    // clientSmsId 2 (the middle recipient) never comes back at all — the
    // exact "chunk returned fewer responses than sent" scenario H6 describes.
    // Before the fix, this would have shifted recipient 3's response onto
    // recipient 2's log row via positional indexing.
    mockSendBulkSmsChunked.mockResolvedValue({
      responses: [
        { responseCode: 200, responseDescription: 'Success', mobile: phones[0], messageId: 'msg-1', networkId: '1', success: true, clientSmsId: 1 },
        { responseCode: 200, responseDescription: 'Success', mobile: phones[2], messageId: 'msg-3', networkId: '1', success: true, clientSmsId: 3 },
      ],
      sent: 2, failed: 0,
    });

    await smsService.sendBulkCampaign({ groupId, phones, message: 'test', sentBy: 'test' });

    const logs = await logsFor(groupId);
    const byPhone = new Map(logs.map((l) => [l.recipient_phone, l]));

    expect(byPhone.get(phones[0])!.status).toBe('sent');
    expect(byPhone.get(phones[0])!.provider_msg_id).toBe('msg-1');

    // Never answered — status column is untouched (stays the insert default),
    // but the reservation is still released so the group isn't charged for a
    // message that was never confirmed sent.
    expect(byPhone.get(phones[1])!.status).toBe('queued');
    expect(byPhone.get(phones[1])!.billing_state).toBe('released');

    // Recipient 3's own response, correctly attributed — not recipient 2's
    // absence shifted onto it.
    expect(byPhone.get(phones[2])!.status).toBe('sent');
    expect(byPhone.get(phones[2])!.provider_msg_id).toBe('msg-3');
  });

  it('falls back to positional matching, unchanged, when the provider omits clientSmsId entirely', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const phones = ['254700000007', '254700000008'];

    // No clientSmsId on any response — canUseClientId is false, so
    // alignBulkResponses falls back to the exact pre-H6 positional behaviour.
    mockSendBulkSmsChunked.mockResolvedValue({
      responses: [
        { responseCode: 200, responseDescription: 'Success', mobile: phones[0], messageId: 'msg-a', networkId: '1', success: true },
        { responseCode: 200, responseDescription: 'Success', mobile: phones[1], messageId: 'msg-b', networkId: '1', success: true },
      ],
      sent: 2, failed: 0,
    });

    await smsService.sendBulkCampaign({ groupId, phones, message: 'test', sentBy: 'test' });

    const logs = await logsFor(groupId);
    const byPhone = new Map(logs.map((l) => [l.recipient_phone, l]));
    expect(byPhone.get(phones[0])!.provider_msg_id).toBe('msg-a');
    expect(byPhone.get(phones[1])!.provider_msg_id).toBe('msg-b');
  });
});
