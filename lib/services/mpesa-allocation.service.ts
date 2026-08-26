/**
 * Shared product-allocation/dispatch engine (payment architecture §3.5,
 * decision table A1–A9), used by BOTH the STK and C2B fulfilment flows —
 * `applyLoanRepayment`/`applyLoanWaterfall` are invoked from
 * mpesa-stk.service.ts's fulfilment path and mpesa-c2b.service.ts's
 * dispatch/legacy-grammar paths alike. Split out of mpesa.service.ts
 * (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { logger } from '@/lib/logger';
import { parseBillRefNumber, isSandboxTestRef, type RoutingDecision } from '@/lib/utils/mpesa-bill-ref';
import type { ProductSuffix } from '@/lib/utils/membership-no';
import { resolveProduct, type PaymentProduct, type ResolvedProduct } from '@/lib/utils/allocation-engine';
import { findOpenRequests, fulfilRequest } from './payment-requests.service';
import { postContributionJournal } from './accounting.service';
import { postLoanRepaymentJournal } from './posting-templates.service';
import { IS_SANDBOX, markSpineAllocated, markSpineUnrouted, spinePaymentId, logPaymentEvent } from './mpesa-spine.service';
import type { PaymentAccountHit } from './mpesa-payment-accounts.service';

export interface StkRequestRow {
  id:                 string;
  group_id:           string;
  purpose:            string | null;
  invoice_id:         string | null;
  loan_repayment_id:  string | null;
  account_reference:  string;
  amount:             string;
  /** Set only when purpose = 'subscription' (migration 138). */
  plan_type:          string | null;
  product:            string | null;
  /** Migration 155. NULL on any pre-155 row or a client that omitted it —
   *  the reader treats that as 'monthly', never as an error. */
  billing_cycle:      string | null;
}

export interface FulfilmentInput {
  receipt:  string;
  amount:   number;
  phone:    string;
  rawBody:  string;
}

/**
 * Latch the oldest open exact-amount request for (membership, product) as
 * fulfilled — used by STK fulfilment, where the request was created by the
 * initiation itself. No-op when none matches.
 */
export async function fulfilMatchingRequest(
  db:       PoolClient,
  groupId:  string,
  memberId: string,
  product:  PaymentProduct,
  amount:   number,
  receipt:  string,
): Promise<void> {
  await db.query(
    `UPDATE payment_requests pr
     SET    status = 'fulfilled',
            fulfilled_by_payment = (SELECT id FROM payments WHERE mpesa_receipt_number = $5)
     WHERE  pr.id = (
       SELECT pr2.id FROM payment_requests pr2
       JOIN   group_members gm ON gm.id = pr2.group_membership_id
       WHERE  gm.group_id = $1 AND gm.member_id = $2
         AND  pr2.product = $3::payment_product
         AND  pr2.status = 'open'
         AND  pr2.amount = $4
         AND  (pr2.expires_at IS NULL OR pr2.expires_at > NOW())
       ORDER  BY pr2.created_at
       LIMIT  1
     )`,
    [groupId, memberId, product, amount.toFixed(2), receipt],
  );
}

export async function applyLoanRepayment(
  db:     PoolClient,
  stkReq: StkRequestRow,
  in_:    FulfilmentInput,
): Promise<void> {
  // Partial semantics (ADR-15): the payment flows through the member's loan
  // waterfall with the pre-bound installment first. An amount short of the
  // installment leaves it 'partially_paid' — never 'completed' short — and
  // any excess cascades to later installments, then savings.
  const { rows } = await db.query<{ member_id: string }>(
    `SELECT member_id FROM loan_repayments WHERE id = $1`,
    [stkReq.loan_repayment_id],
  );
  if (!rows[0]) return;

  await applyLoanWaterfall(db, {
    product: 'loan_repayment', requestId: null, amountVariance: false,
    tier: 'stk_bound', obligationsOnly: false,
    groupId:  stkReq.group_id,
    memberId: rows[0].member_id,
    fulfil: {
      groupId: stkReq.group_id,
      route:   parseBillRefNumber(stkReq.account_reference),
      receipt: in_.receipt,
      amount:  in_.amount,
      phone:   in_.phone,
      billRef: stkReq.account_reference,
      rawBody: in_.rawBody,
    },
    thirdPartyPhone:   null,
    preferRepaymentId: stkReq.loan_repayment_id,
  });
}

/**
 * Records a receipt that the auto-router couldn't bind to a domain entity.
 * Treasurer-resolved later via /mpesa/unrouted.
 */
