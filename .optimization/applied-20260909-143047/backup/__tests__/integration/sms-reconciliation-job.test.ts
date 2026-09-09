/**
 * Daily SMS money-trail reconciliation (SMS-AUDIT-v3 G16/G6, pathway T1-6).
 *
 * vw_sms_credit_reconciliation has computed drift correctly since migration
 * 141 and had NO consumer anywhere in the application — an instrument nobody
 * reads is not a control, which is why every billing defect in this audit
 * series was found by hand. Campaign counters have the same shape: the
 * syncCampaignCompletion fix is correct going forward but has no retroactive
 * counterpart, so a row that drifted earlier stays wrong with nothing to
 * notice.
 */
import { reconcileSmsCredits } from '@/lib/services/messaging-billing';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

async function provisionAccount(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
}

describe('SMS reconciliation (G16/G6)', () => {
  it('reports clean books as clean', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionAccount(groupId, 0);

    const r = await reconcileSmsCredits();
    expect(r.driftedPayers).toBe(0);
    expect(r.driftedCampaigns).toBe(0);
  });

  it('detects a balance that disagrees with the ledger', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    // A balance with no ledger entry behind it — the shape a missed ledger
    // write, or a hand-edited balance, would leave.
    await provisionAccount(groupId, 250);

    const r = await reconcileSmsCredits();
    expect(r.driftedPayers).toBeGreaterThan(0);
  });

  it('detects campaign counters that disagree with the message log', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionAccount(groupId, 0);

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by, status, sent_count, failed_count)
       VALUES ($1, 'Drifted', 'hi', $2, 'completed', 0, 8) RETURNING id`,
      [groupId, officerId],
    );
    // Eight rows that genuinely sent, against a row claiming 0 sent / 8 failed
    // — exactly the live production shape this check exists to surface.
    for (let i = 0; i < 8; i++) {
      await rawQuery(
        `INSERT INTO sms_usage_logs
           (group_id, recipient_phone, message_text, credits_deducted, status, provider, payer_type, correlation_id)
         VALUES ($1, $2, 'hi', 1, 'sent', 'textsms', 'group', $3)`,
        [groupId, `25470000${String(2000 + i).slice(-4)}`, campaignId],
      );
    }

    const r = await reconcileSmsCredits();
    expect(r.driftedCampaigns).toBe(1);
  });

  it('ignores a campaign still sending, which legitimately disagrees mid-flight', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionAccount(groupId, 0);

    await rawQuery(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by, status, sent_count, failed_count)
       VALUES ($1, 'In flight', 'hi', $2, 'sending', 0, 0)`,
      [groupId, officerId],
    );

    const r = await reconcileSmsCredits();
    expect(r.driftedCampaigns).toBe(0);
  });
});
