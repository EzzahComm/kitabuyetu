/**
 * Kenyan MOBILE subscriber numbers begin 7 or 1 after the 254 country code —
 * 07xx/01xx locally. Landlines and special ranges (020 Nairobi, 041 Mombasa,
 * 051 Nakuru …) do not.
 *
 * The rule used to be "0 followed by ten digits", which admitted every one of
 * those. A landline entered as a member's phone normalised happily to
 * 254201234567, then reserved credit, dispatched, failed at the provider, and
 * burned its whole sms_failures retry budget — paid for, undeliverable, and
 * indistinguishable in the logs from a real network failure (SMS-AUDIT-v3
 * V3-03).
 *
 * Verified before tightening: 0 of the 35 stored member phones and 0 SMS
 * recipients in production fall outside this rule, so nothing existing breaks.
 */
const KE_MOBILE_PREFIX = /^[71]/;

/**
 * Normalise a Kenyan phone number to E.164 format (254XXXXXXXXX).
 * Accepts: 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX, 7XXXXXXXX.
 * Rejects landlines and anything not a Kenyan mobile.
 */
export function normalizePhone(raw: string): string {
  // Throw the documented error for a null/undefined/non-string caller rather
  // than a TypeError from .replace — callers catch on message, and a
  // TypeError escapes the guards written against this contract.
  if (typeof raw !== 'string') {
    throw new Error(`Invalid Kenyan phone number: ${String(raw)}`);
  }

  const digits = raw.replace(/\D/g, '');

  const subscriber =
    digits.startsWith('254') && digits.length === 12 ? digits.slice(3)
    : digits.startsWith('0')  && digits.length === 10 ? digits.slice(1)
    : digits.length === 9                             ? digits
    : null;

  if (subscriber !== null && KE_MOBILE_PREFIX.test(subscriber)) {
    return '254' + subscriber;
  }

  throw new Error(`Invalid Kenyan phone number: ${raw}`);
}

/** Returns true if the string looks like a valid Kenyan mobile number. */
export function isValidKenyanPhone(raw: string): boolean {
  try {
    normalizePhone(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Like normalizePhone, but returns null instead of throwing.
 *
 * For callers where the phone is INCIDENTAL — recorded for the audit trail,
 * not used to identify anyone. Safaricom sends a hashed MSISDN (a 64-char
 * SHA-256, not a number) on C2B confirmation callbacks depending on shortcode
 * configuration, and the throwing version turned that into a total failure of
 * the money-crediting path: `handleC2BConfirmation` normalised MSISDN on its
 * FIRST line, so it died before the idempotency check, before account-number
 * routing, and before the unrouted-queue insert that exists precisely to catch
 * payments it cannot route. Every direct PayBill payment was therefore
 * received by Safaricom and recorded nowhere.
 *
 * Use this wherever a missing phone should degrade the record, not reject the
 * money. Where the phone genuinely identifies someone (login, member
 * creation, STK push targeting), keep using normalizePhone and let it throw.
 */
export function safeNormalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

/**
 * Stored in place of a payer phone we genuinely do not have.
 *
 * `mpesa_unrouted.phone` is `varchar(20) NOT NULL`, and a hashed MSISDN is 64
 * characters, so neither the raw value nor NULL can be written there. A named
 * constant rather than a bare 'unknown' literal so this is greppable when the
 * question "why does this row say unknown" is eventually asked.
 */
export const UNKNOWN_PAYER_PHONE = 'unknown';

/** Format E.164 number for display: 0712 345 678 */
export function formatPhoneDisplay(e164: string): string {
  const local = '0' + e164.replace(/^254/, '');
  return local.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
}
