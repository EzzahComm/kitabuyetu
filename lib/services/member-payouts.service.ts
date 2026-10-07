/**
 * Group → member disbursements (migration 218).
 *
 * Workflow (enforced here AND by the migration-218 trigger):
 *
 *   chairperson | secretary  initiate()          → pending_approval  (funds reserved)
 *   treasurer (≠ initiator)  treasurerApprove()  → awaiting_platform
 *   Kitabu Yetu backoffice   platformApprove()   → M-Pesa: approved → dispatched → completed (B2C callback)
 *                                                → cash / bank: completed, in the same transaction
 *   treasurer / platform     reject*()           → rejected   (reservation released)
 *   initiator                cancel()            → cancelled  (reservation released)
 *
 * Money only ever moves through the disbursement spine (disbursements.service.ts:
 * reservation, idempotency, B2C dispatch). This module adds the governance
 * stages and the ledger side:
 *
 *   Group ledger   postMemberPayoutJournal posts the member_payout template
 *                  tagged with member_id + group_membership_id and the row's
 *                  KY-DIS reference, and links it on journal_entry_id — in the
 *                  same transaction that marks the row completed.
 *   Member ledger  the same row: computeMemberFinancialSnapshot nets completed
 *                  savings withdrawals off savings; the passbook lists it.
 *
 * getReconciliation() proves both ledgers agree payout by payout;
 * repostMissingJournals() repairs the one M-Pesa failure mode (money left but
 * the group's chart was missing an account) once the chart is fixed.
 *
 * Notifications are emitted only AFTER the owning transaction commits, and
 * the trigger engine deduplicates on (rule, disbursement id).
 */
