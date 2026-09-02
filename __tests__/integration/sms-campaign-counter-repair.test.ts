/**
 * Campaign counter repair (SMS-REAUDIT-2026-09-02 F4).
 *
 * Campaign `9e1d1bf5` sat with stored `sent=0 / failed=8` against a real
 * `8 sent / 0 failed` for six days — perfectly inverted, correctly reported by
 * the reconciliation job every single run, and unfixable because
 * syncCampaignCompletion has no retroactive counterpart.
 *
 * The job's standing rule is REPORT, NEVER REPAIR, and that rule is about
 * MONEY: credit drift means a balance and its ledger disagree and a human must
 * decide which is true. A campaign counter is not money — it is derived
 * reporting data whose source of truth is sms_usage_logs. Recomputing it is
 * not a judgment call.
 *
 * The guard that makes automating it safe is the one pinned hardest below: a
 * campaign with NO message rows must never be "repaired" to 0/0, because
 * recomputing from an empty source destroys the only record of what it did.
 */
import { reconcileSmsCredits } from '@/lib/services/messaging-billing';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

jest.mock('@/lib/services/email.service', () => ({
  queueEmail: jest.fn().mockResolvedValue('job-id'),
  sendTemplatedEmail: jest.fn(),
}));

async function makeCampaign(
  groupId: string, storedSent: number, storedFailed: number, status = 'completed',
): Promise<string> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO sms_campaigns (group_id, name, message, status, sent_count, failed_count, recipient_count)
     VALUES ($1, 'test campaign', 'hello', $2, $3, $4, 0)
     RETURNING id`,
    [groupId, status, storedSent, storedFailed],
  );
  return row.id;
}

/** Message rows for a campaign, keyed the way the reconciliation query reads them. */
async function seedLogs(groupId: string, campaignId: string, sent: number, failed: number) {
  for (let i = 0; i < sent + failed; i++) {
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider,
          campaign_id, correlation_id)
       VALUES ($1, $2, 'hello', 0, $3, 'textsms', $4, $4)`,
      [groupId, `25470000${String(2000 + i).slice(-4)}`, i < sent ? 'sent' : 'failed', campaignId],
    );
  }
}

async function countersOf(campaignId: string) {
  const [row] = await rawQuery<{ sent_count: number; failed_count: number }>(
    `SELECT sent_count, failed_count FROM sms_campaigns WHERE id = $1`, [campaignId],
  );
  return row;
}

describe('campaign counter repair', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
    process.env.EMAIL_ADMIN = 'ops@example.com';
    await rawQuery(`DELETE FROM staff_alert_state WHERE alert_key = 'sms_credit_reconciliation'`);
  });

  it('recomputes inverted counters from the message log — the 9e1d1bf5 case', async () => {
    const id = await makeCampaign(groupId, 0, 8);   // stored: 0 sent / 8 failed
    await seedLogs(groupId, id, 8, 0);              // real:   8 sent / 0 failed

    const r = await reconcileSmsCredits();

    expect(r.driftedCampaigns).toBe(1);
    expect(r.repairedCampaigns).toBe(1);

    const after = await countersOf(id);
    expect(after.sent_count).toBe(8);
    expect(after.failed_count).toBe(0);
  });

  it('is idempotent — a second run finds nothing left to repair', async () => {
    const id = await makeCampaign(groupId, 0, 8);
    await seedLogs(groupId, id, 8, 0);

    await reconcileSmsCredits();
    const second = await reconcileSmsCredits();

    expect(second.driftedCampaigns).toBe(0);
    expect(second.repairedCampaigns).toBe(0);
  });

  it('NEVER zeroes a campaign whose message rows are gone', async () => {
    // Stored counters say 8 were sent; no log rows survive to recount from.
    // Recomputing here would overwrite the only remaining record with 0/0.
    const id = await makeCampaign(groupId, 8, 0);

    const r = await reconcileSmsCredits();

    expect(r.repairedCampaigns).toBe(0);
    const after = await countersOf(id);
    expect(after.sent_count).toBe(8);
    expect(after.failed_count).toBe(0);
  });

  it('leaves a campaign that is still sending alone', async () => {
    // Mid-flight disagreement is expected, not drift.
    const id = await makeCampaign(groupId, 2, 0, 'sending');
    await seedLogs(groupId, id, 5, 0);

    const r = await reconcileSmsCredits();

    expect(r.repairedCampaigns).toBe(0);
    const after = await countersOf(id);
    expect(after.sent_count).toBe(2);
  });

  it('counts a delivered message as sent, not as a disagreement', async () => {
    const id = await makeCampaign(groupId, 3, 0);
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider, campaign_id, correlation_id)
       VALUES ($1,'254700003001','hello',0,'delivered','textsms',$2,$2),
              ($1,'254700003002','hello',0,'delivered','textsms',$2,$2),
              ($1,'254700003003','hello',0,'sent','textsms',$2,$2)`,
      [groupId, id],
    );

    const r = await reconcileSmsCredits();

    expect(r.driftedCampaigns).toBe(0);
    expect(r.repairedCampaigns).toBe(0);
  });
});
