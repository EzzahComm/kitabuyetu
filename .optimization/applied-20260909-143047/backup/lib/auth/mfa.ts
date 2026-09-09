/**
 * TOTP + recovery-code primitives for backoffice MFA.
 *
 * - TOTP via `otplib` v13's functional API (HMAC-SHA1, 30-second period,
 *   6 digits — RFC 6238 defaults that every authenticator app honours).
 * - Secret-at-rest encryption via AES-256-GCM keyed by ENCRYPTION_KEY.
 * - Recovery codes are bcrypt-hashed before storage; we never store the
 *   plaintext after the user has seen them at enrollment.
 *
 * Threat model bounds:
 *   - DB read alone is insufficient to bypass MFA — the attacker also
 *     needs ENCRYPTION_KEY to decrypt the secret.
 *   - Recovery codes are single-use; consumed codes are removed from the
 *     array so a leaked enrollment screenshot is useful at most 10 times.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { env } from '@/lib/env';

// 1 = accept the previous + next step too (±30s clock drift).
const TOTP_EPOCH_TOLERANCE = 1;

// ── Secret encryption (AES-256-GCM) ─────────────────────────────────────

const ENC_ALGO   = 'aes-256-gcm';
const IV_BYTES   = 12;

function getEncryptionKey(): Buffer {
  // The env validator guarantees >= 32 chars. We hash to exactly 32 bytes
  // so any string length input becomes a valid AES-256 key. If the user
  // rotates ENCRYPTION_KEY, existing rows become undecryptable — that's
  // by design (forces a re-enrollment).
  return crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();
}

/** Encrypt the TOTP secret. Output format: `<iv hex>:<authTag hex>:<ciphertext hex>`. */
export function encryptSecret(plaintext: string): string {
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncryptionKey(), iv);
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(blob: string): string {
  const [ivHex, tagHex, ctHex] = blob.split(':');
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error('Malformed encrypted secret blob');
  }
  const iv  = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct  = Buffer.from(ctHex, 'hex');
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// ── TOTP wrappers ───────────────────────────────────────────────────────

/** Generate a fresh base32 TOTP secret. ~20 bytes of entropy. */
export function generateTotpSecret(): string {
  return otpGenerateSecret();
}

/**
 * otpauth:// URL embeddable in a QR code. `accountLabel` is what the
 * user sees in their authenticator (e.g. "alice@kitabuyetu.co.ke").
 * `issuer` shows up as the app name.
 */
export function buildOtpAuthUrl(accountLabel: string, secret: string): string {
  return generateURI({
    strategy: 'totp',
    issuer:   'Kitabu Yetu',
    label:    accountLabel,
    secret,
  });
}

/** Render the otpauth URL as a base64 PNG data URL the UI can drop into <img src>. */
export async function buildOtpAuthQrCode(accountLabel: string, secret: string): Promise<string> {
  const url = buildOtpAuthUrl(accountLabel, secret);
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', width: 240 });
}

/** Verify a 6-digit TOTP code against a (still-encrypted) stored secret. */
export function verifyTotp(code: string, encryptedSecret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let secret: string;
  try {
    secret = decryptSecret(encryptedSecret);
  } catch {
    return false; // corrupt blob or wrong key — treat as auth failure
  }
  return verifyTotpRaw(code, secret);
}

/** Verify against a *plaintext* secret. Used during enrollment-confirm only. */
export function verifyTotpRaw(code: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const result = verifySync({
    strategy:       'totp',
    secret,
    token:          code,
    epochTolerance: TOTP_EPOCH_TOLERANCE,
  });
  return result.valid === true;
}

// ── Recovery codes ──────────────────────────────────────────────────────

const RECOVERY_COUNT  = 10;
const RECOVERY_BYTES  = 5;  // 10 hex chars = 5 bytes; printed as 2 groups of 5

/** Generate `RECOVERY_COUNT` printable codes like "a1b2c-d3e4f". */
export function generateRecoveryCodes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const raw = crypto.randomBytes(RECOVERY_BYTES).toString('hex'); // 10 chars
    out.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return out;
}

const RECOVERY_BCRYPT_ROUNDS = 10;

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c.replace(/-/g, '').toLowerCase(), RECOVERY_BCRYPT_ROUNDS)));
}

/**
 * Verify a presented recovery code against the stored hashes. Returns the
 * remaining hashes (matched one removed) so the caller can persist single-use.
 * Returns null if no hash matched.
 */
export async function verifyAndConsumeRecoveryCode(
  presented: string,
  storedHashes: string[],
): Promise<{ matchedHash: string; remainingHashes: string[] } | null> {
  const normalised = presented.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{10}$/.test(normalised)) return null;
  for (const h of storedHashes) {
    if (await bcrypt.compare(normalised, h)) {
      return { matchedHash: h, remainingHashes: storedHashes.filter((x) => x !== h) };
    }
  }
  return null;
}
