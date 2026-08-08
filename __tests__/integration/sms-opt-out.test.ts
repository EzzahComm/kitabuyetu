/**
 * Self-service SMS opt-out (SMS_MESSAGING_AUDIT_2026-08.md M5), against real
 * Postgres.
 *
 * smsService.optOut() and the opt-out check itself (fetchOptOuts in
 * sms.service.ts, isPhoneOptedOut in notifications.service.ts) already
 * existed and were already honoured by every send path — the actual finding
 * was that nothing ever CALLED optOut(), so a member had no way to get their
 * own phone into sms_group_settings.opt_out_phones. This file proves the
 * full loop: the new /api/v1/sms/preferences route -> smsService.optOut ->
 * a real send attempt is actually suppressed, and the new optIn() reverses it.
 */
import { GET, PUT } from '@/app/api/v1/sms/preferences/route';
import { smsService } from '@/lib/services/sms.service';
import { notifyMember } from '@/lib/services/notifications.service';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn().mockResolvedValue({
    responseCode: 200, responseDescription: 'Success',
    mobile: '254717548646', messageId: 'test-msg-1', networkId: '1', success: true,
  }),
  sendBulkSms: jest.fn().mockResolvedValue({ responses: [], sent: 0, failed: 0 }),
  sendBulkSmsChunked: jest.fn().mockResolvedValue({ responses: [], sent: 0, failed: 0 }),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

describe('SMS opt-out (M5)', () => {
  let groupId: string, officerId: string, phone: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('treasurer'));
    const [row] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id = $1`, [officerId]);
    phone = row.phone;
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('GET reports not opted out by default', async () => {
    const res = await GET(buildRequest('/api/v1/sms/preferences', {
      headers: authHeaders({ userId: officerId, groupId, role: 'treasurer' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.optedOut).toBe(false);
  });

  it('PUT {optedOut:true} opts the caller out, and GET reflects it', async () => {
    const putRes = await PUT(buildRequest('/api/v1/sms/preferences', {
      method: 'PUT',
      headers: authHeaders({ userId: officerId, groupId, role: 'treasurer' }),
      body: { optedOut: true },
    }));
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).data.optedOut).toBe(true);

    const getRes = await GET(buildRequest('/api/v1/sms/preferences', {
      headers: authHeaders({ userId: officerId, groupId, role: 'treasurer' }),
    }));
    expect((await getRes.json()).data.optedOut).toBe(true);

    // Directly against the underlying table — this is the actual gap the
    // audit found: before this route existed, nothing could ever populate it.
    const [row] = await rawQuery<{ opt_out_phones: string[] }>(
      `SELECT opt_out_phones FROM sms_group_settings WHERE group_id = $1`, [groupId],
    );
    expect(row.opt_out_phones).toContain(phone);
  });

  it('a real send attempt is suppressed for an opted-out member — nothing dispatched, nothing billed', async () => {
    const result = await notifyMember({
      groupId, memberId: officerId, phone,
      body: 'You have a payment due.', referenceType: 'loan_due',
    });

    // notifyMember's consent gate returns {channel:'none', status:'suppressed'}
    // — it runs before any channel is even attempted, so no SMS/WhatsApp leg
    // exists to report a per-channel outcome.
    expect(result.status).toBe('suppressed');
    expect(result.detail).toMatch(/opted out/);

    const [log] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id = $1 AND recipient_phone = $2`,
      [groupId, phone],
    );
    // suppressed before any log row / reservation — nothing to bill or send.
    expect(Number(log.n)).toBe(0);
  });

  it('PUT {optedOut:false} (optIn) reverses it, and a send is no longer suppressed', async () => {
    const putRes = await PUT(buildRequest('/api/v1/sms/preferences', {
      method: 'PUT',
      headers: authHeaders({ userId: officerId, groupId, role: 'treasurer' }),
      body: { optedOut: false },
    }));
    expect((await putRes.json()).data.optedOut).toBe(false);

    const isOptedOut = await smsService.isOptedOut(groupId, phone);
    expect(isOptedOut).toBe(false);

    const result = await notifyMember({
      groupId, memberId: officerId, phone,
      body: 'You have a payment due.', referenceType: 'loan_due',
    });
    expect(result.status).not.toBe('suppressed');
  });

  it('optIn is a safe no-op when the row or phone does not exist', async () => {
    const { groupId: freshGroupId } = await createTestGroup('treasurer');
    await expect(smsService.optIn(freshGroupId, '254700000001')).resolves.toBeUndefined();
  });

  it('opt-out is scoped per group, not global — a different group is unaffected', async () => {
    const { groupId: otherGroupId, officerId: otherOfficerId } = await createTestGroup('treasurer');
    const [row] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id = $1`, [otherOfficerId]);

    await PUT(buildRequest('/api/v1/sms/preferences', {
      method: 'PUT',
      headers: authHeaders({ userId: otherOfficerId, groupId: otherGroupId, role: 'treasurer' }),
      body: { optedOut: true },
    }));

    // The original group's officer, same test suite, is untouched by another
    // group's opt-out row.
    const stillIn = await smsService.isOptedOut(groupId, phone);
    expect(stillIn).toBe(false);
    const otherOptedOut = await smsService.isOptedOut(otherGroupId, row.phone);
    expect(otherOptedOut).toBe(true);
  });
});
