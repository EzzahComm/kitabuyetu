/**
 * Changi$ha withdrawals — paying a campaign's raised funds out to its payout
 * destination, with the platform taking a fee: an M-Pesa phone via Daraja
 * B2C, or a business paybill/till via Daraja B2B (migration 202;
 * lib/campaigns/payout-destination.ts). The destination is snapshotted onto
 * each withdrawal row at request time.
 *
 * Same spine as vendor-payments.service.ts (the closest existing analog: an
 * external, non-member payee) — reserve group cash -> dual-approve (maker
 * != checker) -> dispatch outside the transaction -> settle on the Daraja
 * result callback (settlement-callbacks.service.ts's
 * handleCampaignWithdrawalResult). Two things this flow has that vendor
 * payments don't:
 *
 * 1. A campaign-level available-balance check, in addition to the
 *    group-level cash check. 1001 (Cash and M-Pesa) is one pooled float
 *    shared by every group activity — Bookkeeper contributions, other
 *    campaigns, everything. Without checking this campaign's own undrawn
 *    balance (amount_raised minus what's already been withdrawn or is
 *    mid-flight), a campaign could draw against money it never raised,
 *    defeating the whole point of account 4006 keeping Changi$ha separate
 *    from Bookkeeper finances (migration 185).
 *
 * 2. The M-Pesa charge (B2C tariff for a phone, B2B tariff for a
 *    paybill/till) is computed HERE, at request time — not at settlement
 *    like every other outbound flow in this codebase. Vendor
 *    payments/settlements send their full requested amount to Daraja; the
 *    Safaricom fee is a separate deduction from the group's cash on top,
 *    never shorting the payee. Changi$ha's fee model is the opposite: the
 *    beneficiary receives net_amount (gross minus platform fee minus the
 *    M-Pesa cost), so the M-Pesa cost must be known before net_amount — and
 *    therefore before dispatch — can be computed at all.
 */
import { emitWithdrawalEvent, ActivityEventType } from '@/lib/notifications';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { payoutColumns, toPayoutDestination, type PayoutFields } from '@/lib/campaigns/payout-destination';
import { recordApproval } from './settlement-approvals.service';
import { resolvePolicy } from './configuration.service';
import {
  CAMPAIGN_OFFICER_ROLES,
  assertCampaignOfficersComplete,
  getApprovedOfficerRoles,
  getApprovedOfficerRolesBySubject,
  getOfficerRole,
  remainingApproverRoles,
  type CampaignOfficerRole,
} from './campaign-officers.service';
import { computeB2BCharge, computeB2CCharge } from './mpesa-charges.service';
import { triggerDisbursementWatchdog } from '@/lib/queue/qstash';
import { CHANGISHA_PRICING } from '@/types/enums';

export interface RequestWithdrawalInput {
  campaignId: string;
  grossAmount: number;
  idempotencyKey: string;
}

/** The payout_* fields are the destination snapshotted at request time. */
export interface CampaignWithdrawalRow extends PayoutFields {
  id: string;
  campaign_id: string;
  group_id: string;
  gross_amount: string;
  platform_fee_pct: string;
  platform_fee_amount: string;
  mpesa_charge_amount: string;
  net_amount: string;
  status: string;
  requested_by: string | null;
  requested_at: Date;
  originator_conversation_id: string | null;
  journal_entry_id: string | null;
  completed_at: Date | null;
  failure_reason: string | null;
  reconciled_at: Date | null;
  idempotency_key: string | null;
  /** Kept for history; Kitabu Yetu's sign-off is now mandatory for every release (see request()). */
  platform_signoff_required: boolean;
  /** The requester's office, snapshotted at request time. Their office counts as their sign-off. */
  requested_by_role: string | null;
  /** Which offices have signed off and which are still owed. Filled in on reads, not stored. */
  approval_progress?: ApprovalProgress;
}

