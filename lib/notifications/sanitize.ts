/**
 * Strips secrets and credentials from anything that reaches an activity row
 * or a notification. Deny-by-key, applied recursively, plus size caps so a
 * runaway payload cannot bloat the table or an SMS.
 */

const SECRET_KEY =
  /pass(word|wd)?|otp|pin(code)?$|^pin$|token|secret|api[-_]?key|authorization|credential|cvv|card[-_]?number|consumer[-_]?(key|secret)|passkey|private[-_]?key|cookie|session/i;

const MAX_STRING = 500;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  return sanitizeValue(meta) as Record<string, unknown>;
}

/** Text safe for SMS: GSM-friendly punctuation, no control characters. */
export function gsmSafe(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E\n£€]/g, '')
    .trim();
}