import type { PoolClient } from 'pg';
import { withAdminDb, withDb, withTransaction, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';
import { buildTemplateLines, resolvePostingTemplate } from './posting-templates.service';
import { postSystemJournal } from './accounting.service';
import { computeB2CCharge, insertMpesaCharge } from './mpesa-charges.service';
import { IS_SANDBOX } from './mpesa-spine.service';
import { resolveMemberPayoutRecipient } from './member-balances.service';
import { getOfficerRole } from './campaign-officers.service';
import { recordApproval } from './settlement-approvals.service';
import {
  disbursementsService,
  dispatchDisbursement,
  type DisbursementRow,
  type PayoutMethod,
  type PayoutPurpose,
} from './disbursements.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';

const PURPOSE_LABEL: Record<string, string> = {
  savings_withdrawal: 'Savings withdrawal',
  merry_go_round: 'Merry-go-round payout',
  other: 'Member disbursement',
};

/** States in which a member disbursement still holds a reservation. */
const RESERVING_STATUSES = ['pending_approval', 'awaiting_platform'];

export interface InitiateMemberPayoutInput {
  memberId: string;
  amount: number;
  purpose: PayoutPurpose;
  description: string;
  notes?: string;
  paymentMethod: PayoutMethod;
  paymentReference?: string;
  idempotencyKey: string;
}

// ─── Notifications (post-commit, best-effort) ───────────────────────────────

type PayoutEvent = 'requested' | 'completed' | 'rejected';

/**
 * Emits a member-disbursement business event. Called only after the state
 * change has committed. Never throws: a notification failure must not undo or
 * mask a committed financial transaction (it is logged instead).
 */
export async function notifyMemberPayout(id: string, event: PayoutEvent, extra?: { reason?: string }): Promise<void> {
  try {
    const row = await withAdminDb(async (db) => {
      const { rows } = await db.query<{
        id: string;
        group_id: string;
        member_id: string;
        initiated_by: string;
        amount: string;
        reference: string;
        first_name: string;
        recipient_name: string;
      }>(
        `SELECT dr.id, dr.group_id, dr.member_id, dr.initiated_by, dr.amount, dr.reference,
                m.first_name, m.first_name || ' ' || m.last_name AS recipient_name
         FROM   disbursement_requests dr JOIN members m ON m.id = dr.member_id
         WHERE  dr.id = $1`,
        [id],
      );
      return rows[0];
    });
    if (!row) return;
    const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
    const { SMS_EVENTS } = await import('@/lib/sms/events');
    const eventType = {
      requested: SMS_EVENTS.MEMBER_PAYOUT_REQUESTED,
      completed: SMS_EVENTS.MEMBER_PAYOUT_COMPLETED,
      rejected: SMS_EVENTS.MEMBER_PAYOUT_REJECTED,
    }[event];
    await emitBusinessEvent({
      eventType,
      eventId: row.id,
      groupId: row.group_id,
      actorId: null,
      payload: {
        memberId: row.member_id,
        initiatorId: row.initiated_by,
        first_name: row.first_name,
        recipient_name: row.recipient_name,
        amount: parseFloat(row.amount).toLocaleString('en-KE'),
        reference: row.reference,
        reason: extra?.reason ?? null,
      },
    });
  } catch (err) {
    logger.error('[member-payouts] notification failed — financial state unaffected', {
      disbursementId: id,
      event,
      err: String(err),
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function lockMemberPayout(
  db: PoolClient,
  id: string,
  groupId: string | null,
  statuses: string[],
): Promise<DisbursementRow> {
  const { rows } = await db.query<DisbursementRow>(
    `SELECT * FROM disbursement_requests
     WHERE  id = $1 AND member_id IS NOT NULL AND ($2::uuid IS NULL OR group_id = $2)
     FOR UPDATE`,
    [id, groupId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Member disbursement', id);
  if (!statuses.includes(row.status)) {
    throw new ValidationError(`This disbursement is already ${row.status.replace(/_/g, ' ')}`);
  }
  return row;
}

async function releaseReservation(db: PoolClient, row: DisbursementRow): Promise<void> {
  // String-negate to avoid a float round-trip on a currency value.
  await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [row.cash_account_id, `-${row.amount}`]);
}

async function audit(
  db: PoolClient,
  row: DisbursementRow,
  actorId: string | null,
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, $2, $3, 'disbursement', $4, $5, $6)`,
    [row.group_id, actorId, action, row.id, JSON.stringify(before), JSON.stringify(after)],
  );
}

async function requireOffice(
  db: PoolClient,
  ctx: TenantContext,
  allowed: readonly ('chairperson' | 'secretary' | 'treasurer')[],
  action: string,
) {
  const office = await getOfficerRole(db, ctx.groupId, ctx.userId);
  if (!office || !allowed.includes(office)) {
    throw new ForbiddenError(`Only the group's ${allowed.join(' or ')} can ${action}`);
  }
  return office;
}

// ─── Workflow ───────────────────────────────────────────────────────────────

export const memberPayoutsService = {
  /** Chairperson or secretary submits a disbursement; funds are reserved and it waits for the treasurer. */
  async initiate(ctx: TenantContext, input: InitiateMemberPayoutInput): Promise<DisbursementRow> {
    const office = await withDb(ctx, (db) =>
      requireOffice(db, ctx, ['chairperson', 'secretary'], 'initiate a member disbursement'),
    );
    if (input.paymentMethod === 'bank_transfer' && !input.paymentReference?.trim()) {
      throw new ValidationError('A bank transfer needs the payee account / transfer reference');
    }

    const row = await disbursementsService.initiateDisbursement(ctx, {
      member: {
        memberId: input.memberId,
        purpose: input.purpose,
        description: input.description.trim(),
        notes: input.notes?.trim() || null,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference?.trim() || null,
        initiatorRole: office as 'chairperson' | 'secretary',
      },
      amount: input.amount,
      // Daraja's Occasion field: 100 chars max.
      occasion: input.description.trim().slice(0, 100),
      commandId: 'BusinessPayment',
      idempotencyKey: input.idempotencyKey,
    });
    await notifyMemberPayout(row.id, 'requested');
    return row;
  },

  /** Treasurer's approval — hands the disbursement to Kitabu Yetu for sign-off. */
  async treasurerApprove(ctx: TenantContext, id: string): Promise<DisbursementRow> {
    return withTransaction(ctx, async (db) => {
      const prior = await lockMemberPayout(db, id, ctx.groupId, ['pending_approval']);
      await requireOffice(db, ctx, ['treasurer'], 'approve a member disbursement');
      const recipient = await resolveMemberPayoutRecipient(db, ctx.groupId, prior.member_id as string);
      if (!recipient) throw new ValidationError('The recipient is no longer an active member of this group');

      // Maker-checker: recordApproval refuses the initiator.
      await recordApproval(db, ctx, {
        subjectType: 'member_payout',
        subjectId: id,
        initiatedBy: prior.initiated_by,
        decision: 'approved',
        approverRole: 'treasurer',
      });
      const { rows } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'awaiting_platform', approved_by = $2, approved_at = NOW()
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId],
      );
      await audit(
        db,
        prior,
        ctx.userId,
        'member_payout.treasurer_approve',
        { status: prior.status },
        {
          status: 'awaiting_platform',
        },
      );
      return rows[0];
    });
  },

  /** Treasurer rejects: reservation released, initiator told. */
  async treasurerReject(ctx: TenantContext, id: string, reason: string): Promise<DisbursementRow> {
    const row = await withTransaction(ctx, async (db) => {
      const prior = await lockMemberPayout(db, id, ctx.groupId, ['pending_approval']);
      await requireOffice(db, ctx, ['treasurer'], 'reject a member disbursement');
      await recordApproval(db, ctx, {
        subjectType: 'member_payout',
        subjectId: id,
        initiatedBy: prior.initiated_by,
        decision: 'rejected',
        reason,
        approverRole: 'treasurer',
      });
      await releaseReservation(db, prior);
      const { rows } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'rejected', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId, reason],
      );
      await audit(
        db,
        prior,
        ctx.userId,
        'member_payout.treasurer_reject',
        { status: prior.status },
        {
          status: 'rejected',
          reason,
        },
      );
      return rows[0];
    });
    await notifyMemberPayout(id, 'rejected', { reason });
    return row;
  },

  /** The initiator withdraws their own request before any money moves. */
  async cancel(ctx: TenantContext, id: string): Promise<DisbursementRow> {
    return withTransaction(ctx, async (db) => {
      const prior = await lockMemberPayout(db, id, ctx.groupId, RESERVING_STATUSES);
      if (prior.initiated_by !== ctx.userId) {
        throw new ForbiddenError('Only the officer who initiated this disbursement can cancel it');
      }
      await releaseReservation(db, prior);
      const { rows } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'cancelled', cancelled_by = $2, cancelled_at = NOW()
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId],
      );
      await audit(db, prior, ctx.userId, 'member_payout.cancel', { status: prior.status }, { status: 'cancelled' });
      return rows[0];
    });
  },

  /**
   * Kitabu Yetu's sign-off (super-admin). M-Pesa: released for B2C dispatch;
   * the ledgers post on Safaricom's result callback. Cash / bank transfer:
   * executed here — group journal, member ledger, reservation release and
   * 'completed' commit together or not at all.
   */
  async platformApprove(adminUserId: string, id: string): Promise<DisbursementRow> {
    const row = await withAdminDb(async (db) => {
      const prior = await lockMemberPayout(db, id, null, ['awaiting_platform']);
      const recipient = await resolveMemberPayoutRecipient(db, prior.group_id, prior.member_id as string);
      if (!recipient) throw new ValidationError('The recipient is no longer an active member of the group');

      await db.query(
        `INSERT INTO settlement_approvals (subject_type, subject_id, group_id, approver_id, approver_kind, decision)
         VALUES ('member_payout', $1, $2, $3, 'backoffice', 'approved')`,
        [id, prior.group_id, adminUserId],
      );

      if (prior.payment_method === 'mpesa') {
        const { rows } = await db.query<DisbursementRow>(
          `UPDATE disbursement_requests
           SET    status = 'approved', platform_approved_by = $2, platform_approved_at = NOW()
           WHERE  id = $1 RETURNING *`,
          [id, adminUserId],
        );
        await audit(
          db,
          prior,
          null,
          'member_payout.platform_approve',
          { status: prior.status },
          {
            status: 'approved',
            platform_approved_by: adminUserId,
          },
        );
        return rows[0];
      }

      // Cash / bank: final balance check against the source account, which
      // already carries this payout's own reservation.
      const { rows: acct } = await db.query<{ balance: string; reserved_amount: string }>(
        `SELECT balance, reserved_amount FROM accounts WHERE id = $1 FOR UPDATE`,
        [prior.cash_account_id],
      );
      if (!acct[0] || parseFloat(acct[0].balance) - parseFloat(acct[0].reserved_amount) < 0) {
        throw new ValidationError('Insufficient group funds to execute this disbursement');
      }

      const posted = await postMemberPayoutJournal(db, {
        disbursementRequestId: id,
        charge: 0,
        receipt: null,
        mpesaTransactionId: null,
        strict: true,
      });
      if (posted !== 'posted') throw new ValidationError('Ledger posting failed — nothing was recorded');

      await releaseReservation(db, prior);
      const { rows } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'completed', completed_at = NOW(),
                platform_approved_by = $2, platform_approved_at = NOW()
         WHERE  id = $1 RETURNING *`,
        [id, adminUserId],
      );
      await audit(
        db,
        prior,
        null,
        'member_payout.platform_approve',
        { status: prior.status },
        {
          status: 'completed',
          platform_approved_by: adminUserId,
          journal_entry_id: rows[0].journal_entry_id,
        },
      );
      return rows[0];
    });

    if (row.status === 'approved') {
      await dispatchDisbursement(row.id);
    } else {
      await notifyMemberPayout(row.id, 'completed');
    }
    return row;
  },

  /** Kitabu Yetu declines: reservation released, initiator told. */
  async platformReject(adminUserId: string, id: string, reason: string): Promise<DisbursementRow> {
    if (!reason.trim()) throw new ValidationError('A reason is required to decline a disbursement');
    const row = await withAdminDb(async (db) => {
      const prior = await lockMemberPayout(db, id, null, ['awaiting_platform']);
      await db.query(
        `INSERT INTO settlement_approvals
           (subject_type, subject_id, group_id, approver_id, approver_kind, decision, reason)
         VALUES ('member_payout', $1, $2, $3, 'backoffice', 'rejected', $4)`,
        [id, prior.group_id, adminUserId, reason],
      );
      await releaseReservation(db, prior);
      const { rows } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'rejected', rejected_at = NOW(), rejection_reason = $2
         WHERE  id = $1 RETURNING *`,
        [id, `Declined by Kitabu Yetu: ${reason}`],
      );
      await audit(
        db,
        prior,
        null,
        'member_payout.platform_reject',
        { status: prior.status },
        {
          status: 'rejected',
          reason,
          platform_user: adminUserId,
        },
      );
      return rows[0];
    });
    await notifyMemberPayout(id, 'rejected', { reason: `Declined by Kitabu Yetu: ${reason}` });
    return row;
  },

  /** Kitabu Yetu's queue: member disbursements every group's treasurer has approved, oldest first. */
  async listAwaitingPlatform() {
    return withAdminDb(async (db) => {
      const { rows } = await db.query(
        `SELECT dr.id, dr.reference, dr.group_id, g.name AS group_name, dr.amount, dr.payment_method,
                dr.payment_reference, dr.payout_purpose, dr.purpose_description, dr.phone,
                m.first_name || ' ' || m.last_name AS recipient_name, gm.membership_no AS recipient_membership_no,
                im.first_name || ' ' || im.last_name AS initiated_by_name, dr.initiated_by_role,
                am.first_name || ' ' || am.last_name AS approved_by_name, dr.approved_at, dr.created_at
         FROM   disbursement_requests dr
         JOIN   groups g   ON g.id = dr.group_id
         JOIN   members m  ON m.id = dr.member_id
         LEFT JOIN group_members gm ON gm.id = dr.group_membership_id
         LEFT JOIN members im ON im.id = dr.initiated_by
         LEFT JOIN members am ON am.id = dr.approved_by
         WHERE  dr.member_id IS NOT NULL AND dr.status::text = 'awaiting_platform'
         ORDER  BY dr.approved_at ASC NULLS LAST`,
      );
      return rows;
    });
  },

  /** Full review record: the disbursement, its financial impact and its audit trail. */
  async getDetail(ctx: TenantContext, id: string) {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<
        DisbursementRow & {
          recipient_name: string;
          recipient_membership_no: string | null;
          initiated_by_name: string | null;
          approved_by_name: string | null;
          source_balance: string;
          source_reserved: string;
          source_account_code: string;
        }
      >(
        `SELECT dr.*, m.first_name || ' ' || m.last_name AS recipient_name,
                gm.membership_no AS recipient_membership_no,
                im.first_name || ' ' || im.last_name AS initiated_by_name,
                am.first_name || ' ' || am.last_name AS approved_by_name,
                a.balance AS source_balance, a.reserved_amount AS source_reserved,
                a.account_code AS source_account_code
         FROM   disbursement_requests dr
         JOIN   members m ON m.id = dr.member_id
         LEFT JOIN group_members gm ON gm.id = dr.group_membership_id
         LEFT JOIN members im ON im.id = dr.initiated_by
         LEFT JOIN members am ON am.id = dr.approved_by
         JOIN   accounts a ON a.id = dr.cash_account_id
         WHERE  dr.id = $1 AND dr.group_id = $2 AND dr.member_id IS NOT NULL`,
        [id, ctx.groupId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundError('Member disbursement', id);

      const recipient = await resolveMemberPayoutRecipient(db, ctx.groupId, row.member_id as string);
      const { rows: history } = await db.query<{
        action: string;
        actor_name: string | null;
        old_values: unknown;
        new_values: unknown;
        created_at: string;
      }>(
        `SELECT al.action, m.first_name || ' ' || m.last_name AS actor_name,
                al.old_values, al.new_values, al.created_at
         FROM   audit_logs al LEFT JOIN members m ON m.id = al.actor_id
         WHERE  al.group_id = $1 AND al.resource_id = $2
           AND  al.resource_type IN ('disbursement', 'disbursement_request')
         ORDER  BY al.created_at ASC`,
        [ctx.groupId, id],
      );

      const amount = parseFloat(row.amount);
      const reserving = RESERVING_STATUSES.includes(row.status);
      // "Current" excludes this payout's own hold, so before − amount = after.
      const available = parseFloat(row.source_balance) - parseFloat(row.source_reserved) + (reserving ? amount : 0);
      return {
        payout: row,
        impact: {
          sourceAccountCode: row.source_account_code,
          groupAvailableBefore: Math.round(available * 100) / 100,
          groupAvailableAfter: Math.round((available - amount) * 100) / 100,
          memberWithdrawable: recipient?.withdrawableSavings ?? null,
          reducesSavings: row.payout_purpose === 'savings_withdrawal',
        },
        history,
      };
    });
  },
};

