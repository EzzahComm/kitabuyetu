/**
 * Deterministic UUID derivation (RFC 4122 §4.3, version 5 / SHA-1).
 *
 * Exists because a dispatch key that is persisted into a `uuid` column must
 * BE a uuid. app/api/v1/workers/sms-dispatch-chunk/route.ts previously built
 * its per-chunk key as `${jobId}:chunk:${i}` — a plain string — and handed it
 * to sendBulkCampaign, where it lands in sms_usage_logs.correlation_id and
 * .reference_id (both `uuid`, migrations 006 and 123). Postgres rejected it
 * with 22P02 on the very first statement, so every chunked bulk send failed
 * outright, wrote zero rows, and reported success to the caller because
 * /api/v1/sms/bulk had already returned { queued: true }.
 *
 * Derivation rather than randomUUID() is the whole point: the key must be
 * STABLE across QStash retries of the same chunk (so the retry dedupes
 * against its own earlier attempt) while remaining DISTINCT per chunk (so
 * sibling chunks don't dedupe each other away). A random id would satisfy
 * neither.
 */
import crypto from 'crypto';

/** RFC 4122 canonical form: 8-4-4-4-12 lowercase hex. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Derive a stable v5 UUID from a namespace UUID and a name.
 *
 * Same (namespace, name) always yields the same uuid; different names under
 * one namespace never collide in practice (SHA-1 truncated to 128 bits).
 *
 * @param namespace a canonical UUID string — the natural choice is the id of
 *                  the parent entity (e.g. the job id), which keeps every
 *                  derived key naturally scoped to its parent.
 * @param name      an arbitrary label unique within that namespace.
 */
export function deriveUuid(namespace: string, name: string): string {
  if (!isUuid(namespace)) {
    throw new Error(`deriveUuid: namespace must be a UUID, got "${namespace}"`);
  }

  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const digest = crypto
    .createHash('sha1')
    .update(nsBytes)
    .update(name, 'utf8')
    .digest();

  // Take the first 16 bytes, then stamp version (5) and RFC 4122 variant.
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5, high nibble of byte 6
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x, high bits of byte 8

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
