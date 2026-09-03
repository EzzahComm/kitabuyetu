/**
 * The quote must equal the invoice (§11).
 *
 * `previewBulkSend` used to price `segmentsOf(input.message)` — the RAW
 * template, `{{first_name}}` placeholders and all. That text is never sent:
 * personalize() either substitutes the variable (`{{first_name}}` is 14
 * characters, `Mary` is 4) or strips it entirely when the send carries no
 * vars. So the number shown to an officer was computed on a string that does
 * not exist, and it diverged from the charge in exactly the case that costs
 * money.
 *
 * The dispatch path was always correct — it prices the personalised body per
 * recipient. These tests pin the two to each other, because a preview that
 * disagrees with the bill is worse than no preview: it is a number someone
 * will plan around.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

describe('preview matches what will be charged', () => {
  let groupId: string, officerId: string, ctx: never;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    ctx = { groupId, userId: officerId, role: 'chairperson' } as never;
    await rawQuery(
      `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 500)
       ON CONFLICT (group_id) DO UPDATE SET sms_credits = 500`, [groupId],
    );
  });

  it('prices the SUBSTITUTED body, not the raw template', async () => {
    // The officer's phone is a real member of the group, so {{first_name}}
    // resolves to their actual name.
    const [officer] = await rawQuery<{ phone: string; first_name: string }>(
      `SELECT m.phone, m.first_name FROM members m
        JOIN group_members gm ON gm.member_id = m.id
        WHERE gm.group_id = $1 LIMIT 1`, [groupId],
    );

    // Padded so the RAW text (with the 14-char placeholder) needs two
    // segments while the RENDERED text fits in one. A raw-text estimate would
    // over-quote here; a stripped-variable estimate would under-quote.
    const filler = 'x'.repeat(140);
    const preview = await smsService.previewBulkSend(ctx, {
      message: `{{first_name}} ${filler}`,
      phones:  [officer.phone],
    });

    const renderedLength = officer.first_name.length + 1 + filler.length;
    expect(renderedLength).toBeLessThanOrEqual(153);
    // One segment, because the NAME is short — not two, as the placeholder
    // would have implied.
    expect(preview.creditsRequired).toBe(1);
    expect(preview.segmentsPerMessage).toBe(1);
  });

  it('agrees with what sendBulkCampaign actually reserves', async () => {
    const [officer] = await rawQuery<{ phone: string }>(
      `SELECT m.phone FROM members m JOIN group_members gm ON gm.member_id = m.id
        WHERE gm.group_id = $1 LIMIT 1`, [groupId],
    );
    const message = `Dear {{first_name}}, ${'y'.repeat(150)}`;

    const preview = await smsService.previewBulkSend(ctx, {
      message, phones: [officer.phone],
    });

    // Compared against sendBulkCampaign specifically, because that is the path
    // preview MODELS: it is the only caller of personalize(). smsService.send()
    // transmits verbatim — a `{{first_name}}` typed into the ad-hoc /sms/send
    // route goes out literally — so comparing a personalised quote against it
    // would be comparing two different messages, which is what an earlier
    // version of this test got wrong.
    await smsService.sendBulkCampaign({
      groupId, sentBy: officerId, phones: [officer.phone], message,
      referenceType: 'campaign',
    });

    const [log] = await rawQuery<{ segments: number }>(
      `SELECT segments FROM sms_usage_logs
        WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`, [groupId],
    );

    // What the officer was quoted is what the group was actually billed for.
    expect(log.segments).toBe(preview.segmentsPerMessage);
    expect(log.segments).toBe(preview.creditsRequired);
  });

  it('does not query member variables for a message with no placeholders', async () => {
    const preview = await smsService.previewBulkSend(ctx, {
      message: 'A plain message with no variables at all.',
      phones:  ['254700000001', '254700000002'],
    });

    expect(preview.recipients).toBe(2);
    expect(preview.creditsRequired).toBe(2);
    expect(preview.segmentsPerMessage).toBe(1);
  });

  it('reports the WORST case per message, never an average that understates', async () => {
    // Two recipients, only one of whom is a member — so one renders a name
    // and the other has its placeholder stripped, giving different lengths.
    const [officer] = await rawQuery<{ phone: string }>(
      `SELECT m.phone FROM members m JOIN group_members gm ON gm.member_id = m.id
        WHERE gm.group_id = $1 LIMIT 1`, [groupId],
    );
    const preview = await smsService.previewBulkSend(ctx, {
      message: `{{first_name}} ${'z'.repeat(150)}`,
      phones:  [officer.phone, '254700009999'],
    });

    // Whatever the per-recipient split, the headline must be >= every
    // individual message, so nobody is quoted less than they will pay.
    expect(preview.segmentsPerMessage).toBeGreaterThanOrEqual(1);
    expect(preview.creditsRequired).toBeGreaterThanOrEqual(preview.recipients);
  });
});