export async function routeToUnrouted(
  db:     PoolClient,
  stkReq: StkRequestRow | null,
  in_:    FulfilmentInput,
  opts:   {
    reason: 'unknown_member' | 'unknown_group' | 'unknown_prefix' |
            'ambiguous_member' | 'no_account_ref' | 'amount_mismatch' |
            'membership_inactive' | 'bad_account' | 'other';
    candidateGroupId?: string | null;
    billRef?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO mpesa_unrouted
       (mpesa_transaction_id, receipt, phone, amount, bill_ref,
        reason, raw_payload, candidate_group_id)
     SELECT t.id, $1, $2, $3, $4, $5, $6::jsonb, $7
     FROM   mpesa_stk_requests s
     LEFT JOIN mpesa_transactions t ON t.id = s.mpesa_transaction_id
     WHERE  s.id = $8
     ON CONFLICT (receipt) DO NOTHING`,
    [
      in_.receipt,
      in_.phone,
      in_.amount.toFixed(2),
      opts.billRef ?? stkReq?.account_reference ?? null,
      opts.reason,
      in_.rawBody,
      opts.candidateGroupId ?? null,
      stkReq?.id ?? null,
    ],
  );
  logger.warn('[mpesa] routed to unrouted queue', {
    receipt: in_.receipt,
    reason:  opts.reason,
    phone:   in_.phone,
  });
  await markSpineUnrouted(db, in_.receipt, opts.reason);
}

// ─── Product allocation (payment architecture §3.5, decision table A1–A9) ───

/**
 * Gathers the allocation-engine inputs for a membership (open requests,
 * member/group defaults) and runs the pure decision table.
 */
export async function resolveProductForMembership(
  db:     PoolClient,
  hit:    PaymentAccountHit,
  suffix: ProductSuffix | null,
  amount: number,
): Promise<ResolvedProduct> {
  const [openRequests, defaults] = await Promise.all([
    findOpenRequests(db, hit.membershipId!),
    db.query<{ member_default: PaymentProduct | null; group_default: PaymentProduct }>(
      `SELECT gm.default_product AS member_default, g.default_product AS group_default
       FROM   group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE  gm.id = $1`,
      [hit.membershipId],
    ).then((r) => r.rows[0]),
  ]);

  return resolveProduct({
    suffix,
    openRequests,
    memberDefault: defaults?.member_default ?? null,
    groupDefault:  defaults?.group_default ?? 'savings',
    amount,
  });
}

/** Member has anything collectible on a loan (obligations, §4.1). */
export async function hasDueInstallments(
  db: PoolClient, groupId: string, memberId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM loan_repayments
     WHERE  group_id = $1 AND member_id = $2
       AND  status IN ('pending','partially_paid','overdue')
     LIMIT  1`,
    [groupId, memberId],
  );
  return !!rows[0];
}

export type EligibilityGate = 'allow' | 'force_loan' | 'reject';

/**
 * §4.1 per-state payment behaviour:
 *   active               → all products
 *   suspended / inactive → obligations only: force loan repayment when due
 *                          installments exist, otherwise reject
 *   everything else      → reject (exited/blacklisted/rejected/archived/
 *                          pending_verification, suspended registry rows,
 *                          platform-locked accounts)
 */
export async function eligibilityGate(
  db:      PoolClient,
  hit:     PaymentAccountHit,
  product: PaymentProduct,
): Promise<EligibilityGate> {
  if (hit.accountStatus !== 'active' || hit.memberActive !== true) return 'reject';
  if (hit.membershipStatus === 'active') return 'allow';
  if (hit.membershipStatus === 'suspended' || hit.membershipStatus === 'inactive') {
    if (!(await hasDueInstallments(db, hit.groupId!, hit.memberId!))) return 'reject';
    return product === 'loan_repayment' ? 'allow' : 'force_loan';
  }
  return 'reject';
}

export interface C2BFulfilmentInput {
  groupId:  string;
  route:    RoutingDecision;
  receipt:  string;
  amount:   number;
  phone:    string;
  billRef:  string;
  rawBody:  string;
}

export interface DispatchArgs {
  product:         PaymentProduct;
  requestId:       string | null;
  amountVariance:  boolean;
  tier:            string;
  /** Suspended/inactive membership — loan waterfall only, no savings leftover. */
  obligationsOnly: boolean;
  groupId:         string;
  memberId:        string;
  fulfil:          C2BFulfilmentInput;
  thirdPartyPhone: string | null;
  /** Loan waterfall: try this installment first (STK pre-bound repayments). */
  preferRepaymentId?: string | null;
}

/**
 * Dispatch to the owning product table — never a blanket insert into
 * contributions (§3.5 dispatch table; audit H-3).
 */
