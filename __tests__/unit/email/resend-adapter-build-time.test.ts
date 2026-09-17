/**
 * Regression guard: importing the Resend adapter must never throw at module
 * load, even with no RESEND_API_KEY present — the same class of bug as
 * __tests__/unit/db/pool-build-time.test.ts (DATABASE_URL) and the earlier
 * daraja.service.ts fix (b6ee340).
 *
 * Next.js's build-time page-data-collection step imports every route
 * module — including this one, transitively via any route using the email
 * service — regardless of whether RESEND_API_KEY is configured in that
 * environment. A module-scope `new Resend(...)` (Resend's constructor
 * throws immediately on a missing key) failed the ENTIRE production build
 * at whichever route imported this file first: confirmed live, three
 * consecutive Vercel production deployments errored on
 * "Failed to collect configuration for /api/admin/analytics" /
 * "Missing API key. Pass it to the constructor `new Resend(\"re_123\")`"
 * before this fix, none of them caused by unrelated code changes.
 *
 * Nothing is weakened by deferring construction: send() is never called
 * during a build, only at real request time.
 */

const ORIGINAL_RESEND_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_RESEND_ENV };
});

it('imports cleanly when RESEND_API_KEY is absent', async () => {
  delete process.env.RESEND_API_KEY;

  const { ResendAdapter } = await import('@/lib/email/adapters/resend');

  expect(new ResendAdapter().name).toBe('resend');
});
