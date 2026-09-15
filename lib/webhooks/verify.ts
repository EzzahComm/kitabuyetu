/**
 * Webhook signature verification helpers.
 *
 * Each provider uses a different signing scheme. The helpers below take the
 * *raw* request body (not the JSON-parsed object — the signature is over
 * bytes, not whitespace-normalised JSON) and return a boolean.
 *
 * Implementations are dependency-free (Node `crypto` only) so they run in
 * the App Router runtime without bundling svix.
 */
import crypto from 'crypto';

// =============================================================================
// Resend (svix) — HMAC-SHA256 signed with a base64 secret + replay window
// =============================================================================
//
// Headers Resend sends (svix-* are the actual headers):
//   svix-id         — unique message id
//   svix-timestamp  — unix seconds, used as a replay-protection nonce
//   svix-signature  — space-separated list of "v1,<base64-sig>" tokens.
//                     Multiple tokens accommodate rotated secrets.
//
// HMAC input  = `${svix-id}.${svix-timestamp}.${raw-body}`
// HMAC key    = base64-decoded secret (the part after `whsec_`)
// Signature   = HMAC-SHA256(input, key)  then base64-encoded
//
// Tolerance: reject timestamps more than ±5 min from now to bound replay.

const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixVerifyResult {
  ok:     boolean;
  reason?: string;
}

export function verifySvixSignature(
  rawBody: string,
  headers: {
    svixId?:        string | null;
    svixTimestamp?: string | null;
    svixSignature?: string | null;
  },
  secret: string,
): SvixVerifyResult {
  const { svixId, svixTimestamp, svixSignature } = headers;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing svix headers' };
  }

  // Replay-window check first — cheap, prevents an attacker from replaying
  // a previously-captured valid request indefinitely.
  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed svix-timestamp' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'svix-timestamp outside tolerance window' };
  }

  // Decode the secret. svix secrets are typically `whsec_<base64>` — strip
  // the prefix if present. Some users paste the raw base64 directly.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawSecret, 'base64');
  } catch {
    return { ok: false, reason: 'secret is not valid base64' };
  }
  if (key.length === 0) {
    return { ok: false, reason: 'decoded secret is empty' };
  }

  const expected = crypto
    .createHmac('sha256', key)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`, 'utf8')
    .digest();

  // svix-signature is a space-separated list like "v1,abcd= v1,wxyz=".
  // Any one valid match wins.
  for (const token of svixSignature.split(' ')) {
    const [version, sigB64] = token.split(',');
    if (version !== 'v1' || !sigB64) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(sigB64, 'base64');
    } catch {
      continue;
    }
    if (provided.length === expected.length &&
        crypto.timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'no matching v1 signature' };
}
