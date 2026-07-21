/**
 * Payment-identifier registry (payment architecture §3.1), shared by the STK
 * and C2B flows. Split out of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md
 * High #9).
 */

import type { PoolClient } from 'pg';
import { normalizeAccountRef } from '@/lib/utils/membership-no';

export interface PaymentAccountHit {
  kind:             string;          // membership_no | legacy_code | invoice | …
  identifier:       string;
  accountStatus:    string;          // payment_accounts.status
  membershipId:     string | null;
  invoiceId:        string | null;
  groupId:          string | null;   // membership's or invoice's group
  memberId:         string | null;
  membershipStatus: string | null;   // group_members.status
  memberActive:     boolean | null;  // members.is_active (platform lock)
  memberPhone:      string | null;
}

/**
 * Single routing lookup: normalise the inbound reference and match it against
 * payment_accounts. Membership numbers and legacy member codes are stored
 * without separators; invoice numbers keep their dashes — so we try both the
 * fully-stripped and the dash-normalised forms.
 */
export async function lookupPaymentAccount(
  db:     PoolClient,
  rawRef: string | null | undefined,
): Promise<PaymentAccountHit | null> {
  const stripped = normalizeAccountRef(rawRef ?? '');
  if (!stripped) return null;
  const dashNorm = (rawRef ?? '')
    .trim().toUpperCase()
    .replace(/[\s_/.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  const { rows } = await db.query<{
    kind: string; identifier: string; account_status: string;
    membership_id: string | null; invoice_id: string | null;
    gm_group_id: string | null; member_id: string | null;
    membership_status: string | null; member_active: boolean | null;
    member_phone: string | null; invoice_group_id: string | null;
  }>(
    `SELECT pa.kind, pa.identifier, pa.status AS account_status,
            pa.membership_id, pa.invoice_id,
            gm.group_id  AS gm_group_id,
            gm.member_id,
            gm.status    AS membership_status,
            m.is_active  AS member_active,
            m.phone      AS member_phone,
            i.group_id   AS invoice_group_id
     FROM   payment_accounts pa
     LEFT JOIN group_members gm ON gm.id = pa.membership_id
     LEFT JOIN members       m  ON m.id  = gm.member_id
     LEFT JOIN invoices      i  ON i.id  = pa.invoice_id
     WHERE  pa.identifier IN ($1, $2)
     LIMIT  1`,
    [stripped, dashNorm],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    kind:             r.kind,
    identifier:       r.identifier,
    accountStatus:    r.account_status,
    membershipId:     r.membership_id,
    invoiceId:        r.invoice_id,
    groupId:          r.gm_group_id ?? r.invoice_group_id,
    memberId:         r.member_id,
    membershipStatus: r.membership_status,
    memberActive:     r.member_active,
    memberPhone:      r.member_phone,
  };
}

/** Payment eligibility per the membership state machine (§4.1). */
export function isPaymentEligible(hit: PaymentAccountHit): boolean {
  return hit.accountStatus === 'active'
      && hit.membershipStatus === 'active'
      && hit.memberActive === true;
}
