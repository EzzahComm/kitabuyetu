import crypto from 'crypto';

// Phase D Part 2 — registrant verification primitives.
// The DB stores SHA-256 hashes; the plaintext token/OTP is delivered via
// Resend (email link) or Safaricom (SMS OTP) and never persisted.

export function generateEmailToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateSmsOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashSecret(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}
