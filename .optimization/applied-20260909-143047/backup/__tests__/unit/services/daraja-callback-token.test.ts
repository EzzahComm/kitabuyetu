/**
 * isValidCallbackToken (B2C audit H1, lib/services/daraja.service.ts) — the
 * check that used to live as a module-scope `throw` and crashed the entire
 * Next.js build (every route, not just B2C) whenever MPESA_ENV=production
 * was set without MPESA_CALLBACK_TOKEN, since Next evaluates every route's
 * module graph during build-time page-data collection. Moved to the actual
 * call sites; this pins the corrected behavior: never treat an
 * unauthenticated callback as valid just because the token wasn't
 * configured, without crashing module import.
 *
 * MPESA_ENV/MPESA_CALLBACK_TOKEN are read once at module scope, so each
 * case below sets env vars and re-imports the module fresh via
 * jest.resetModules().
 */

const ENV_KEYS = ['MPESA_ENV', 'MPESA_CALLBACK_TOKEN'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  jest.resetModules();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('isValidCallbackToken', () => {
  it('does not throw on import even when production is misconfigured (no MPESA_CALLBACK_TOKEN)', () => {
    process.env.MPESA_ENV = 'production';
    delete process.env.MPESA_CALLBACK_TOKEN;
    expect(() => require('@/lib/services/daraja.service')).not.toThrow();
  });

  it('returns false (never trusts) when production is misconfigured, regardless of the token supplied', () => {
    process.env.MPESA_ENV = 'production';
    delete process.env.MPESA_CALLBACK_TOKEN;
    const { isValidCallbackToken } = require('@/lib/services/daraja.service');

    expect(isValidCallbackToken('anything')).toBe(false);
    expect(isValidCallbackToken(null)).toBe(false);
  });

  it('validates the token correctly when production is properly configured', () => {
    process.env.MPESA_ENV = 'production';
    process.env.MPESA_CALLBACK_TOKEN = 'super-secret-token';
    const { isValidCallbackToken } = require('@/lib/services/daraja.service');

    expect(isValidCallbackToken('super-secret-token')).toBe(true);
    expect(isValidCallbackToken('wrong-token')).toBe(false);
    expect(isValidCallbackToken(null)).toBe(false);
  });

  it('is permissive in sandbox when no token is configured (nothing to check)', () => {
    process.env.MPESA_ENV = 'sandbox';
    delete process.env.MPESA_CALLBACK_TOKEN;
    const { isValidCallbackToken } = require('@/lib/services/daraja.service');

    expect(isValidCallbackToken(null)).toBe(true);
    expect(isValidCallbackToken('anything')).toBe(true);
  });
});
