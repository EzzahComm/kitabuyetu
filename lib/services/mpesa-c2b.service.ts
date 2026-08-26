/**
 * M-Pesa C2B (PayBill): registration, pre-payment validation, and
 * confirmation. Split out of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md
 * High #9).
 */

import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { safeNormalizePhone, UNKNOWN_PAYER_PHONE } from '@/lib/utils/phone';
import { parseBillRefNumber, isSandboxTestRef, type RoutingDecision } from '@/lib/utils/mpesa-bill-ref';
import { looksLikeMembershipNo, isValidMembershipNo, parseAccountRef } from '@/lib/utils/membership-no';
import { registerC2BUrls as _registerC2B, assertSafaricomIp, type C2BApiVersion } from './daraja.service';
import { lookupPaymentAccount, isPaymentEligible } from './mpesa-payment-accounts.service';
import { IS_SANDBOX, emitPaymentReceiptEvent, logPaymentEvent, emitOutbox, spinePaymentId } from './mpesa-spine.service';
import {
  type C2BFulfilmentInput,
  type StkRequestRow,
  dispatchProduct,
  applyWelfareFromC2B,
  applyContributionFromC2B,
  c2bToUnrouted,
  resolveProductForMembership,
  eligibilityGate,
  hasDueInstallments,
  applyLoanRepayment,
} from './mpesa-allocation.service';

// ─── C2B registration ─────────────────────────────────────────────────────────

export async function registerC2BUrls(version?: C2BApiVersion): Promise<void> {
  return _registerC2B(version);
}

// ─── C2B Validation (payment architecture §3.2) ──────────────────────────────

export type C2BValidationVerdict =
  | { accept: true }
  | { accept: false; reason: 'bad_account' | 'unknown_account' | 'membership_inactive' };

/**
 * Pre-payment account validation — Safaricom calls this BEFORE completing a
 * C2B transaction, so a rejection here means the member's money never moves.
 *
 * Deterministic and conservative:
 *  - Membership-number-SHAPED refs are strictly validated (check digit,
 *    registry presence, payment eligibility). A typo'd number is rejected
 *    instead of becoming unrouted-queue toil.
 *  - Everything else (legacy KYT grammar, invoice numbers, group codes)
 *    is accepted and handled by confirmation-side routing, unchanged.
 *  - Any internal error fails OPEN (accept) — we never lose a payment to our
 *    own latency; the unrouted queue remains the backstop.
 */
export async function validateC2BAccount(
  billRef: string | null | undefined,
): Promise<C2BValidationVerdict> {
  try {
    const parsed = parseAccountRef(billRef ?? '');
    if (!looksLikeMembershipNo(parsed.account)) {
      // Not membership-number shaped — legacy/invoice refs flow to
      // confirmation routing as before.
      return { accept: true };
    }
    // A1: an unknown trailing letter is malformed — reject, never guess.
    if (parsed.invalidSuffix) {
      return { accept: false, reason: 'bad_account' };
    }
    if (!isValidMembershipNo(parsed.account)) {
      return { accept: false, reason: 'bad_account' };
    }
    return await withAdminDb(async (db) => {
      const hit = await lookupPaymentAccount(db, parsed.account);
      if (!hit) return { accept: false as const, reason: 'unknown_account' as const };
      if (isPaymentEligible(hit)) return { accept: true as const };
      // §4.1 obligations-only: suspended/inactive memberships may still pay
      // down loans — accept when due installments exist (confirmation forces
      // the money to the loan waterfall); otherwise reject before money moves.
      if ((hit.membershipStatus === 'suspended' || hit.membershipStatus === 'inactive')
          && hit.accountStatus === 'active' && hit.memberActive === true
          && await hasDueInstallments(db, hit.groupId!, hit.memberId!)) {
        return { accept: true as const };
      }
      return { accept: false as const, reason: 'membership_inactive' as const };
    });
  } catch (err) {
    logger.error('[mpesa/c2b] validation failed open', { billRef, err: String(err) });
    return { accept: true };
  }
}

