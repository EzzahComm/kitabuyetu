/**
 * Where a Changi$ha campaign's withdrawals are paid: an M-Pesa phone (Daraja
 * B2C), or a business paybill/till (Daraja B2B) - e.g. a hospital, school or
 * funeral home paid directly instead of through a person's phone.
 *
 * Pure and dependency-free on purpose: the service layer and the dashboard
 * both use it, so it must never import anything server-only.
 */

export type PayoutMethod = 'phone' | 'paybill' | 'till';

/** The payout columns shared by `campaigns` and `campaign_withdrawals` (migration 202). */
export interface PayoutFields {
  payout_method: PayoutMethod;
  payout_phone: string | null;
  payout_shortcode: string | null;
  payout_account: string | null;
  payout_payee_name: string | null;
}

export type PayoutDestination =
  | { method: 'phone'; phone: string }
  | { method: 'paybill'; shortcode: string; account: string; payeeName: string }
  | { method: 'till'; shortcode: string; payeeName: string };

/** A complete destination a withdrawal can be sent to, or null if something required is missing. */
export function toPayoutDestination(fields: PayoutFields): PayoutDestination | null {
  const { payout_method, payout_phone, payout_shortcode, payout_account, payout_payee_name } = fields;
  if (payout_method === 'phone') {
    return payout_phone ? { method: 'phone', phone: payout_phone } : null;
  }
  if (payout_method === 'paybill') {
    return payout_shortcode && payout_account && payout_payee_name
      ? { method: 'paybill', shortcode: payout_shortcode, account: payout_account, payeeName: payout_payee_name }
      : null;
  }
  if (payout_method === 'till') {
    return payout_shortcode && payout_payee_name
      ? { method: 'till', shortcode: payout_shortcode, payeeName: payout_payee_name }
      : null;
  }
  return null;
}

/** Column values for a destination. Fields its method doesn't use are cleared, never left stale. */
export function payoutColumns(destination: PayoutDestination): PayoutFields {
  return {
    payout_method: destination.method,
    payout_phone: destination.method === 'phone' ? destination.phone : null,
    payout_shortcode: destination.method === 'phone' ? null : destination.shortcode,
    payout_account: destination.method === 'paybill' ? destination.account : null,
    payout_payee_name: destination.method === 'phone' ? null : destination.payeeName,
  };
}

/** The Daraja product a method pays through. */
export function payoutChannel(method: PayoutMethod): 'b2c' | 'b2b' {
  return method === 'phone' ? 'b2c' : 'b2b';
}

/** One-line human description, e.g. "Paybill 247247, account 12345 (Kenyatta National Hospital)". */
export function describePayoutDestination(fields: PayoutFields): string {
  const destination = toPayoutDestination(fields);
  if (!destination) return 'Not set';
  if (destination.method === 'phone') return `M-Pesa ${destination.phone}`;
  if (destination.method === 'paybill') {
    return `Paybill ${destination.shortcode}, account ${destination.account} (${destination.payeeName})`;
  }
  return `Till ${destination.shortcode} (${destination.payeeName})`;
}
