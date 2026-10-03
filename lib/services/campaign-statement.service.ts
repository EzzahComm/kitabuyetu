/**
 * Public Changi$ha campaign statement - what donors see on /fundraise/[slug]
 * to follow the money: totals, the supporters list and every release of
 * funds.
 *
 * Deliberately a separate, read-only module with hand-picked columns. It
 * reads via withAdminDb (campaigns are public; see campaigns.service's
 * header), so the SELECT lists ARE the privacy boundary:
 *   - donations: never donor_phone or mpesa_receipt_number; donor_name only
 *     when the donor did not ask to be anonymous (migration 182's own
 *     is_anonymous contract: "Hides donor_name on the PUBLIC page only").
 *   - withdrawals: never payout_phone, payout_shortcode or payout_account.
 *     A release to a business shows the business's name (payout_payee_name,
 *     e.g. a hospital) because naming who was paid is the point of the
 *     statement; a release to a phone shows only "M-Pesa number".
 * Callers must only pass campaigns that are publicly visible
 * (campaignsService.getPublicCampaignForDisplay).
 */
import { withAdminDb } from '@/lib/db';
import type { PayoutMethod } from '@/lib/campaigns/payout-destination';

export interface PublicSupporter {
  /** null when the donor chose to give anonymously. */
  name: string | null;
  amount: number;
  message: string | null;
  givenAt: string;
}

export interface PublicRelease {
  releasedAt: string;
  /** What left the campaign: net + platform fee + M-Pesa charge. */
  grossAmount: number;
  platformFee: number;
  mpesaCharge: number;
  /** What the destination received. */
  netAmount: number;
  method: PayoutMethod;
  /** Business name for a paybill/till release; null for a phone. */
  payeeName: string | null;
}

export interface PublicCampaignStatement {
  donationCount: number;
  totalDonated: number;
  totalReleased: number;
  /** Requested withdrawals not yet paid out (awaiting approval or in flight). */
  pendingRelease: number;
  /** Raised minus released minus pending: funds still held for the campaign. */
  heldBalance: number;
  supporters: PublicSupporter[];
  releases: PublicRelease[];
}

/** Withdrawal statuses that still hold money back from the campaign's balance. */
const PENDING_STATUSES = ['pending_approval', 'awaiting_platform', 'approved', 'processing'];

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getPublicCampaignStatement(
  campaignId: string,
  supporterLimit = 20,
): Promise<PublicCampaignStatement> {
  return withAdminDb(async (db) => {
    const [totals, supporters, releases, pending] = await Promise.all([
      db.query<{ count: string; total: string | null }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM   campaign_donations
         WHERE  campaign_id = $1 AND status = 'completed'`,
        [campaignId],
      ),
      db.query<{
        donor_name: string | null;
        is_anonymous: boolean;
        amount: string;
        message: string | null;
        created_at: string;
      }>(
        `SELECT donor_name, is_anonymous, amount, message, created_at
         FROM   campaign_donations
         WHERE  campaign_id = $1 AND status = 'completed'
         ORDER  BY created_at DESC
         LIMIT  $2`,
        [campaignId, supporterLimit],
      ),
      db.query<{
        completed_at: string;
        gross_amount: string;
        platform_fee_amount: string;
        mpesa_charge_amount: string;
        net_amount: string;
        payout_method: PayoutMethod;
        payout_payee_name: string | null;
      }>(
        `SELECT completed_at, gross_amount, platform_fee_amount, mpesa_charge_amount, net_amount,
                payout_method, payout_payee_name
         FROM   campaign_withdrawals
         WHERE  campaign_id = $1 AND status = 'completed'
         ORDER  BY completed_at DESC`,
        [campaignId],
      ),
      db.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(gross_amount), 0) AS total
         FROM   campaign_withdrawals
         WHERE  campaign_id = $1 AND status = ANY($2)`,
        [campaignId, PENDING_STATUSES],
      ),
    ]);

    const totalDonated = parseFloat(totals.rows[0]?.total ?? '0');
    const mappedReleases: PublicRelease[] = releases.rows.map((r) => ({
      releasedAt: r.completed_at,
      grossAmount: parseFloat(r.gross_amount),
      platformFee: parseFloat(r.platform_fee_amount),
      mpesaCharge: parseFloat(r.mpesa_charge_amount),
      netAmount: parseFloat(r.net_amount),
      method: r.payout_method,
      payeeName: r.payout_method === 'phone' ? null : r.payout_payee_name,
    }));
    const totalReleased = round2(mappedReleases.reduce((sum, r) => sum + r.grossAmount, 0));
    const pendingRelease = parseFloat(pending.rows[0]?.total ?? '0');

    return {
      donationCount: parseInt(totals.rows[0]?.count ?? '0', 10),
      totalDonated,
      totalReleased,
      pendingRelease,
      heldBalance: round2(Math.max(0, totalDonated - totalReleased - pendingRelease)),
      supporters: supporters.rows.map((s) => ({
        name: s.is_anonymous ? null : s.donor_name?.trim() || null,
        amount: parseFloat(s.amount),
        message: s.message?.trim().slice(0, 280) || null,
        givenAt: s.created_at,
      })),
      releases: mappedReleases,
    };
  });
}