export async function dispatchProduct(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;

  switch (args.product) {
    case 'savings':
      await applyContributionFromC2B(db, {
        ...fulfil,
        memberId:        args.memberId,
        thirdPartyPhone: args.thirdPartyPhone,
      });
      break;

    case 'welfare':
      await applyWelfareFromC2B(db, args);
      break;

    case 'loan_repayment':
      await applyLoanWaterfall(db, args);
      break;

    case 'share':
      // Shares need a class + unit price — auto-purchasing would be a guess.
      // Treasurer confirms via the unrouted queue (documented Phase 2 limit).
      await c2bToUnrouted(db, fulfil, 'other');
      break;

    default:
      // A9: a product with no registered handler is a configuration error —
      // page loudly, never silently fall back to savings.
      logger.error('[mpesa/allocation] no handler for product (config_error)', {
        product: args.product, receipt: fulfil.receipt, groupId: args.groupId,
      });
      await c2bToUnrouted(db, fulfil, 'other');
      return;
  }

  // Latch the driving request as fulfilled (no-op when none / already closed).
  if (args.requestId) {
    await fulfilRequest(db, args.requestId, await spinePaymentId(db, fulfil.receipt));
  }
}

/** Auto-routed PayBill welfare contribution (§3.5 dispatch; audit H-3). */
export async function applyWelfareFromC2B(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;
  const note = `Auto-routed from PayBill ${fulfil.billRef} [${args.tier}]`
    + (args.thirdPartyPhone ? ` (third-party payer ${args.thirdPartyPhone})` : '');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO welfare_pool_contributions
       (group_id, member_id, group_membership_id, amount, contribution_type, payment_method,
        mpesa_receipt_number, period_month, period_year, notes, payment_id)
     VALUES ($1,$2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3,'regular','mpesa',$4,
             EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
             EXTRACT(YEAR  FROM CURRENT_DATE)::smallint,
             $5,
             (SELECT id FROM payments WHERE mpesa_receipt_number = $4))
     ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [args.groupId, args.memberId, fulfil.amount.toFixed(2), fulfil.receipt, note],
  );
  if (!rows[0]) return; // replay — already recorded

  // Parity note: the manual welfare-recording path posts no journal either;
  // welfare ledger integration is tracked with the welfare module itself.
  await markSpineAllocated(db, fulfil.receipt, {
    isThirdParty: !!args.thirdPartyPhone,
    detail: { product: 'welfare', welfareContributionId: rows[0].id,
              groupId: args.groupId, tier: args.tier,
              ...(args.amountVariance ? { amountVariance: true } : {}) },
  });
}

/**
 * Apply an amount to one installment with partial semantics (ADR-15):
 * running amount_paid; 'completed' ONLY at full satisfaction, else
 * 'partially_paid'. Returns how much was absorbed.
 */