// ─── C2B Confirmation ─────────────────────────────────────────────────────────

export interface C2BCallbackBody {
  TransactionType:    string;
  TransID:            string;
  TransTime:          string;
  TransAmount:        string;
  BusinessShortCode:  string;
  BillRefNumber:      string;
  InvoiceNumber?:     string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN:             string;
  FirstName?:         string;
  MiddleName?:        string;
  LastName?:          string;
}

export async function handleC2BConfirmation(
  body: C2BCallbackBody,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<void> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  // Safaricom sends a HASHED MSISDN (64-char SHA-256, not a number) on C2B
  // confirmations depending on shortcode configuration. This used to be
  // `normalizePhone(body.MSISDN)`, which throws — on the first line of the
  // handler, so a hashed MSISDN killed the whole crediting path before the
  // idempotency check, before account-number routing, and before the
  // unrouted-queue insert that exists precisely to catch what cannot be
  // routed. Every direct PayBill payment was received by Safaricom and
  // recorded nowhere; 5 real ones (KES 15,631) were lost that way between
  // 2026-05-28 and 2026-07-12 before this was found.
  //
  // The payer phone is INCIDENTAL here and always was — see the routing
  // comment below: the member is identified by the ACCOUNT NUMBER, never by
  // the paying phone, because third parties may pay. So an unusable MSISDN
  // must degrade the record, never reject the money.
  const phone   = safeNormalizePhone(body.MSISDN) ?? UNKNOWN_PAYER_PHONE;
  const amount  = parseFloat(body.TransAmount);
  const rawBody = JSON.stringify(body);
  const route   = parseBillRefNumber(body.BillRefNumber);

  await withAdminDb(async (db) => {
    // 1. Idempotency — duplicate Safaricom retries return early.
    const { rows: existingPay } = await db.query<{ id: string }>(
      'SELECT id FROM payments WHERE mpesa_receipt_number=$1 LIMIT 1',
      [body.TransID],
    );
    if (existingPay[0]) return;

    // 2. Registry-first routing (payment architecture §3.3 R1–R4): one
    //    indexed lookup resolves membership numbers and legacy member codes
    //    to a specific membership — the member is identified by the ACCOUNT
    //    NUMBER, never by the paying phone (third parties may pay). A product
    //    suffix (BG102534-W) is split off before the lookup (§3.5 A1/A3).
    const parsed = parseAccountRef(body.BillRefNumber);
    const hit = await lookupPaymentAccount(db, parsed.account);
    if (hit && (hit.kind === 'membership_no' || hit.kind === 'legacy_code') && hit.groupId) {
      await recordC2BInbound(db, hit.groupId, body, phone, amount, rawBody);

      const fulfil: C2BFulfilmentInput = {
        groupId: hit.groupId, route, receipt: body.TransID,
        amount, phone, billRef: body.BillRefNumber, rawBody,
      };

      // A1: an unknown trailing letter is malformed — never "closest guess".
      if (parsed.invalidSuffix) {
        await c2bToUnrouted(db, fulfil, 'bad_account');
        return;
      }

      // §3.5 A2–A8: resolve the product deterministically.
      const resolved = await resolveProductForMembership(
        db, hit, parsed.suffix, amount,
      );

      // §4.1 per-state eligibility: active → all products; suspended/inactive
      // → obligations only. When an obligations-only membership has due
      // installments, the money is FORCED to loan repayment regardless of
      // defaults — a suspended member can always reduce debt, never grow savings.
      const gate = await eligibilityGate(db, hit, resolved.product);
      if (gate === 'reject') {
        await c2bToUnrouted(db, fulfil, 'membership_inactive');
        return;
      }
      const product = gate === 'force_loan' ? 'loan_repayment' : resolved.product;

      await dispatchProduct(db, {
        product,
        requestId:      gate === 'force_loan' ? null : resolved.requestId,
        amountVariance: resolved.amountVariance,
        tier:           gate === 'force_loan' ? 'state_machine' : resolved.tier,
        obligationsOnly: gate === 'force_loan',
        groupId:        hit.groupId,
        memberId:       hit.memberId!,
        fulfil,
        // Only claim a third party paid when we actually know who did. With an
        // unusable MSISDN the honest answer is "unknown payer", not "someone
        // other than the member" — recording the sentinel here would assert a
        // third-party payment that was never established.
        thirdPartyPhone:
          phone !== UNKNOWN_PAYER_PHONE && hit.memberPhone && hit.memberPhone !== phone
            ? phone
            : null,
        preferRepaymentId: gate !== 'force_loan' ? resolved.entityId : null,
      });
      return;
    }

    // 3. Legacy grammar fallback — resolve the group via the parser.
    const groupId = await resolveC2BGroupId(db, route, body);

    // 4. If we couldn't even resolve a group, log to unrouted with a NULL
    //    candidate group and bail — there's no group_id to write the
    //    mpesa_transactions row against.
    if (!groupId) {
      if (!isSandboxTestRef(body.BillRefNumber)) {
        await db.query(
          `INSERT INTO mpesa_unrouted
             (receipt, phone, amount, bill_ref, reason, raw_payload, candidate_group_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)
           ON CONFLICT (receipt) DO NOTHING`,
          [
            body.TransID, phone, amount.toFixed(2),
            body.BillRefNumber,
            route.kind === 'unknown' ? 'unknown_prefix' : 'unknown_group',
            rawBody,
          ],
        );
      }
      return;
    }

    // 5. Record the inbound, then route to the matching domain action.
    await recordC2BInbound(db, groupId, body, phone, amount, rawBody);
    await fulfilC2B(db, {
      groupId,
      route,
      receipt:  body.TransID,
      amount,
      phone,
      billRef:  body.BillRefNumber,
      rawBody,
    });
  });

  // Receipt SMS (§8) — after the money transaction committed. STK-driven
  // payments get theirs from the callback route; direct PayBill deposits
  // land here. No-op unless the payment ended 'allocated'; idempotent per
  // (rule, paymentId) inside the trigger engine, so Safaricom retries
  // cannot send a second receipt.
  const paymentId = await withAdminDb((db) => spinePaymentId(db, body.TransID));
  if (paymentId) await emitPaymentReceiptEvent(paymentId, { requireAllocated: true });
}