// ─── Group ledger posting ───────────────────────────────────────────────────

export type MemberPayoutPostResult = 'not_member_payout' | 'already_posted' | 'posted' | 'skipped';

/**
 * Posts the group journal for a member disbursement whose money has left.
 * Safe for any disbursement request: returns 'not_member_payout' for loan
 * rows, and is idempotent (row lock + journal_entry_id check) so a replayed
 * callback or a repost never double-posts.
 *
 * Bank-transfer payouts credit 1002 instead of the template's cash account.
 * `charge` (Safaricom's B2C fee) is folded into the same entry; when the chart
 * can't take it the payout still posts and the fee is recorded unlinked,
 * matching postLoanDisbursementJournal. With `strict`, a missing account
 * throws so the caller's transaction rolls back (cash/bank execution).
 */
export async function postMemberPayoutJournal(
  db: PoolClient,
  args: {
    disbursementRequestId: string;
    charge: number;
    receipt: string | null;
    mpesaTransactionId: string | null;
    strict?: boolean;
  },
): Promise<MemberPayoutPostResult> {
  const { rows } = await db.query<{
    id: string;
    group_id: string;
    member_id: string | null;
    group_membership_id: string | null;
    payout_purpose: string | null;
    purpose_description: string | null;
    payment_method: string | null;
    amount: string;
    initiated_by: string;
    journal_entry_id: string | null;
    reference: string;
  }>(
    `SELECT id, group_id, member_id, group_membership_id, payout_purpose, purpose_description, payment_method,
            amount, initiated_by, journal_entry_id, reference
     FROM   disbursement_requests
     WHERE  id = $1
     FOR UPDATE`,
    [args.disbursementRequestId],
  );
  const row = rows[0];
  if (!row || !row.member_id) return 'not_member_payout';
  if (row.journal_entry_id) return 'already_posted';

  const amount = parseFloat(row.amount);
  const label = PURPOSE_LABEL[row.payout_purpose ?? 'other'] ?? 'Member disbursement';
  const description = [label, row.purpose_description, args.receipt ? `M-Pesa ${args.receipt}` : null]
    .filter(Boolean)
    .join(' — ');

  const template = await resolvePostingTemplate(db, 'member_payout', { groupId: row.group_id });
  const post = async (charge: number) => {
    let lines = buildTemplateLines(template, { amount, charge });
    if (row.payment_method === 'bank_transfer') {
      lines = lines.map((l) => (l.credit ? { ...l, accountCode: '1002' } : l));
    }
    return postSystemJournal(db, row.group_id, row.initiated_by, description, lines, {
      reference: row.reference,
      memberId: row.member_id as string,
      groupMembershipId: row.group_membership_id ?? undefined,
      isTest: row.payment_method === 'mpesa' ? IS_SANDBOX : false,
    });
  };

  let chargePosted = args.charge > 0;
  let jeId = await post(args.charge);
  if (!jeId && args.charge > 0) {
    chargePosted = false;
    jeId = await post(0);
  }

  if (args.charge > 0 && args.mpesaTransactionId) {
    await insertMpesaCharge(db, {
      groupId: row.group_id,
      mpesaTransactionId: args.mpesaTransactionId,
      chargeType: 'b2c',
      amount: args.charge,
      journalEntryId: chargePosted ? jeId : null,
    });
  }

  if (!jeId) {
    if (args.strict) {
      throw new ValidationError(
        "The group's chart of accounts is missing an account the member_payout posting needs — nothing was recorded",
      );
    }
    // postSystemJournal already logged which codes are missing. The payout
    // stays journal_entry_id = NULL, which reconciliation surfaces.
    logger.error('[member-payouts] payout completed but journal not posted', {
      disbursementRequestId: row.id,
      groupId: row.group_id,
    });
    return 'skipped';
  }

  await db.query(`UPDATE disbursement_requests SET journal_entry_id = $1 WHERE id = $2`, [jeId, row.id]);
  await db.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, NULL, 'member_payout.journal_posted', 'disbursement', $2, $3, $4)`,
    [
      row.group_id,
      row.id,
      JSON.stringify({ journal_entry_id: null }),
      JSON.stringify({
        journal_entry_id: jeId,
        reference: row.reference,
        amount: row.amount,
        charge_posted: chargePosted,
      }),
    ],
  );
  return 'posted';
}

// ─── Reconciliation ─────────────────────────────────────────────────────────

export type ReconciliationIssue = 'missing_journal' | 'journal_voided' | 'amount_mismatch' | 'outcome_unknown';

export interface ReconciliationItem {
  id: string;
  reference: string;
  memberId: string;
  memberName: string;
  purpose: string;
  amount: number;
  status: string;
  receipt: string | null;
  journalEntryId: string | null;
  postedAmount: number | null;
  issue: ReconciliationIssue | null;
  completedAt: string | null;
}

export interface PayoutReconciliation {
  completed: { count: number; total: number };
  postedToLedger: { count: number; total: number };
  inFlight: { count: number; total: number };
  reconciled: boolean;
  issues: ReconciliationItem[];
}

interface ReconRow {
  id: string;
  reference: string;
  member_id: string;
  member_name: string;
  payout_purpose: string;
  amount: string;
  status: string;
  mpesa_receipt_number: string | null;
  journal_entry_id: string | null;
  journal_status: string | null;
  journal_member_id: string | null;
  posted_amount: string | null;
  reconciled_at: string | null;
  completed_at: string | null;
}

function classify(r: ReconRow): ReconciliationIssue | null {
  if (r.status === 'timed_out' && !r.reconciled_at) return 'outcome_unknown';
  if (r.status !== 'completed') return null;
  if (!r.journal_entry_id) return 'missing_journal';
  if (r.journal_status !== 'posted') return 'journal_voided';
  if (
    r.journal_member_id !== r.member_id ||
    Math.abs(parseFloat(r.posted_amount ?? '0') - parseFloat(r.amount)) > 0.005
  ) {
    return 'amount_mismatch';
  }
  return null;
}

/**
 * Per-payout proof that the group ledger and the member ledger agree: every
 * completed member disbursement must have a posted journal attributed to the
 * same member whose payout lines (total debits less the linked B2C fee) equal
 * what the member was paid.
 */
export async function getReconciliation(ctx: TenantContext): Promise<PayoutReconciliation> {
  return withDb(ctx, async (db) => {
    const { rows } = await db.query<ReconRow>(
      `SELECT dr.id, dr.reference, dr.member_id, m.first_name || ' ' || m.last_name AS member_name,
              dr.payout_purpose, dr.amount, dr.status::text AS status, dr.mpesa_receipt_number,
              dr.journal_entry_id, je.status::text AS journal_status, je.member_id AS journal_member_id,
              (SELECT COALESCE(SUM(jl.debit), 0) FROM journal_lines jl WHERE jl.journal_entry_id = je.id)
                - COALESCE((SELECT SUM(mc.amount) FROM mpesa_charges mc WHERE mc.journal_entry_id = je.id), 0)
                AS posted_amount,
              dr.reconciled_at, dr.completed_at
       FROM   disbursement_requests dr
       JOIN   members m ON m.id = dr.member_id
       LEFT JOIN journal_entries je ON je.id = dr.journal_entry_id
       WHERE  dr.group_id = $1 AND dr.member_id IS NOT NULL
         AND  dr.status::text IN ('pending_approval', 'awaiting_platform', 'approved', 'dispatched', 'completed', 'timed_out')
       ORDER  BY dr.created_at DESC`,
      [ctx.groupId],
    );

    const sum = (rs: ReconRow[]) => ({
      count: rs.length,
      total: Math.round(rs.reduce((a, r) => a + parseFloat(r.amount), 0) * 100) / 100,
    });
    const completed = rows.filter((r) => r.status === 'completed');
    const posted = completed.filter((r) => classify(r) === null);
    const inFlight = rows.filter((r) =>
      ['pending_approval', 'awaiting_platform', 'approved', 'dispatched'].includes(r.status),
    );
    const issues = rows
      .map((r) => ({ r, issue: classify(r) }))
      .filter((x) => x.issue !== null)
      .map(({ r, issue }) => ({
        id: r.id,
        reference: r.reference,
        memberId: r.member_id,
        memberName: r.member_name,
        purpose: r.payout_purpose,
        amount: parseFloat(r.amount),
        status: r.status,
        receipt: r.mpesa_receipt_number,
        journalEntryId: r.journal_entry_id,
        postedAmount: r.posted_amount != null && r.journal_entry_id ? parseFloat(r.posted_amount) : null,
        issue,
        completedAt: r.completed_at,
      }));

    return {
      completed: sum(completed),
      postedToLedger: sum(posted),
      inFlight: sum(inFlight),
      reconciled: issues.length === 0,
      issues,
    };
  });
}

/**
 * Posts the journal for every completed member disbursement in the group that
 * has none — only possible on the M-Pesa path, where the money has already
 * left when the callback lands. A voided or mismatched journal needs an
 * accountant, not an automatic re-post. Idempotent per row.
 */
export async function repostMissingJournals(ctx: TenantContext): Promise<{ posted: number; skipped: number }> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string;
      amount: string;
      mpesa_receipt_number: string | null;
      mpesa_transaction_id: string | null;
      existing_charge: string | null;
    }>(
      `SELECT dr.id, dr.amount, dr.mpesa_receipt_number, b.mpesa_transaction_id,
              (SELECT mc.amount FROM mpesa_charges mc WHERE mc.mpesa_transaction_id = b.mpesa_transaction_id)
                AS existing_charge
       FROM   disbursement_requests dr
       LEFT JOIN mpesa_b2c_transactions b ON b.id = dr.b2c_transaction_id
       WHERE  dr.group_id = $1 AND dr.member_id IS NOT NULL
         AND  dr.status = 'completed' AND dr.journal_entry_id IS NULL`,
      [ctx.groupId],
    );

    let posted = 0;
    let skipped = 0;
    for (const r of rows) {
      // A fee already recorded (unlinked) for this transaction is left as is
      // rather than booked a second time; otherwise price it from the tiers.
      const charge =
        r.existing_charge != null || !r.mpesa_transaction_id ? 0 : await computeB2CCharge(db, parseFloat(r.amount));
      const result = await postMemberPayoutJournal(db, {
        disbursementRequestId: r.id,
        charge,
        receipt: r.mpesa_receipt_number,
        mpesaTransactionId: r.mpesa_transaction_id,
      });
      if (result === 'posted') posted++;
      else if (result === 'skipped') skipped++;
    }

    if (posted > 0) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, 'member_payout.reconcile', 'group', $1, NULL, $3)`,
        [ctx.groupId, ctx.userId, JSON.stringify({ posted, skipped })],
      );
    }
    return { posted, skipped };
  });
}

