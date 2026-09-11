/**
 * Shared dual-control primitive for the Bank Accounts / Settlements / Vendor
 * Payments feature. `settlement_approvals` is one table covering all three
 * subject types (bank_account, settlement, vendor_payment) — this module is
 * the single place that writes to it, so the self-approval guard and the
 * decision-recording shape exist once, not three times.
 *
 * MVP dual control is exactly one second-officer decision (maker ≠ checker),
 * not amount-tiered N-of-M — the schema (settlement_approvals allows many
 * decisions per subject) supports that later without a rewrite; each
 * feature's own approve()/reject() claims the subject row via
 * `WHERE status = 'pending_approval'` in the same transaction as the call
 * below, so a second approval attempt on an already-decided subject fails at
 * that claim, not here.
 *
 * Self-approval guard copied verbatim from disbursements.service.ts's
 * approve() — the one existing precedent for this exact rule in this
 * codebase.
 */
import type { PoolClient } from 'pg';
import type { TenantContext } from '@/lib/db';
import { ForbiddenError } from '@/lib/utils/errors';

export type SettlementSubjectType = 'bank_account' | 'settlement' | 'vendor_payment';
export type SettlementDecision    = 'approved' | 'rejected';

export interface RecordApprovalInput {
  subjectType: SettlementSubjectType;
  subjectId:   string;
  /** The row's own creator/requester — checked against ctx.userId. */
  initiatedBy: string;
  decision:    SettlementDecision;
  reason?:     string;
}

/**
 * Records one approver's decision on a subject. Throws ForbiddenError if the
 * caller is the same member who created/requested the subject. Must be
 * called inside the same transaction as the caller's own
 * `SELECT ... FOR UPDATE WHERE status = 'pending_approval'` claim, so the
 * two checks (row still pending, decision recorded) are atomic together.
 */
export async function recordApproval(
  db:   PoolClient,
  ctx:  TenantContext,
  args: RecordApprovalInput,
): Promise<void> {
  if (args.initiatedBy === ctx.userId) {
    throw new ForbiddenError(
      `Maker-checker: the initiator cannot ${args.decision === 'approved' ? 'approve' : 'reject'} their own request`,
    );
  }
  await db.query(
    `INSERT INTO settlement_approvals
       (subject_type, subject_id, group_id, approver_id, approver_kind, decision, reason)
     VALUES ($1,$2,$3,$4,'officer',$5,$6)`,
    [args.subjectType, args.subjectId, ctx.groupId, ctx.userId, args.decision, args.reason ?? null],
  );
}
