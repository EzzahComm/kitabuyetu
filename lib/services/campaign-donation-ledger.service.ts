/**
 * Books a completed Changi$ha donation: campaign_donations row, campaign
 * total, system journal (debit 1001 M-Pesa, credit 4006 campaign funds held)
 * and audit log. Shared by the STK-push callback and the direct PayBill (C2B)
 * path so both credit a campaign identically.
 *
 * Runs inside the caller's transaction. Idempotent on the M-Pesa receipt
 * (campaign_donations.mpesa_receipt_number is UNIQUE): returns null when the
 * receipt was already booked, so a Safaricom retry never double-credits.
 */
import type { PoolClient } from 'pg';
import { postSystemJournal } from './accounting.service';
import { recordActivityInTx, ActivityEventType } from '@/lib/notifications';
import { IS_SANDBOX } from './mpesa-spine.service';

export interface CampaignDonationInput {
  campaignId: string;
  groupId: string;
  donorName: string | null;
  donorPhone: string;
  amount: number;
  message: string | null;
  isAnonymous: boolean;
  receipt: string;
  /** How the money arrived; recorded in the audit log. */
  channel: 'stk' | 'paybill';
}

export async function creditCampaignDonation(db: PoolClient, in_: CampaignDonationInput): Promise<string | null> {
  const { rows: donationRows } = await db.query<{ id: string }>(
    `INSERT INTO campaign_donations
       (campaign_id, group_id, donor_name, donor_phone, amount, message, is_anonymous, mpesa_receipt_number, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [
      in_.campaignId,
      in_.groupId,
      in_.donorName,
      in_.donorPhone,
      in_.amount.toFixed(2),
      in_.message,
      in_.isAnonymous,
      in_.receipt,
    ],
  );
  const donationId = donationRows[0]?.id ?? null;
  if (!donationId) return null;

  const { rows: campaignRows } = await db.query<{ title: string; target_amount: string; amount_raised: string }>(
    `UPDATE campaigns
     SET    amount_raised = amount_raised + $2, updated_at = NOW()
     WHERE  id = $1
     RETURNING title, target_amount, amount_raised`,
    [in_.campaignId, in_.amount.toFixed(2)],
  );
  const campaignTitle = campaignRows[0]?.title ?? 'campaign';

  const journalEntryId = await postSystemJournal(
    db,
    in_.groupId,
    null,
    `Changi$ha donation - ${campaignTitle}`,
    [
      { accountCode: '1001', debit: in_.amount },
      { accountCode: '4006', credit: in_.amount },
    ],
    { reference: in_.receipt, isTest: IS_SANDBOX },
  );
  if (journalEntryId) {
    await db.query(`UPDATE campaign_donations SET journal_entry_id = $1 WHERE id = $2`, [journalEntryId, donationId]);
  }

  await db.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      in_.groupId,
      null, // system-triggered via M-Pesa callback
      'campaign_donation.settle',
      'campaign_donation',
      donationId,
      JSON.stringify({
        amount: in_.amount.toFixed(2),
        mpesa_receipt_number: in_.receipt,
        campaign_id: in_.campaignId,
        channel: in_.channel,
      }),
    ],
  );

  // Transactional outbox (no donor identity): rolls back with the donation, reaches admins in the digest.
  await recordActivityInTx(db, {
    type: ActivityEventType.CAMPAIGN_DONATION_RECEIVED,
    dedupKey: `donation:${in_.receipt}`,
    group: { id: in_.groupId, name: '' },
    transaction: { id: donationId, reference: in_.receipt, amount: in_.amount, currency: 'KES', status: 'completed' },
    metadata: { campaign: campaignTitle, channel: in_.channel },
  });
  const camp = campaignRows[0];
  if (
    camp &&
    Number(camp.amount_raised) >= Number(camp.target_amount) &&
    Number(camp.amount_raised) - in_.amount < Number(camp.target_amount)
  ) {
    await recordActivityInTx(db, {
      type: ActivityEventType.CAMPAIGN_TARGET_REACHED,
      dedupKey: `campaign:${in_.campaignId}:target-reached`,
      group: { id: in_.groupId, name: '' },
      transaction: {
        id: in_.campaignId,
        amount: Number(camp.target_amount),
        currency: 'KES',
        status: 'target reached',
      },
      metadata: { campaign: campaignTitle, raised: Number(camp.amount_raised) },
    });
  }
  return donationId;
}
