/**
 * Per-recipient balance variables in a composed message (§6).
 *
 * Balances already resolved for the automatic payment receipt
 * (mpesa-spine.service.ts) but were unreachable from a message an officer
 * writes: resolveRecipientVars returned names, membership_no and group_name
 * and nothing else. These tests cover the three things that can go wrong with
 * adding money to that map — a wrong figure, a figure invented for somebody
 * who has none, and a quote that stops matching the bill.
 */
import { smsService, resolveRecipientVars } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(
    async (items: Array<{ mobile: string; clientSmsId?: number }>) => ({
      responses: items.map((it) => ({
        responseCode:        200,
        responseDescription: 'Success',
        mobile:              it.mobile,
        messageId:           `mock-msg-${it.clientSmsId ?? 0}`,
        networkId:           '1',
        success:             true,
        clientSmsId:         it.clientSmsId,
      })),
      sent:   items.length,
      failed: 0,
    }),
  ),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

describe('balance variables in a composed message', () => {
  let groupId: string, officerId: string, phone: string, membershipId: string;
  let ctx: never;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('treasurer'));
    ctx = { groupId, userId: officerId, role: 'treasurer' } as never;

    const [gm] = await rawQuery<{ id: string; phone: string }>(
      `SELECT gm.id, m.phone FROM group_members gm
         JOIN members m ON m.id = gm.member_id
        WHERE gm.group_id = $1 AND gm.member_id = $2`,
      [groupId, officerId],
    );
    membershipId = gm.id;
    phone        = gm.phone;

    await rawQuery(
      `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 500)
       ON CONFLICT (group_id) DO UPDATE SET sms_credits = 500`, [groupId],
    );
  });

  /**
   * Two completed contributions for the officer.
   *
   * Deliberately NO loan. An `active` loan trips
   * `trg_assert_loan_attribution_on_status` — "every disbursed loan must be
   * fully attributed to its funding sources" — so a valid one needs a
   * `group_funding_sources` row plus `loan_funding_splits` summing to the
   * principal, and `trg_loans_generate_schedule` then builds a repayment
   * schedule off it. That is loan-lifecycle machinery with its own invariants
   * and its own tests; coupling an SMS-variable test to it buys nothing and
   * breaks whenever loan funding changes.
   *
   * `loan_balance` is still asserted below — it resolves to "0" for a member
   * with no loans, which proves the variable is populated. The non-trivial
   * formatting (thousands separator, retained decimals) is proven by
   * contribution_balance, which is what the money path actually exercises.
   */
  async function giveMemberMoney(): Promise<void> {
    await rawQuery(
      `INSERT INTO contributions (group_id, member_id, group_membership_id, amount, status)
       VALUES ($1,$2,$3,4000,'completed'), ($1,$2,$3,8500.50,'completed')`,
      [groupId, officerId, membershipId],
    );
  }

  it('resolves each balance from the shared snapshot service', async () => {
    await giveMemberMoney();

    const vars = await resolveRecipientVars(
      groupId, [phone],
      'You have saved KES {{contribution_balance}} and owe KES {{loan_balance}}.',
    );
    const mine = vars.get(phone)!;

    // 4000 + 8500.50, grouped, with the cents kept rather than rounded away:
    // a balance a member can check against their own record must match it.
    expect(mine.contribution_balance).toBe('12,500.5');
    // Present and zero — a member of the group with no loan. Distinct from the
    // non-member case below, where it is absent entirely.
    expect(mine.loan_balance).toBe('0');
  });

  it('omits balances entirely when the body never asks for one', async () => {
    await giveMemberMoney();

    const vars = await resolveRecipientVars(groupId, [phone], 'Dear {{first_name}}, meeting Friday.');
    const mine = vars.get(phone)!;

    // The names still resolve; the money does not, because a message that
    // cannot display a balance must not pay four aggregate scans to compute
    // one. Absence here IS the cost guard working.
    expect(mine.first_name).toBeDefined();
    expect(mine.contribution_balance).toBeUndefined();
    expect(mine.loan_balance).toBeUndefined();
  });

  it('leaves a non-member recipient with no balance rather than a zero', async () => {
    await giveMemberMoney();

    const stranger = '254700009999';
    const vars = await resolveRecipientVars(
      groupId, [phone, stranger], 'Balance: KES {{contribution_balance}}',
    );

    // Someone with no membership has no balance to state. Rendering "KES 0"
    // at them would be a factual claim about money that the group has no
    // basis for; the placeholder is stripped instead.
    expect(vars.get(stranger)?.contribution_balance).toBeUndefined();
    expect(vars.get(phone)?.contribution_balance).toBe('12,500.5');
  });

  it('still bills exactly what the preview quoted when a balance is used', async () => {
    await giveMemberMoney();

    // The whole point of the guard: a balance substitutes a variable-length
    // number into the body, so it moves the segment boundary. Preview and
    // dispatch must resolve the SAME value or the quote drifts from the bill —
    // which is why both call resolveRecipientVars with the message.
    const message = `Dear {{first_name}}, your savings are KES {{contribution_balance}}. ${'x'.repeat(110)}`;

    const preview = await smsService.previewBulkSend(ctx, { message, phones: [phone] });

    const varsByPhone = await resolveRecipientVars(groupId, [phone], message);
    await smsService.sendBulkCampaign({
      groupId, sentBy: officerId, phones: [phone], message,
      referenceType: 'campaign', varsByPhone,
    });

    const [log] = await rawQuery<{ segments: number; message_text: string }>(
      `SELECT segments, message_text FROM sms_usage_logs
        WHERE group_id = $1 ORDER BY created_at DESC LIMIT 1`, [groupId],
    );

    expect(log.message_text).toContain('12,500.5');
    expect(log.message_text).not.toContain('{{');
    expect(log.segments).toBe(preview.segmentsPerMessage);
    expect(log.segments).toBe(preview.creditsRequired);
  });
});