export async function applyPartialRepayment(
  db:           PoolClient,
  repaymentId:  string,
  amount:       number,
  receipt:      string,
  stampReceipt: boolean,
): Promise<{ applied: number; loanId: string; principalPortion: number; interestPortion: number } | null> {
  const { rows } = await db.query<{
    id: string; loan_id: string; total_due: string; amount_paid: string;
    principal_component: string; interest_component: string;
  }>(
    `SELECT id, loan_id, total_due, amount_paid, principal_component, interest_component
     FROM   loan_repayments
     WHERE  id = $1 AND status IN ('pending','partially_paid','overdue')
     FOR UPDATE`,
    [repaymentId],
  );
  const row = rows[0];
  if (!row) return null;

  const remaining = parseFloat(row.total_due) - parseFloat(row.amount_paid);
  const applied   = Math.min(amount, remaining);
  if (applied <= 0) return null;

  await db.query(
    `UPDATE loan_repayments
     SET    amount_paid    = amount_paid + $2,
            payment_date   = CURRENT_DATE,
            payment_method = 'mpesa',
            mpesa_receipt_number = CASE WHEN $4 THEN COALESCE(mpesa_receipt_number, $3)
                                        ELSE mpesa_receipt_number END,
            status = CASE WHEN amount_paid + $2 + 0.005 >= total_due
                          THEN 'completed'::contribution_status
                          ELSE 'partially_paid'::contribution_status END
     WHERE  id = $1`,
    [repaymentId, applied.toFixed(2), receipt, stampReceipt],
  );

  // This installment's cash may be a partial amount (waterfall segments can
  // split across installments), so the GL split is proportional to this
  // installment's own scheduled principal:interest ratio — the standard
  // treatment for a partial payment, and the only way the posted entry can
  // balance against the actual cash applied rather than the full schedule.
  const principalComponent = parseFloat(row.principal_component);
  const interestComponent  = parseFloat(row.interest_component);
  const scheduledTotal     = principalComponent + interestComponent;
  const principalPortion   = scheduledTotal > 0 ? round2(applied * (principalComponent / scheduledTotal)) : applied;
  const interestPortion    = round2(applied - principalPortion);

  return { applied, loanId: row.loan_id, principalPortion, interestPortion };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Loan-repayment waterfall (§3.5): the amount flows across the member's due
 * installments oldest-first; any excess falls to the next tier (savings) —
 * never a negative receivable. Obligations-only memberships (§4.1) get no
 * savings leftover: the excess parks unrouted instead.
 */
export async function applyLoanWaterfall(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;

  // Pre-bound installments (STK) are absorbed first; the rest oldest-first.
  const { rows: due } = await db.query<{ id: string }>(
    `SELECT lr.id
     FROM   loan_repayments lr
     WHERE  lr.group_id = $1 AND lr.member_id = $2
       AND  lr.status IN ('pending','partially_paid','overdue')
     ORDER  BY (lr.id = $3)::int DESC, lr.due_date, lr.installment_number
     FOR UPDATE`,
    [args.groupId, args.memberId,
     args.preferRepaymentId ?? '00000000-0000-0000-0000-000000000000'],
  );

  let remaining = fulfil.amount;
  let stamped   = false; // UNIQUE(mpesa_receipt_number): stamp only the first row
  const segments: { repaymentId: string; loanId: string; applied: number; principalPortion: number; interestPortion: number }[] = [];

  for (const r of due) {
    if (remaining < 0.005) break;
    const seg = await applyPartialRepayment(db, r.id, remaining, fulfil.receipt, !stamped);
    if (seg) {
      segments.push({
        repaymentId: r.id, loanId: seg.loanId, applied: seg.applied,
        principalPortion: seg.principalPortion, interestPortion: seg.interestPortion,
      });
      remaining -= seg.applied;
      stamped = true;
    }
  }

  // Journals per applied segment (DR cash / CR loans receivable + CR interest
  // income, proportional to each installment's own scheduled split).
  for (const seg of segments) {
    await postLoanRepaymentJournal(db, {
      groupId: args.groupId, repaymentId: seg.repaymentId, loanId: seg.loanId,
      principalPortion: seg.principalPortion, interestPortion: seg.interestPortion,
      entryDate: new Date().toISOString().slice(0, 10), reference: fulfil.receipt,
      createdBy: null, isTest: IS_SANDBOX,
    });
  }

  // Link the first installment to the spine (one payment_id per table row).
  if (segments[0]) {
    await db.query(
      `UPDATE loan_repayments
       SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
       WHERE  id = $2 AND payment_id IS NULL`,
      [fulfil.receipt, segments[0].repaymentId],
    );
  }

  // Leftover → next tier.
  let leftoverNote: string | null = null;
  if (remaining >= 0.005) {
    if (args.obligationsOnly) {
      // Suspended/inactive: savings not permitted — park the excess.
      leftoverNote = 'excess_unrouted';
      await c2bToUnrouted(db, { ...fulfil, amount: remaining }, 'membership_inactive');
    } else if (segments.length === 0) {
      // Nothing due at all (e.g. suffix -L with no loan): whole amount to savings.
      await applyContributionFromC2B(db, {
        ...fulfil,
        memberId:        args.memberId,
        thirdPartyPhone: args.thirdPartyPhone,
      });
      return;
    } else {
      leftoverNote = 'excess_to_savings';
      const contributionId = await insertSavingsContribution(db, {
        groupId:  args.groupId,
        memberId: args.memberId,
        amount:   remaining,
        receipt:  fulfil.receipt,
        note: `Loan repayment excess from PayBill ${fulfil.billRef}`
          + (args.thirdPartyPhone ? ` (third-party payer ${args.thirdPartyPhone})` : ''),
      });
      if (contributionId === null) leftoverNote = 'excess_duplicate_skipped';
    }
  }

  if (segments.length > 0) {
    await markSpineAllocated(db, fulfil.receipt, {
      isThirdParty: !!args.thirdPartyPhone,
      detail: {
        product: 'loan_repayment', tier: args.tier, segments,
        ...(leftoverNote ? { leftover: remaining.toFixed(2), leftoverNote } : {}),
        ...(args.amountVariance ? { amountVariance: true } : {}),
      },
    });
  }
}

/**
 * Insert a completed savings contribution + journal + spine payment_id link.
 * Returns the contribution id, or null on a replay (receipt already recorded).
 * Does NOT flip the spine — callers decide (a loan-waterfall leftover shares
 * one spine transition with its installment segments).
 */
export async function insertSavingsContribution(
  db:   PoolClient,
  args: { groupId: string; memberId: string; amount: number; receipt: string; note: string },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, group_membership_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1, $2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3, CURRENT_DATE, 'completed', 'mpesa', $4, $5, NULL)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [args.groupId, args.memberId, args.amount.toFixed(2), args.receipt, args.note],
  );
  const contributionId = rows[0]?.id ?? null;
  if (!contributionId) return null;

  await postContributionJournal(db, {
    groupId: args.groupId, contributionId, amount: args.amount,
    entryDate: new Date().toISOString().slice(0, 10), reference: args.receipt,
    createdBy: null, isTest: IS_SANDBOX,
  });

  await db.query(
    `UPDATE contributions
     SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
     WHERE  id = $2 AND payment_id IS NULL`,
    [args.receipt, contributionId],
  );

  return contributionId;
}

