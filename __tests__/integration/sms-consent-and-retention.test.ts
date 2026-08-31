/**
 * Consent record and message retention (SMS-AUDIT-v3 G20 / V3-04,
 * INV-23/24/26, pathway T2-5).
 *
 * Opt-outs lived in a text[] that could not say WHEN, HOW or BY WHOM — the
 * three things a data subject or a regulator asks for under Kenya's DPA 2019 —
 * and message bodies were kept forever with no retention of any kind.
 */
import { smsService } from '@/lib/services/sms.service';
import { redactExpiredMessageBodies } from '@/lib/services/messaging-billing';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const PHONE = '254722123456';

describe('consent record (G20)', () => {
  it('records when, how and by whom — not just that it happened', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');

    await smsService.optOut(groupId, PHONE, {
      source: 'officer', actorId: officerId, note: 'asked at the monthly meeting',
    });

    const [row] = await rawQuery<{ source: string; actor_id: string; note: string; opted_out_at: string }>(
      `SELECT source, actor_id, note, opted_out_at FROM sms_opt_outs WHERE group_id=$1`, [groupId],
    );
    expect(row.source).toBe('officer');
    expect(row.actor_id).toBe(officerId);
    expect(row.note).toBe('asked at the monthly meeting');
    expect(row.opted_out_at).toBeTruthy();
  });

  it('suppresses sends for an opted-out number', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await smsService.optOut(groupId, PHONE, { source: 'officer' });
    expect(await smsService.isOptedOut(groupId, PHONE)).toBe(true);
  });

  it('normalises on the way in, so format cannot defeat suppression', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await smsService.optOut(groupId, '0722123456', { source: 'member' });
    // Same human, three spellings.
    expect(await smsService.isOptedOut(groupId, '+254722123456')).toBe(true);
    expect(await smsService.isOptedOut(groupId, '254722123456')).toBe(true);
    expect(await smsService.isOptedOut(groupId, '0722 123 456')).toBe(true);
  });

  it('keeps the FIRST timestamp when opting out twice', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await smsService.optOut(groupId, PHONE, { source: 'member' });
    const [first] = await rawQuery<{ opted_out_at: string }>(
      `SELECT opted_out_at FROM sms_opt_outs WHERE group_id=$1`, [groupId]);

    await smsService.optOut(groupId, PHONE, { source: 'officer' });
    const rows = await rawQuery<{ opted_out_at: string; source: string }>(
      `SELECT opted_out_at, source FROM sms_opt_outs WHERE group_id=$1`, [groupId]);

    // Consent was withdrawn once; the second request must not rewrite when.
    expect(rows).toHaveLength(1);
    expect(rows[0].opted_out_at).toEqual(first.opted_out_at);
    expect(rows[0].source).toBe('member');
  });

  it('opting back in removes the row, so a later opt-out is freshly dated', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await smsService.optOut(groupId, PHONE, { source: 'member' });
    await smsService.optIn(groupId, PHONE);

    expect(await smsService.isOptedOut(groupId, PHONE)).toBe(false);
    expect(await rawQuery(`SELECT 1 FROM sms_opt_outs WHERE group_id=$1`, [groupId])).toHaveLength(0);
  });

  it('is scoped per group: one chama opt-out is not another', async () => {
    await resetDatabase();
    const a = await createTestGroup('treasurer');
    const b = await createTestGroup('treasurer');
    await smsService.optOut(a.groupId, PHONE, { source: 'member' });

    expect(await smsService.isOptedOut(a.groupId, PHONE)).toBe(true);
    expect(await smsService.isOptedOut(b.groupId, PHONE)).toBe(false);
  });
});

describe('message retention (V3-04)', () => {
  it('redacts bodies past the window but KEEPS the billing row', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');

    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider, payer_type, created_at)
       VALUES ($1,$2,'private message',1,'sent','textsms','group', NOW() - INTERVAL '13 months')`,
      [groupId, PHONE],
    );

    const r = await redactExpiredMessageBodies();
    expect(r.redacted).toBe(1);

    const [row] = await rawQuery<{ message_text: string; credits_deducted: string; recipient_phone: string }>(
      `SELECT message_text, credits_deducted, recipient_phone FROM sms_usage_logs WHERE group_id=$1`, [groupId]);

    // Content gone, billing evidence intact — deleting the row would destroy
    // reconciliation and make a data-subject request unanswerable.
    expect(row.message_text).toBe('[redacted: retention]');
    expect(Number(row.credits_deducted)).toBe(1);
    expect(row.recipient_phone).toBe(PHONE);
  });

  it('leaves messages inside the window alone', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider, payer_type, created_at)
       VALUES ($1,$2,'recent message',1,'sent','textsms','group', NOW() - INTERVAL '2 months')`,
      [groupId, PHONE],
    );

    expect((await redactExpiredMessageBodies()).redacted).toBe(0);
  });

  it('is idempotent — a second run redacts nothing further', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider, payer_type, created_at)
       VALUES ($1,$2,'old',1,'sent','textsms','group', NOW() - INTERVAL '13 months')`,
      [groupId, PHONE],
    );
    expect((await redactExpiredMessageBodies()).redacted).toBe(1);
    expect((await redactExpiredMessageBodies()).redacted).toBe(0);
  });
});