export interface ApprovalProgress {
  requested_by_role: CampaignOfficerRole | null;
  approved_roles: CampaignOfficerRole[];
  remaining_roles: CampaignOfficerRole[];
}

/** One row of the Kitabu Yetu release queue — includes the destination, so the reviewer sees where money goes. */
export interface PlatformQueueRow extends PayoutFields {
  id: string;
  campaign_id: string;
  group_id: string;
  campaign_title: string;
  group_name: string;
  amount_raised: string;
  gross_amount: string;
  platform_fee_amount: string;
  mpesa_charge_amount: string;
  net_amount: string;
  requested_at: Date;
}

const DEFAULT_PLATFORM_FEE_PCT = CHANGISHA_PRICING.platformFeePct;
const DEFAULT_MIN_WITHDRAWAL = CHANGISHA_PRICING.minWithdrawal;

/** Non-terminal — still counts against the campaign's undrawn balance. */
const OPEN_STATUSES = ['pending_approval', 'awaiting_platform', 'approved', 'processing'];

export const campaignWithdrawalsService = {
  async request(ctx: TenantContext, input: RequestWithdrawalInput): Promise<CampaignWithdrawalRow> {
    if (!(input.grossAmount > 0)) throw new ValidationError('Amount must be positive');
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new ValidationError('A valid idempotency key is required');
    }

    const created = await withTransaction(ctx, async (db) => {
      const { rows: existing } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE group_id = $1 AND idempotency_key = $2`,
        [ctx.groupId, input.idempotencyKey],
      );
      if (existing[0]) return existing[0];

      // Three different offices have to sign off a release, so the group must have all three
      // filled, and the requester must hold one of them (their office counts as their sign-off).
      await assertCampaignOfficersComplete(db, ctx.groupId);
      const requesterRole = await getOfficerRole(db, ctx.groupId, ctx.userId);
      if (!requesterRole) {
        throw new ForbiddenError("Only the group's chairperson, treasurer or secretary can request a withdrawal");
      }

      const { rows: campaignRows } = await db.query<PayoutFields & { status: string; amount_raised: string }>(
        `SELECT status, amount_raised, payout_method, payout_phone, payout_shortcode, payout_account, payout_payee_name
         FROM   campaigns
         WHERE  id = $1 AND group_id = $2
         FOR UPDATE`,
        [input.campaignId, ctx.groupId],
      );
      const campaign = campaignRows[0];
      if (!campaign) throw new NotFoundError('Campaign', input.campaignId);
      if (campaign.status !== 'active') {
        throw new ValidationError(`Only an active campaign can be withdrawn from (current status: ${campaign.status})`);
      }
      const destination = toPayoutDestination(campaign);
      if (!destination) {
        // Defense in depth — submitForReview already guarantees this, but a
        // campaign can have been approved before that guard existed (one live
        // campaign was).
        throw new ValidationError('This campaign has no payout destination set');
      }

      const { rows: drawnRows } = await db.query<{ drawn: string }>(
        `SELECT COALESCE(SUM(gross_amount), 0) AS drawn
         FROM campaign_withdrawals
         WHERE campaign_id = $1 AND status = ANY($2)`,
        [input.campaignId, OPEN_STATUSES.concat('completed')],
      );
      const available = parseFloat(campaign.amount_raised) - parseFloat(drawnRows[0].drawn);
      if (input.grossAmount > available) {
        throw new ValidationError(
          `This campaign has KES ${available.toFixed(2)} available to withdraw (raised so far, minus already-withdrawn or in-flight amounts)`,
        );
      }

      const { rows: acctRows } = await db.query<{ id: string; balance: string; reserved_amount: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`,
        [ctx.groupId],
      );
      if (!acctRows[0]) {
        throw new ValidationError('Group has no active Cash/M-Pesa account (1001) to pay from');
      }
      const groupAvailable = parseFloat(acctRows[0].balance) - parseFloat(acctRows[0].reserved_amount);
      if (input.grossAmount > groupAvailable) {
        throw new ValidationError(`Insufficient available group balance (KES ${groupAvailable.toFixed(2)} available)`);
      }

      const minWithdrawal = await resolvePolicy<number>(
        db,
        'changisha',
        'min_withdrawal_amount',
        { groupId: ctx.groupId },
        DEFAULT_MIN_WITHDRAWAL,
      );
      if (input.grossAmount < minWithdrawal) {
        throw new ValidationError(`The minimum Changi$ha withdrawal is KES ${minWithdrawal.toFixed(2)}`);
      }

      const platformFeePct = await resolvePolicy<number>(
        db,
        'changisha',
        'platform_fee_pct',
        { groupId: ctx.groupId },
        DEFAULT_PLATFORM_FEE_PCT,
      );
      const platformFeeAmount = Math.round(input.grossAmount * (platformFeePct / 100) * 100) / 100;
      const mpesaChargeAmount =
        destination.method === 'phone'
          ? await computeB2CCharge(db, input.grossAmount)
          : await computeB2BCharge(db, input.grossAmount);
      const netAmount = Math.round((input.grossAmount - platformFeeAmount - mpesaChargeAmount) * 100) / 100;
      if (netAmount <= 0) {
        throw new ValidationError(
          'This amount is too small to cover the platform fee and M-Pesa transaction cost — try a larger withdrawal',
        );
      }

      await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, input.grossAmount.toFixed(2)]);

      const payout = payoutColumns(destination);
      const { rows: inserted } = await db.query<CampaignWithdrawalRow>(
        `INSERT INTO campaign_withdrawals
           (campaign_id, group_id, payout_method, payout_phone, payout_shortcode, payout_account,
            payout_payee_name, gross_amount, platform_fee_pct, platform_fee_amount,
            mpesa_charge_amount, net_amount, status, requested_by, idempotency_key, platform_signoff_required,
            requested_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_approval',$13,$14,true,$15)
         RETURNING *`,
        [
          input.campaignId,
          ctx.groupId,
          payout.payout_method,
          payout.payout_phone,
          payout.payout_shortcode,
          payout.payout_account,
          payout.payout_payee_name,
          input.grossAmount.toFixed(2),
          platformFeePct.toFixed(2),
          platformFeeAmount.toFixed(2),
          mpesaChargeAmount.toFixed(2),
          netAmount.toFixed(2),
          ctx.userId,
          input.idempotencyKey,
          requesterRole,
        ],
      );

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ctx.groupId,
          ctx.userId,
          'campaignWithdrawal.request',
          'campaign_withdrawal',
          inserted[0].id,
          null,
          JSON.stringify({
            campaign_id: input.campaignId,
            ...payout,
            gross_amount: inserted[0].gross_amount,
            platform_fee_amount: inserted[0].platform_fee_amount,
            mpesa_charge_amount: inserted[0].mpesa_charge_amount,
            net_amount: inserted[0].net_amount,
            status: 'pending_approval',
          }),
        ],
      );

      return inserted[0];
    });
    // After commit; deduped per withdrawal, so an idempotent replay is silent.
    await emitWithdrawalEvent(created.id, ActivityEventType.WITHDRAWAL_REQUESTED, {
      actorUserId: ctx.userId,
      stage: 'Awaiting approval by the chairperson, treasurer and secretary',
    });
    return created;
  },

  /**
   * One office's approval. The requester's own office counts as their sign-off, so the other two
   * offices must each approve; a second person from the requester's office does not count, nor does
   * a second approval from an office that has already signed. Only when every office has signed does
   * the withdrawal move to Kitabu Yetu's queue (which is mandatory for every release).
   */
  async approve(ctx: TenantContext, id: string): Promise<CampaignWithdrawalRow> {
    const result = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending campaign withdrawal', id);
      const prior = rows[0];

      await assertCampaignOfficersComplete(db, ctx.groupId);
      const approverRole = await getOfficerRole(db, ctx.groupId, ctx.userId);
      if (!approverRole) {
        throw new ForbiddenError("Only the group's chairperson, treasurer or secretary can approve a withdrawal");
      }
      if (approverRole === prior.requested_by_role) {
        throw new ForbiddenError(
          `This withdrawal was requested by the ${approverRole}; it must be approved by the other two offices`,
        );
      }
      const alreadyApproved = await getApprovedOfficerRoles(db, id);
      if (alreadyApproved.includes(approverRole)) {
        throw new ConflictError(`The ${approverRole} has already approved this withdrawal`);
      }

      await recordApproval(db, ctx, {
        subjectType: 'campaign_withdrawal',
        subjectId: id,
        initiatedBy: prior.requested_by ?? '',
        decision: 'approved',
        approverRole,
      });

      const approvedRoles = [...alreadyApproved, approverRole];
      const remaining = remainingApproverRoles(prior.requested_by_role as CampaignOfficerRole | null, approvedRoles);

      // Still waiting on another office: record the approval and leave the status alone.
      if (remaining.length > 0) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ctx.groupId,
            ctx.userId,
            'campaignWithdrawal.approve_partial',
            'campaign_withdrawal',
            id,
            JSON.stringify({ status: prior.status }),
            JSON.stringify({ status: prior.status, approved_by_role: approverRole, awaiting_roles: remaining }),
          ],
        );
        return { row: prior, complete: false };
      }

      // Every office has signed. Kitabu Yetu's sign-off is mandatory, so nothing is dispatched here.
      const { rows: updated } = await db.query<CampaignWithdrawalRow>(
        `UPDATE campaign_withdrawals SET status = 'awaiting_platform' WHERE id = $1 RETURNING *`,
        [id],
      );
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'campaignWithdrawal.approve',
          'campaign_withdrawal',
          id,
          JSON.stringify({ status: prior.status }),
          JSON.stringify({ status: 'awaiting_platform', approved_by_role: approverRole }),
        ],
      );
      return { row: updated[0], complete: true };
    });

    if (result.complete) {
      // The action-required alert: Kitabu Yetu now has to sign this off.
      await emitWithdrawalEvent(result.row.id, ActivityEventType.WITHDRAWAL_PENDING_REVIEW, {
        actorUserId: ctx.userId,
        stage: 'Approved by the chairperson, treasurer and secretary - Kitabu Yetu approval required',
      });
    }
    return this.getById(ctx, result.row.id);
  },

  async reject(ctx: TenantContext, id: string, reason: string): Promise<CampaignWithdrawalRow> {
    const rejected = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending campaign withdrawal', id);

      const prior = rows[0];
      const rejecterRole = await getOfficerRole(db, ctx.groupId, ctx.userId);
      if (!rejecterRole) {
        throw new ForbiddenError("Only the group's chairperson, treasurer or secretary can reject a withdrawal");
      }
      await recordApproval(db, ctx, {
        subjectType: 'campaign_withdrawal',
        subjectId: id,
        initiatedBy: prior.requested_by ?? '',
        decision: 'rejected',
        reason,
        approverRole: rejecterRole,
      });

      const { rows: acctRows } = await db.query<{ id: string }>(`SELECT * FROM lock_group_cash_account($1, '1001')`, [
        ctx.groupId,
      ]);
      if (acctRows[0]) {
        await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${prior.gross_amount}`]);
      }

      const { rows: updated } = await db.query<CampaignWithdrawalRow>(
        `UPDATE campaign_withdrawals
         SET    status = 'rejected', failure_reason = $2
         WHERE  id = $1 RETURNING *`,
        [id, reason],
      );

      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'campaignWithdrawal.reject',
          'campaign_withdrawal',
          id,
          JSON.stringify({ status: prior.status }),
          JSON.stringify({ status: 'rejected', failure_reason: reason }),
        ],
      );

      return updated[0];
    });
    await emitWithdrawalEvent(id, ActivityEventType.WITHDRAWAL_REJECTED, { actorUserId: ctx.userId, reason });
    return rejected;
  },

  /** Withdrawals a Kitabu Yetu super-admin still has to release, oldest first. Backoffice only. */
  async listAwaitingPlatform(): Promise<PlatformQueueRow[]> {
    return withAdminDb(async (db) => {
      const { rows } = await db.query<PlatformQueueRow>(
        `SELECT w.id, w.campaign_id, w.group_id, w.gross_amount, w.platform_fee_amount, w.mpesa_charge_amount,
                w.net_amount, w.payout_method, w.payout_phone, w.payout_shortcode, w.payout_account,
                w.payout_payee_name, w.requested_at,
                c.title AS campaign_title, c.amount_raised, g.name AS group_name
         FROM   campaign_withdrawals w
         JOIN   campaigns c ON c.id = w.campaign_id
         JOIN   groups g ON g.id = w.group_id
         WHERE  w.status = 'awaiting_platform'
         ORDER  BY w.requested_at ASC`,
      );
      return rows;
    });
  },

  /**
   * Kitabu Yetu's sign-off: releases an 'awaiting_platform' withdrawal for
   * dispatch. The decision is recorded in settlement_approvals as a
   * 'backoffice' approver — the same ledger as the officers' decisions.
   */
  async platformApprove(adminUserId: string, id: string): Promise<CampaignWithdrawalRow> {
    const row = await withAdminDb(async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE id = $1 AND status = 'awaiting_platform' FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundError('Campaign withdrawal awaiting platform sign-off', id);
      const prior = rows[0];

      // An officer may have left since the group signed off; do not release to a group that can no
      // longer meet the three-office rule.
      await assertCampaignOfficersComplete(db, prior.group_id);

      await db.query(
        `INSERT INTO settlement_approvals (subject_type, subject_id, group_id, approver_id, approver_kind, decision)
           VALUES ('campaign_withdrawal', $1, $2, $3, 'backoffice', 'approved')`,
        [id, prior.group_id, adminUserId],
      );
      const { rows: updated } = await db.query<CampaignWithdrawalRow>(
        `UPDATE campaign_withdrawals SET status = 'approved' WHERE id = $1 RETURNING *`,
        [id],
      );
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, 'campaignWithdrawal.platformApprove', 'campaign_withdrawal', $3, $4, $5)`,
        [
          prior.group_id,
          adminUserId,
          id,
          JSON.stringify({ status: 'awaiting_platform' }),
          JSON.stringify({ status: 'approved' }),
        ],
      );
      return updated[0];
    });

    await emitWithdrawalEvent(row.id, ActivityEventType.WITHDRAWAL_APPROVED, { adminUserId });
    await dispatchCampaignWithdrawal(row.id);
    return row;
  },

  /** Kitabu Yetu declines a release: the reserved cash goes back to the group and the row is closed. */
  async platformReject(adminUserId: string, id: string, reason: string): Promise<CampaignWithdrawalRow> {
    if (!reason.trim()) throw new ValidationError('A reason is required to decline a release');
    const declined = await withAdminDb(async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE id = $1 AND status = 'awaiting_platform' FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundError('Campaign withdrawal awaiting platform sign-off', id);
      const prior = rows[0];

      await db.query(
        `INSERT INTO settlement_approvals
             (subject_type, subject_id, group_id, approver_id, approver_kind, decision, reason)
           VALUES ('campaign_withdrawal', $1, $2, $3, 'backoffice', 'rejected', $4)`,
        [id, prior.group_id, adminUserId, reason],
      );
      const { rows: acctRows } = await db.query<{ id: string }>(`SELECT * FROM lock_group_cash_account($1, '1001')`, [
        prior.group_id,
      ]);
      if (acctRows[0]) {
        await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${prior.gross_amount}`]);
      }
      const { rows: updated } = await db.query<CampaignWithdrawalRow>(
        `UPDATE campaign_withdrawals SET status = 'rejected', failure_reason = $2 WHERE id = $1 RETURNING *`,
        [id, `Declined by Kitabu Yetu: ${reason}`],
      );
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, 'campaignWithdrawal.platformReject', 'campaign_withdrawal', $3, $4, $5)`,
        [
          prior.group_id,
          adminUserId,
          id,
          JSON.stringify({ status: 'awaiting_platform' }),
          JSON.stringify({ status: 'rejected', failure_reason: reason }),
        ],
      );
      return updated[0];
    });
    await emitWithdrawalEvent(id, ActivityEventType.WITHDRAWAL_REJECTED, { adminUserId, reason });
    return declined;
  },

  async getById(ctx: TenantContext, id: string): Promise<CampaignWithdrawalRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Campaign withdrawal', id);
      return (await withApprovalProgress(db, rows))[0];
    });
  },

  async listForCampaign(ctx: TenantContext, campaignId: string): Promise<CampaignWithdrawalRow[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals
         WHERE  campaign_id = $1 AND group_id = $2
         ORDER  BY requested_at DESC`,
        [campaignId, ctx.groupId],
      );
      return withApprovalProgress(db, rows);
    });
  },
};

/** Adds which offices have signed and which are still owed, from the approvals ledger. */
async function withApprovalProgress(
  db: Parameters<typeof getApprovedOfficerRolesBySubject>[0],
  rows: CampaignWithdrawalRow[],
): Promise<CampaignWithdrawalRow[]> {
  const approvedBySubject = await getApprovedOfficerRolesBySubject(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => {
    const requestedByRole = (CAMPAIGN_OFFICER_ROLES as readonly string[]).includes(row.requested_by_role ?? '')
      ? (row.requested_by_role as CampaignOfficerRole)
      : null;
    const approvedRoles = approvedBySubject.get(row.id) ?? [];
    return {
      ...row,
      approval_progress: {
        requested_by_role: requestedByRole,
        approved_roles: approvedRoles,
        remaining_roles:
          row.status === 'pending_approval' ? remainingApproverRoles(requestedByRole, approvedRoles) : [],
      },
    };
  });
}

/**
 * Same shape as findStuckVendorPayments/findStuckDisbursements, including
 * the same requirement to also surface unreconciled 'timed_out' rows.
 */
export async function findStuckCampaignWithdrawals(): Promise<{
  count: number;
  samples: { id: string; groupId: string; amount: string; ageMinutes: number }[];
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; group_id: string; amount: string; age_minutes: number }>(
      `SELECT id, group_id, gross_amount AS amount,
              EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60 AS age_minutes
       FROM   campaign_withdrawals
       WHERE  (status = 'processing'
                AND requested_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '10 minutes')
          OR  (status = 'timed_out' AND reconciled_at IS NULL)
       ORDER  BY requested_at ASC
       LIMIT  20`,
    );
    const samples = rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      amount: r.amount,
      ageMinutes: Math.round(Number(r.age_minutes)),
    }));
    if (samples.length > 0) {
      logger.error('[campaign-withdrawals] stuck payouts — no result callback received', {
        count: samples.length,
        samples: samples.slice(0, 5),
      });
    }
    return { count: samples.length, samples };
  });
}

/**
 * Fires the Daraja call for an 'approved' row and flips it to 'processing':
 * B2C for a phone, B2B (pay bill / buy goods) for a paybill or till. Same
 * claim-then-dispatch-then-release-on-throw shape as every other outbound
 * money path in this codebase. Both products report back with the same
 * OriginatorConversationID correlation, settled by
 * handleCampaignWithdrawalResult from whichever route Safaricom calls.
 */
async function dispatchCampaignWithdrawal(id: string): Promise<void> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<
      PayoutFields & {
        id: string;
        group_id: string;
        campaign_id: string;
        net_amount: string;
      }
    >(
      `UPDATE campaign_withdrawals
       SET    status = 'processing'
       WHERE  id = $1 AND status = 'approved'
       RETURNING id, group_id, campaign_id, net_amount, payout_method, payout_phone,
                 payout_shortcode, payout_account, payout_payee_name`,
      [id],
    );

    if (rows[0]) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rows[0].group_id,
          null, // system-triggered (background dispatch)
          'campaignWithdrawal.dispatch',
          'campaign_withdrawal',
          id,
          JSON.stringify({ status: 'approved' }),
          JSON.stringify({ status: 'processing' }),
        ],
      );
    }

    return rows[0] ?? null;
  });
  if (!claimed) return;
  await emitWithdrawalEvent(id, ActivityEventType.WITHDRAWAL_PROCESSING);

  const { rows: campaignRows } = await withAdminDb((db) =>
    db.query<{ title: string }>(`SELECT title FROM campaigns WHERE id = $1`, [claimed.campaign_id]),
  );
  const campaignTitle = campaignRows[0]?.title ?? 'Changi$ha campaign';
  const remarks = `Changi$ha withdrawal — ${campaignTitle}`.slice(0, 100);

  try {
    // The DB CHECK (migration 202) guarantees a complete destination on every
    // row; this only narrows the type — if it ever fails, the catch below
    // releases the reservation and marks the row failed.
    const destination = toPayoutDestination(claimed);
    if (!destination) throw new Error('Withdrawal row has an incomplete payout destination');

    const { initiateB2C, initiateB2B } = await import('./daraja.service');
    const amount = parseFloat(claimed.net_amount);
    const res =
      destination.method === 'phone'
        ? await initiateB2C({
            phone: destination.phone,
            amount,
            commandId: 'BusinessPayment',
            occasion: remarks,
            remarks,
          })
        : await initiateB2B({
            amount,
            receiverShortcode: destination.shortcode,
            // '4' = organisation shortcode — Daraja's identifier for both a
            // paybill and a till number (same value vendor payments use).
            receiverIdentifier: '4',
            commandId: destination.method === 'paybill' ? 'BusinessPayBill' : 'BusinessBuyGoods',
            // A paybill needs the business's own account number; a till has
            // none, so send a reference the business can trace back to us.
            accountReference:
              destination.method === 'paybill' ? destination.account : `CHANGISHA-${claimed.id.slice(0, 8)}`,
            remarks,
          });

    await withAdminDb((db) =>
      db.query(`UPDATE campaign_withdrawals SET originator_conversation_id = $2 WHERE id = $1`, [
        claimed.id,
        res.originatorConversationId,
      ]),
    );
    // Best-effort watchdog — never blocks/fails a dispatch that already succeeded.
    await triggerDisbursementWatchdog({ kind: 'campaign_withdrawal', rowId: claimed.id });
  } catch (err) {
    logger.error('[campaign-withdrawals] dispatch failed before Daraja accepted the request', {
      campaignWithdrawalId: id,
      err: String(err),
    });
    await withAdminDb(async (db) => {
      const { rows: acctRows } = await db.query<{ id: string }>(`SELECT * FROM lock_group_cash_account($1, '1001')`, [
        claimed.group_id,
      ]);
      if (acctRows[0]) {
        // Reservation was for gross_amount, not net_amount — re-fetch it
        // rather than trusting the outer scope, since claimed only carries
        // net_amount (all dispatch needs).
        const { rows: wRows } = await db.query<{ gross_amount: string }>(
          `SELECT gross_amount FROM campaign_withdrawals WHERE id = $1`,
          [id],
        );
        if (wRows[0]) {
          await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [
            acctRows[0].id,
            `-${wRows[0].gross_amount}`,
          ]);
        }
      }
      await db.query(
        `UPDATE campaign_withdrawals
         SET    status = 'failed', failure_reason = $2
         WHERE  id = $1 AND status = 'processing'`,
        [id, `Dispatch error: ${String(err).slice(0, 500)}`],
      );
    });
    await emitWithdrawalEvent(id, ActivityEventType.WITHDRAWAL_FAILED, {
      reason: `Dispatch error before M-Pesa accepted the request`,
    });
  }
}
