/**
 * Safaricom Daraja SecurityCredential builder.
 *
 * The B2C, Reversal, Account Balance, and Transaction Status APIs require the
 * initiator password to be RSA-encrypted (PKCS#1 v1.5) against Safaricom's
 * published public certificate, then base64-encoded. The resulting blob is
 * sent as the `SecurityCredential` field on every API call.
 *
 * This module resolves and caches the encrypted blob at first use. Resolution
 * priority:
 *   1. MPESA_B2C_SECURITY_CREDENTIAL env var (pre-encrypted, operator-supplied)
 *   2. RSA-encrypt MPESA_B2C_INITIATOR_PASSWORD using:
 *      a. MPESA_PUBLIC_CERT_PEM env var (raw PEM string)
 *      b. MPESA_PUBLIC_CERT_PATH env var (file path)
 *      c. lib/certs/{sandbox,production}.cer based on MPESA_ENV
 *
 * If none of the above resolves and MPESA_ENV=production, throws at first
 * use. In sandbox we tolerate a missing credential — Safaricom sandbox B2C
 * accepts an empty SecurityCredential for the well-known test initiator.
 *
 * The encrypted blob is cached in module scope for the lifetime of the
 * process. Rotation requires a redeploy.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const IS_SANDBOX = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';

let _cachedCredential: string | null = null;
let _resolutionError: Error | null = null;

/**
 * Returns the SecurityCredential blob ready for transmission. Memoised after
 * first successful resolution.
 *
 * Throws if no credential can be resolved AND we're in production. In
 * sandbox, returns an empty string so the existing well-known test
 * initiator still works without operator setup.
 */
export function getSecurityCredential(): string {
  if (_cachedCredential !== null) return _cachedCredential;
  if (_resolutionError) throw _resolutionError;

  try {
    const blob = resolveCredential();
    _cachedCredential = blob;
    return blob;
  } catch (err) {
    _resolutionError = err instanceof Error ? err : new Error(String(err));
    throw _resolutionError;
  }
}

/**
 * Test-only escape hatch. Clears the in-process cache so the next call to
 * getSecurityCredential() re-resolves from env. Not exported via index.ts.
 */
export function _resetCredentialCacheForTests(): void {
  _cachedCredential = null;
  _resolutionError = null;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Sanity check for a pre-encrypted SecurityCredential: base64 charset and a
 * minimum length consistent with RSA ciphertext. Catches placeholder strings
 * before they reach Safaricom.
 */
function looksLikeRealCredential(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 300;
}

function resolveCredential(): string {
  // 1. Operator-supplied pre-encrypted blob — take as-is, but guard against
  //    placeholders. A real Safaricom SecurityCredential is RSA ciphertext
  //    encoded as base64 (~344 chars for RSA-2048, ~684 for RSA-4096). A short
  //    or non-base64 value is almost certainly a dummy like
  //    "your_security_credential" — fail loudly rather than ship it to
  //    Safaricom and get a cryptic InvalidInitiatorInformation at call time.
  const preEncrypted = process.env.MPESA_B2C_SECURITY_CREDENTIAL?.trim();
  if (preEncrypted) {
    if (!looksLikeRealCredential(preEncrypted)) {
      throw new Error(
        '[mpesa-credential] MPESA_B2C_SECURITY_CREDENTIAL is set but does not look ' +
        'like a valid Safaricom credential (expected base64 RSA output, ~344+ chars). ' +
        'Replace the placeholder with the encrypted blob from the Daraja portal, or ' +
        'unset it and use MPESA_B2C_INITIATOR_PASSWORD + the public cert.',
      );
    }
    return preEncrypted;
  }

  // 2. Plaintext password + cert → RSA encrypt at runtime
  const password = process.env.MPESA_B2C_INITIATOR_PASSWORD?.trim();
  if (!password) {
    if (IS_SANDBOX) return '';
    throw new Error(
      '[mpesa-credential] No SecurityCredential available. Set either ' +
      'MPESA_B2C_SECURITY_CREDENTIAL (pre-encrypted) or ' +
      'MPESA_B2C_INITIATOR_PASSWORD (plaintext, requires cert).',
    );
  }

  const certPem = loadCertificate();
  return rsaEncrypt(password, certPem);
}

function loadCertificate(): string {
  // a. Raw PEM via env var — preferred for serverless
  const inlinePem = process.env.MPESA_PUBLIC_CERT_PEM?.trim();
  if (inlinePem) {
    return normaliseCertPem(inlinePem);
  }

  // b. Explicit file path via env var
  const explicitPath = process.env.MPESA_PUBLIC_CERT_PATH?.trim();
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.join(/* turbopackIgnore: true */ process.cwd(), explicitPath);
    return readCertFile(resolved);
  }

  // c. Convention: lib/certs/{sandbox,production}.cer
  const conventional = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    'lib',
    'certs',
    IS_SANDBOX ? 'sandbox.cer' : 'production.cer',
  );
  return readCertFile(conventional);
}

function readCertFile(filePath: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(/* turbopackIgnore: true */ filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `[mpesa-credential] Cannot read Safaricom public cert from ${filePath}. ` +
      `Either place the cert there or set MPESA_PUBLIC_CERT_PEM / MPESA_PUBLIC_CERT_PATH. ` +
      `Underlying error: ${(err as Error).message}`,
    );
  }
  return normaliseCertPem(raw);
}

/**
 * Safaricom's .cer files are PEM-encoded X.509 certificates. Some operator
 * exports wrap the PEM body in `\r\n` line endings or strip the headers.
 * Restore both so `crypto.createPublicKey` accepts the input on every OS.
 */
function normaliseCertPem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) {
    return trimmed.replace(/\r\n/g, '\n');
  }
  // Bare base64 body — wrap with the standard PEM armor
  const body = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

function rsaEncrypt(plaintext: string, certPem: string): string {
  const publicKey = crypto.createPublicKey(certPem);
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plaintext, 'utf8'),
  );
  return encrypted.toString('base64');
}