/**
 * Records an inbound C2B payment on both the master ledger and the legacy
 * payments table. Both carry UNIQUE(mpesa_receipt_number) so retries are safe.
 */
async function recordC2BInbound(
  db:      PoolClient,
  groupId: string,
  body:    C2BCallbackBody,
  phone:   string,
  amount:  number,
  rawBody: string,
): Promise<void> {
  await db.query(
    `INSERT INTO mpesa_transactions
       (group_id, transaction_type, direction, mpesa_receipt_number,
        phone_number, amount, status, reference, raw_response, completed_at, is_test)
     VALUES ($1,'c2b','inbound',$2,$3,$4,'completed',$5,$6::jsonb,NOW(),$7)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
    [groupId, body.TransID, phone, amount.toFixed(2), body.BillRefNumber, rawBody, IS_SANDBOX],
  );

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_receipt_number,
        mpesa_phone, mpesa_raw_callback, payment_date, channel)
     VALUES ($1,$2,'mpesa','completed',$3,$4,$5::jsonb,NOW(),'paybill')
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [groupId, amount.toFixed(2), body.TransID, phone, rawBody],
  );

  // First arrival appends 'received' + announces on the outbox; a Safaricom
  // retry (conflict → no row) is recorded as 'replayed' instead.
  if (rows[0]) {
    await logPaymentEvent(db, rows[0].id, 'received', { billRef: body.BillRefNumber });
    await emitOutbox(db, 'payment.received', rows[0].id, {
      receipt: body.TransID, amount, groupId,
    });
  } else {
    const existing = await spinePaymentId(db, body.TransID);
    if (existing) await logPaymentEvent(db, existing, 'replayed', { path: 'c2b' });
  }
}

/**
 * Group resolution strategy for C2B payments:
 *   1. Parser found a group code (`KY1234567`) → look up by `groups.group_code`
 *   2. Parser found an entity id (loan id, invoice number, etc.) → derive the
 *      group via the entity's FK
 *   3. Phone matches exactly one active member → use their group (only if
 *      they're in exactly one group, per the no-account-ref-is-ambiguous rule)
 *
 * Group-NAME matching was deliberately removed (audit H-4): groups.name has no
 * uniqueness constraint, so `UPPER(name) = UPPER(billRef) LIMIT 1` could post
 * real money into an arbitrary same-named group. Do not reintroduce it.
 */
async function resolveC2BGroupId(
  db:    PoolClient,
  route: RoutingDecision,
  body:  C2BCallbackBody,
): Promise<string | null> {
  // 1. KY group code
  if (route.groupCode) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE group_code = $1 AND is_active = true LIMIT 1`,
      [route.groupCode],
    );
    if (rows[0]) return rows[0].id;
  }

  // 2. Entity-id-derived group
  if (route.kind === 'invoice' && route.invoiceNumber) {
    const { rows } = await db.query<{ group_id: string }>(
      `SELECT group_id FROM invoices WHERE invoice_number = $1 LIMIT 1`,
      [route.invoiceNumber],
    );
    if (rows[0]) return rows[0].group_id;
  }
  if (route.kind === 'loan_repayment' && route.entityId) {
    const { rows } = await db.query<{ group_id: string }>(
      `SELECT group_id FROM loans WHERE LOWER(id::text) = LOWER($1) LIMIT 1`,
      [route.entityId],
    );
    if (rows[0]) return rows[0].group_id;
  }

  // 3. Phone-only fallback (only when member is in exactly one group).
  //    A hashed/unusable MSISDN simply cannot match a stored phone, so this
  //    fallback has nothing to offer — return null and let the caller file the
  //    payment as unrouted. It must NOT throw: this is the last resolution
  //    step, and throwing here discards a real payment instead of queueing it
  //    for a human.
  const phone = safeNormalizePhone(body.MSISDN);
  if (!phone) return null;
  const { rows: phoneRows } = await db.query<{ group_id: string }>(
    `SELECT gm.group_id
     FROM   group_members gm
     JOIN   members m ON m.id = gm.member_id
     WHERE  m.phone = $1 AND gm.status = 'active' AND m.is_active = true`,
    [phone],
  );
  if (phoneRows.length === 1) return phoneRows[0].group_id;

  return null;
}

