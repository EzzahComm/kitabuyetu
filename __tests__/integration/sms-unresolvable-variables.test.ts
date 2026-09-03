/**
 * Warn before sending a message with holes in it (spec §10).
 *
 * The composer's "Load Template" list is fed by
 * `WHERE (group_id=$1 OR group_id IS NULL) ... ORDER BY is_system DESC`, so
 * the PLATFORM's system templates are offered to every group and sort first.
 * Those are written for the automated paths, which pass their variables
 * explicitly — a bulk send supplies none of them. Loading `payment_received`
 * and sending it produces:
 *
 *   "KES received for Umoja (A/C BG102534). Receipt: . Balance: KES ."
 *
 * which is the same defect shape mpesa-spine.service.ts already refuses to
 * send. previewBulkSend now names those variables before the credits go.
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

describe('unresolvable variables are reported before sending', () => {
  let groupId: string, officerId: string, phone: string;
  let ctx: never;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    ctx = { groupId, userId: officerId, role: 'chairperson' } as never;

    const [m] = await rawQuery<{ phone: string }>(
      `SELECT m.phone FROM members m
         JOIN group_members gm ON gm.member_id = m.id
        WHERE gm.group_id = $1 AND gm.member_id = $2`,
      [groupId, officerId],
    );
    phone = m.phone;

    await rawQuery(
      `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 500)
       ON CONFLICT (group_id) DO UPDATE SET sms_credits = 500`, [groupId],
    );
  });

  it('names every variable a bulk send cannot fill in a system template', async () => {
    // Verbatim body of the live platform `payment_received` row.
    const preview = await smsService.previewBulkSend(ctx, {
      message: 'KES {{amount}} {{product}} received for {{group_name}} '
             + '(A/C {{membership_no}}). Receipt: {{receipt}}. Balance: KES {{balance}}.',
      phones: [phone],
    });

    expect(preview.unresolvableVariables.sort()).toEqual(
      ['amount', 'balance', 'product', 'receipt'].sort(),
    );
    // The two a bulk send DOES supply must not be flagged, or the warning
    // becomes noise an officer learns to dismiss.
    expect(preview.unresolvableVariables).not.toContain('group_name');
    expect(preview.unresolvableVariables).not.toContain('membership_no');
  });

  it('reports nothing for a message whose variables all resolve', async () => {
    const preview = await smsService.previewBulkSend(ctx, {
      message: 'Dear {{first_name}}, {{group_name}} meets on Friday.',
      phones:  [phone],
    });
    expect(preview.unresolvableVariables).toEqual([]);
  });

  it('reports nothing at all for a message with no variables', async () => {
    const preview = await smsService.previewBulkSend(ctx, {
      message: 'The meeting is on Friday at 4pm.',
      phones:  [phone],
    });
    expect(preview.unresolvableVariables).toEqual([]);
  });

  it('ignores a variable only SOME recipients lack', async () => {
    // A custom phone that belongs to no member: {{first_name}} cannot resolve
    // for them, and stripping it is the documented, intended behaviour. Only
    // variables that fail for EVERYONE indicate a broken message, and warning
    // about the rest would train an officer to click past this.
    const preview = await smsService.previewBulkSend(ctx, {
      message: 'Dear {{first_name}}, your receipt is {{receipt}}.',
      phones:  [phone, '254700009999'],
    });

    expect(preview.recipients).toBe(2);
    expect(preview.unresolvableVariables).not.toContain('first_name');
    // …while one that fails for both is still caught.
    expect(preview.unresolvableVariables).toContain('receipt');
  });
});