// ─── Pre-flight for the disbursement form ───────────────────────────────────

export interface PayoutEligibility {
  memberId: string;
  memberName: string;
  phone: string | null;
  withdrawableSavings: number;
  /** Available (balance − reserved) per source: 1001 for M-Pesa/cash, 1002 for bank. */
  available: { cash: number; bank: number | null };
}

/**
 * What the form shows before the officer commits. Advisory only —
 * initiateDisbursement re-checks both ceilings under the account lock, and
 * cash/bank execution re-checks the balance at Kitabu Yetu's sign-off.
 */
export async function getPayoutEligibility(ctx: TenantContext, memberId: string): Promise<PayoutEligibility> {
  return withDb(ctx, async (db) => {
    const recipient = await resolveMemberPayoutRecipient(db, ctx.groupId, memberId);
    if (!recipient) throw new NotFoundError('Active group member', memberId);

    const { rows } = await db.query<{ account_code: string; balance: string; reserved_amount: string }>(
      `SELECT account_code, balance, reserved_amount FROM accounts
       WHERE group_id = $1 AND account_code IN ('1001', '1002') AND is_active = true`,
      [ctx.groupId],
    );
    const avail = (code: string) => {
      const a = rows.find((r) => r.account_code === code);
      return a ? Math.max(0, parseFloat(a.balance) - parseFloat(a.reserved_amount)) : null;
    };

    return {
      memberId: recipient.memberId,
      memberName: recipient.fullName,
      phone: recipient.phone,
      withdrawableSavings: recipient.withdrawableSavings,
      available: { cash: avail('1001') ?? 0, bank: avail('1002') },
    };
  });
}