async function fulfilC2B(db: PoolClient, in_: C2BFulfilmentInput): Promise<void> {
  const { route } = in_;

  // Direct invoice payment — flip the invoice to paid
  if (route.kind === 'invoice' && route.invoiceNumber) {
    await db.query(
      `UPDATE invoices
       SET    paid_amount = paid_amount + $1,
              status      = CASE WHEN paid_amount + $1 >= total_amount
                                 THEN 'completed'::payment_status
                                 ELSE status END
       WHERE  invoice_number = $2 AND group_id = $3`,
      [in_.amount.toFixed(2), route.invoiceNumber, in_.groupId],
    );
    return;
  }

  // Contribution-style payments (incl. welfare, share). When the legacy
  // grammar carries a member_code suffix the member is resolved by CODE —
  // never by phone, so third-party payers route correctly (§3.3 R6). Phone
  // resolution survives only for group-only legacy refs.
  if (route.kind === 'contribution' || route.kind === 'welfare' || route.kind === 'share') {
    let memberId: string | null = null;
    let memberPhone: string | null = null;

    if (route.memberCode) {
      const { rows } = await db.query<{ member_id: string; phone: string }>(
        `SELECT gm.member_id, m.phone
         FROM   group_members gm
         JOIN   members m ON m.id = gm.member_id
         WHERE  gm.group_id = $1 AND gm.member_code = $2
           AND  gm.status = 'active' AND m.is_active = true
         LIMIT  1`,
        [in_.groupId, route.memberCode],
      );
      memberId    = rows[0]?.member_id ?? null;
      memberPhone = rows[0]?.phone ?? null;
      // A member code that doesn't match is never "corrected" via phone —
      // that guess is exactly what mis-posts third-party payments.
      if (!memberId) {
        await c2bToUnrouted(db, in_, 'unknown_member');
        return;
      }
    } else {
      memberId = await resolveMemberInGroup(db, in_.phone, in_.groupId);
      if (!memberId) {
        await c2bToUnrouted(db, in_, 'unknown_member');
        return;
      }
    }

    // Product dispatch by legacy ref kind (audit H-3): KYT-WELF money lands
    // in the welfare pool, never mislabelled as savings; shares stay
    // treasurer-mediated (class/price cannot be guessed).
    const thirdPartyPhone = memberPhone && memberPhone !== in_.phone ? in_.phone : null;
    if (route.kind === 'welfare') {
      await applyWelfareFromC2B(db, {
        product: 'welfare', requestId: null, amountVariance: false,
        tier: 'legacy_ref', obligationsOnly: false,
        groupId: in_.groupId, memberId, fulfil: in_, thirdPartyPhone,
      });
    } else if (route.kind === 'share') {
      await c2bToUnrouted(db, in_, 'other');
    } else {
      await applyContributionFromC2B(db, { ...in_, memberId, thirdPartyPhone });
    }
    return;
  }

  // Loan repayment by paybill — match loan by entityId
  if (route.kind === 'loan_repayment' && route.entityId) {
    // Find the next pending repayment for that loan
    const { rows: rpRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM   loan_repayments
       WHERE  LOWER(loan_id::text) = LOWER($1) AND status = 'pending'
       ORDER  BY installment_number
       LIMIT  1`,
      [route.entityId],
    );
    if (!rpRows[0]) {
      await c2bToUnrouted(db, in_, 'other');
      return;
    }
    // Reuse the same wiring as STK by piggy-backing on applyLoanRepayment
    const stkReq: StkRequestRow = {
      id:                rpRows[0].id,
      group_id:          in_.groupId,
      purpose:           'loan_repayment',
      invoice_id:        null,
      loan_repayment_id: rpRows[0].id,
      account_reference: in_.billRef,
      amount:            in_.amount.toFixed(2),
      // C2B PayBill payments never buy a subscription — this synthetic row
      // exists only to reuse applyLoanRepayment's wiring.
      plan_type:         null,
      product:           null,
      billing_cycle:     null,
    };
    await applyLoanRepayment(
      db,
      stkReq,
      { receipt: in_.receipt, amount: in_.amount, phone: in_.phone, rawBody: in_.rawBody },
    );
    return;
  }

  // Subscription / investment / unknown — leave the payment recorded but
  // don't side-effect a domain entity. Treasurer resolves via /mpesa/unrouted.
  await c2bToUnrouted(db, in_, route.kind === 'unknown' ? 'unknown_prefix' : 'other');
}

async function resolveMemberInGroup(
  db:     PoolClient,
  phone:  string,
  groupId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT m.id
     FROM   members m
     JOIN   group_members gm ON gm.member_id = m.id
     WHERE  m.phone   = $1
       AND  gm.group_id = $2
       AND  gm.status = 'active'
       AND  m.is_active  = true
     LIMIT  1`,
    [phone, groupId],
  );
  return rows[0]?.id ?? null;
}
