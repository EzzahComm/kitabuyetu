/**
 * Normalise a Kenyan phone number to E.164 format (254XXXXXXXXX).
 * Accepts: 07XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0')   && digits.length === 10)  return '254' + digits.slice(1);
  if (digits.startsWith('7')   && digits.length === 9)   return '254' + digits;
  if (digits.startsWith('1')   && digits.length === 9)   return '254' + digits;

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

/** Format E.164 number for display: 0712 345 678 */
export function formatPhoneDisplay(e164: string): string {
  const local = '0' + e164.replace(/^254/, '');
  return local.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
}
