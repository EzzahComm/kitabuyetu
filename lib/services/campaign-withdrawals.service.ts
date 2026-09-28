/**
 * Changi$ha withdrawals — paying a campaign's raised funds out to its
 * beneficiary via M-Pesa B2C, with the platform taking a fee.
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
 * 2. The M-Pesa B2C charge is computed HERE, at request time — not at
 *    settlement like every other B2C flow in this codebase. Vendor
 *    payments/settlements send their full requested amount to Daraja; the
 *    Safaricom fee is a separate deduction from the group's cash on top,
 *    never shorting the payee. Changi$ha's fee model is the opposite: the
 *    beneficiary receives net_amount (gross minus platform fee minus the
 *    M-Pesa cost), so the M-Pesa cost must be known before net_amount — and
 *    therefore before dispatch — can be computed at all.
 */
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { recordApproval } from './settlement-approvals.service';
import { resolvePolicy } from './configuration.service';
import { computeB2CCharge } from './mpesa-charges.service';
import { triggerDisbursementWatchdog } from '@/lib/queue/qstash';

export interface RequestWithdrawalInput {
  campaignId: string;
  grossAmount: number;
  idempotencyKey: string;
}

export interface CampaignWithdrawalRow {
  id: string;
  campaign_id: string;
  group_id: string;
  payout_phone: string;
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
}

const DEFAULT_PLATFORM_FEE_PCT = 4;
const DEFAULT_MIN_WITHDRAWAL = 500;

/** Non-terminal — still counts against the campaign's undrawn balance. */
const OPEN_STATUSES = ['pending_approval', 'approved', 'processing'];

export const campaignWithdrawalsService = {
  async request(ctx: TenantContext, input: RequestWithdrawalInput): Promise<CampaignWithdrawalRow> {
    if (!(input.grossAmount > 0)) throw new ValidationError('Amount must be positive');
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new ValidationError('A valid idempotency key is required');
    }

    return withTransaction(ctx, async (db) => {
      const { rows: existing } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE group_id = $1 AND idempotency_key = $2`,
        [ctx.groupId, input.idempotencyKey],
      );
      if (existing[0]) return existing[0];

      const { rows: campaignRows } = await db.query<{
        status: string;
        payout_phone: string | null;
        amount_raised: string;
      }>(`SELECT status, payout_phone, amount_raised FROM campaigns WHERE id = $1 AND group_id = $2 FOR UPDATE`, [
        input.campaignId,
        ctx.groupId,
      ]);
      const campaign = campaignRows[0];
      if (!campaign) throw new NotFoundError('Campaign', input.campaignId);
      if (campaign.status !== 'active') {
        throw new ValidationError(`Only an active campaign can be withdrawn from (current status: ${campaign.status})`);
      }
      if (!campaign.payout_phone) {
        // Defense in depth — submitForReview already guarantees this, but a
        // campaign could theoretically have been approved before that guard
        // existed.
        throw new ValidationError('This campaign has no payout phone number set');
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
      const mpesaChargeAmount = await computeB2CCharge(db, input.grossAmount);
      const netAmount = Math.round((input.grossAmount - platformFeeAmount - mpesaChargeAmount) * 100) / 100;
      if (netAmount <= 0) {
        throw new ValidationError(
          'This amount is too small to cover the platform fee and M-Pesa transaction cost — try a larger withdrawal',
        );
      }

      await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, input.grossAmount.toFixed(2)]);

      const { rows: inserted } = await db.query<CampaignWithdrawalRow>(
        `INSERT INTO campaign_withdrawals
           (campaign_id, group_id, payout_phone, gross_amount, platform_fee_pct,
            platform_fee_amount, mpesa_charge_amount, net_amount, status, requested_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_approval',$9,$10)
         RETURNING *`,
        [
          input.campaignId,
          ctx.groupId,
          campaign.payout_phone,
          input.grossAmount.toFixed(2),
          platformFeePct.toFixed(2),
          platformFeeAmount.toFixed(2),
          mpesaChargeAmount.toFixed(2),
          netAmount.toFixed(2),
          ctx.userId,
          input.idempotencyKey,
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
  },

  async approve(ctx: TenantContext, id: string): Promise<CampaignWithdrawalRow> {
    const row = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending campaign withdrawal', id);

      const prior = rows[0];
      await recordApproval(db, ctx, {
        subjectType: 'campaign_withdrawal',
        subjectId: id,
        initiatedBy: prior.requested_by ?? '',
        decision: 'approved',
      });

      const { rows: updated } = await db.query<CampaignWithdrawalRow>(
        `UPDATE campaign_withdrawals SET status = 'approved' WHERE id = $1 RETURNING *`,
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
          JSON.stringify({ status: 'approved' }),
        ],
      );

      return updated[0];
    });

    await dispatchCampaignWithdrawal(row.id);
    return this.getById(ctx, row.id);
  },

  async reject(ctx: TenantContext, id: string, reason: string): Promise<CampaignWithdrawalRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending campaign withdrawal', id);

      const prior = rows[0];
      await recordApproval(db, ctx, {
        subjectType: 'campaign_withdrawal',
        subjectId: id,
        initiatedBy: prior.requested_by ?? '',
        decision: 'rejected',
        reason,
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
  },

  async getById(ctx: TenantContext, id: string): Promise<CampaignWithdrawalRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<CampaignWithdrawalRow>(
        `SELECT * FROM campaign_withdrawals WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Campaign withdrawal', id);
      return rows[0];
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
      return rows;
    });
  },
};

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
 * Fires the Daraja B2C call for an 'approved' row and flips it to
 * 'processing'. Same claim-then-dispatch-then-release-on-throw shape as
 * every other outbound money path in this codebase.
 */
async function dispatchCampaignWithdrawal(id: string): Promise<void> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string;
      group_id: string;
      campaign_id: string;
      net_amount: string;
      payout_phone: string;
    }>(
      `UPDATE campaign_withdrawals
       SET    status = 'processing'
       WHERE  id = $1 AND status = 'approved'
       RETURNING id, group_id, campaign_id, net_amount, payout_phone`,
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

  const { rows: campaignRows } = await withAdminDb((db) =>
    db.query<{ title: string }>(`SELECT title FROM campaigns WHERE id = $1`, [claimed.campaign_id]),
  );
  const campaignTitle = campaignRows[0]?.title ?? 'Changi$ha campaign';

  try {
    const { initiateB2C } = await import('./daraja.service');
    const res = await initiateB2C({
      phone: claimed.payout_phone,
      amount: parseFloat(claimed.net_amount),
      commandId: 'BusinessPayment',
      occasion: `Changi$ha withdrawal — ${campaignTitle}`.slice(0, 100),
      remarks: `Changi$ha withdrawal — ${campaignTitle}`.slice(0, 100),
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
          await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${wRows[0].gross_amount}`]);
        }
      }
      await db.query(
        `UPDATE campaign_withdrawals
         SET    status = 'failed', failure_reason = $2
         WHERE  id = $1 AND status = 'processing'`,
        [id, `Dispatch error: ${String(err).slice(0, 500)}`],
      );
    });
  }
}
