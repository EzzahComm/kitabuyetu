/**
 * Segment-based billing end to end (SMS-AUDIT-v3 G5 / INV-02, pathway T2-3).
 *
 * Billing charged 1 credit per RECIPIENT while the provider bills per SEGMENT,
 * so a long message cost the platform a multiple of what it billed. This pins
 * the whole chain: reservation, per-row credits_reserved/segments, and the
 * allowance arithmetic that migration 160 had to fix alongside it.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { SmsResponse } from '@/lib/services/textsms.service';

const mockSendSingleSms = jest.fn<Promise<SmsResponse>, [unknown]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: (...args: unknown[]) => mockSendSingleSms(args[0]),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

function accepted(mobile: string): SmsResponse {
  return { responseCode: 200, responseDescription: 'Success', mobile,
           messageId: 'm1', networkId: '1', success: true, clientSmsId: 1 };
}

async function provision(groupId: string, credits: number, allowance = 0): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1,$2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits,
       sms_allowance_used = 0, sms_allowance_reserved = 0`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1,'starter','active',0.90,0,$2) ON CONFLICT DO NOTHING`,
    [groupId, allowance],
  );
}

const PHONE = '254700000051';

describe('segment billing (G5)', () => {
  beforeEach(() => {
    mockSendSingleSms.mockReset();
    mockSendSingleSms.mockResolvedValue(accepted(PHONE));
  });

  it('charges one credit for a single-segment message', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provision(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    await smsService.send(ctx, PHONE, 'short message');

    const [row] = await rawQuery<{ segments: number; deducted: string }>(
      `SELECT segments, credits_deducted AS deducted FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(row.segments).toBe(1);
    expect(Number(row.deducted)).toBe(1);

    const [acct] = await rawQuery<{ c: string }>(
      `SELECT sms_credits AS c FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(Number(acct.c)).toBe(99);
  });

  it('charges three credits for a three-segment message', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provision(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    // 320 chars — the validator's own cap. Old billing charged 1; the provider
    // bills 3 (320 / 153).
    await smsService.send(ctx, PHONE, 'a'.repeat(320));

    const [row] = await rawQuery<{ segments: number; deducted: string }>(
      `SELECT segments, credits_deducted AS deducted FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(row.segments).toBe(3);
    expect(Number(row.deducted)).toBe(3);

    const [acct] = await rawQuery<{ c: string }>(
      `SELECT sms_credits AS c FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(Number(acct.c)).toBe(97);
  });

  it('charges the unicode penalty a plain-text count would miss', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provision(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    // 100 chars is one GSM-7 segment; one emoji forces UCS-2 and makes it two.
    await smsService.send(ctx, PHONE, 'a'.repeat(100) + '\u{1F600}');

    const [row] = await rawQuery<{ segments: number }>(
      `SELECT segments FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(row.segments).toBe(2);
  });

  it('refuses a send the balance cannot cover once segments are counted', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provision(groupId, 2);   // 2 credits, but the message costs 3
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    await expect(smsService.send(ctx, PHONE, 'a'.repeat(320))).rejects.toThrow();
    expect(mockSendSingleSms).not.toHaveBeenCalled();

    const [{ n }] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(n).toBe('0');
  });

  it('spends allowance by segment, and settles it without stranding any', async () => {
    // The migration-160 trap: settle derived the allowance decrement from a ROW
    // COUNT while reserve added a message count. With multi-segment rows those
    // differ, and the gap would sit on sms_allowance_reserved forever.
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provision(groupId, 0, 10);   // no paid credits, 10 allowance
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    await smsService.send(ctx, PHONE, 'a'.repeat(320));   // 3 segments

    const [acct] = await rawQuery<{ used: number; reserved: number }>(
      `SELECT sms_allowance_used AS used, sms_allowance_reserved AS reserved
         FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(acct.used).toBe(3);
    expect(acct.reserved).toBe(0);   // nothing stranded
  });
});