export async function applyContributionFromC2B(
  db:   PoolClient,
  in_:  C2BFulfilmentInput & { memberId: string; thirdPartyPhone?: string | null },
): Promise<void> {
  // The routing destination is NEVER changed by the payer phone — third
  // parties are flagged, not re-routed.
  const note = `Auto-routed from PayBill ${in_.billRef}`
    + (in_.thirdPartyPhone ? ` (third-party payer ${in_.thirdPartyPhone})` : '');

  const contributionId = await insertSavingsContribution(db, {
    groupId:  in_.groupId,
    memberId: in_.memberId,
    amount:   in_.amount,
    receipt:  in_.receipt,
    note,
  });
  if (!contributionId) return; // replay

  await markSpineAllocated(db, in_.receipt, {
    isThirdParty: !!in_.thirdPartyPhone,
    detail: { product: 'savings', contributionId, groupId: in_.groupId },
  });
}

export async function c2bToUnrouted(
  db:    PoolClient,
  in_:   C2BFulfilmentInput,
  reason: 'unknown_prefix' | 'unknown_group' | 'unknown_member' | 'ambiguous_member' |
          'no_account_ref' | 'amount_mismatch' | 'membership_inactive' | 'bad_account' | 'other',
): Promise<void> {
  if (isSandboxTestRef(in_.billRef)) return;

  // Second, definitive idempotency guard, right at the point of no return.
  // handleC2BConfirmation's own early check (SELECT ... WHERE
  // mpesa_receipt_number=$1, before any routing) already catches the common
  // case — but that check and this one can straddle a real race: Safaricom
  // (or this app's own webhook setup) can deliver an STK success callback and
  // a separate C2B-style notification for the SAME transaction within
  // milliseconds of each other. If the STK callback's payments row commits
  // between the early check and here, this receipt has ALREADY been fully
  // and correctly handled — there is nothing left to route, and filing a
  // duplicate to mpesa_unrouted just creates toil (found 2026-08-26: 7 rows
  // sitting unresolved, all of them exact-receipt duplicates of payments that
  // had already activated a subscription or posted a contribution via STK,
  // none of them missing money).
  const { rows: dup } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM payments WHERE mpesa_receipt_number = $1 LIMIT 1`,
    [in_.receipt],
  );
  if (dup[0]?.status === 'completed') {
    logger.info('[mpesa/c2b] duplicate of an already-completed payment — not filing to unrouted', {
      receipt: in_.receipt, paymentId: dup[0].id, wouldHaveReason: reason,
    });
    await logPaymentEvent(db, dup[0].id, 'replayed', { path: 'c2b', wouldHaveReason: reason });
    return;
  }

  await db.query(
    `INSERT INTO mpesa_unrouted
       (mpesa_transaction_id, receipt, phone, amount, bill_ref,
        reason, raw_payload, candidate_group_id)
     SELECT t.id, $1, $2, $3, $4, $5, $6::jsonb, $7
     FROM   mpesa_transactions t
     WHERE  t.mpesa_receipt_number = $1
     ON CONFLICT (receipt) DO NOTHING`,
    [
      in_.receipt, in_.phone, in_.amount.toFixed(2),
      in_.billRef, reason, in_.rawBody, in_.groupId,
    ],
  );
  logger.warn('[mpesa/c2b] routed to unrouted queue', {
    receipt: in_.receipt,
    reason,
    billRef: in_.billRef,
    phone:   in_.phone,
  });
  await markSpineUnrouted(db, in_.receipt, reason);
}
