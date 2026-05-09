/** Format a numeric string or number as KES currency. */
export function formatKES(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num.toLocaleString('en-KE', { style: 'currency', currency: 'KES' });
}

/** Round to 2 decimal places and return as string — safe for DB inserts. */
export function toDecimal(amount: number): string {
  return amount.toFixed(2);
}

/** Add two decimal strings. Avoids floating-point errors for display purposes. */
export function addDecimal(a: string, b: string): string {
  return toDecimal(parseFloat(a) + parseFloat(b));
}

export function subtractDecimal(a: string, b: string): string {
  return toDecimal(parseFloat(a) - parseFloat(b));
}

export function multiplyDecimal(a: string, b: string | number): string {
  return toDecimal(parseFloat(a) * (typeof b === 'string' ? parseFloat(b) : b));
}

/** Convert KES amount (e.g. 1500.50) to M-Pesa integer shillings (1500). */
export function toMpesaAmount(kes: string | number): number {
  return Math.floor(typeof kes === 'string' ? parseFloat(kes) : kes);
}
